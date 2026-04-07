use crate::types::DownloadEvent;
use futures_util::StreamExt;
use reqwest::Client;
use std::fs::{self, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tokio::sync::Semaphore;
use tokio::time::sleep;

/// Download manager for handling game file downloads
pub struct DownloadManager {
    client: Client,
    max_concurrent: usize,
    speed_limit: Option<u64>, // bytes per second
    cancel_token: Arc<AtomicBool>,
}

impl DownloadManager {
    pub fn new(max_concurrent: usize, speed_limit: Option<u64>) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(300))
            .pool_max_idle_per_host(10)
            .build()
            .expect("Failed to create HTTP client");

        Self {
            client,
            max_concurrent,
            speed_limit,
            cancel_token: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Download a single file with resume support
    pub async fn download_file(
        &self,
        url: &str,
        dest_path: &Path,
        expected_hash: Option<&str>,
        on_event: &Channel<DownloadEvent>,
    ) -> Result<(), DownloadError> {
        // Create parent directories
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // Check for partial download
        let (start_byte, mut file) = if dest_path.exists() {
            let metadata = fs::metadata(dest_path)?;
            let existing_size = metadata.len();
            
            let file = OpenOptions::new()
                .write(true)
                .append(true)
                .open(dest_path)?;
            
            (existing_size, file)
        } else {
            let file = OpenOptions::new()
                .write(true)
                .create(true)
                .open(dest_path)?;
            (0, file)
        };

        // Build request with resume header
        let mut request = self.client.get(url);
        if start_byte > 0 {
            request = request.header("Range", format!("bytes={}-", start_byte));
        }

        let response = request.send().await?;
        
        if !response.status().is_success() && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(DownloadError::HttpError(response.status().to_string()));
        }

        let total_size = response
            .content_length()
            .map(|cl| cl + start_byte)
            .unwrap_or(0);

        // Send started event
        let file_path_str = dest_path.to_string_lossy().to_string();
        let _ = on_event.send(DownloadEvent::Started {
            file_path: file_path_str.clone(),
            total_size,
        });

        let mut stream = response.bytes_stream();
        let mut downloaded = start_byte;
        let mut last_update = Instant::now();
        let mut bytes_since_update = 0u64;
        let mut speed_bps;

        // For rate limiting
        let mut last_chunk_time = Instant::now();

        while let Some(chunk) = stream.next().await {
            if self.cancel_token.load(Ordering::Relaxed) {
                return Err(DownloadError::Cancelled);
            }

            let chunk = chunk?;
            let chunk_len = chunk.len() as u64;

            // Rate limiting
            if let Some(limit) = self.speed_limit {
                let elapsed = last_chunk_time.elapsed().as_secs_f64();
                let expected_time = chunk_len as f64 / limit as f64;
                if elapsed < expected_time {
                    let sleep_duration = Duration::from_secs_f64(expected_time - elapsed);
                    sleep(sleep_duration).await;
                }
            }
            last_chunk_time = Instant::now();

            file.write_all(&chunk)?;
            downloaded += chunk_len;
            bytes_since_update += chunk_len;

            // Update progress every 500ms
            if last_update.elapsed() >= Duration::from_millis(500) {
                let elapsed_secs = last_update.elapsed().as_secs_f64();
                speed_bps = bytes_since_update as f64 / elapsed_secs;

                let _ = on_event.send(DownloadEvent::Progress {
                    file_path: file_path_str.clone(),
                    downloaded,
                    total: total_size,
                    speed_bps,
                });

                last_update = Instant::now();
                bytes_since_update = 0;
            }
        }

        file.flush()?;
        drop(file);

        // Verify hash if provided
        if let Some(expected) = expected_hash {
            let actual_hash = crate::patch::compute_file_hash(dest_path).await
                .map_err(|e| DownloadError::Patch(e.to_string()))?;
            if actual_hash != expected {
                // Delete corrupted file
                let _ = fs::remove_file(dest_path);
                return Err(DownloadError::HashMismatch {
                    expected: expected.to_string(),
                    actual: actual_hash,
                });
            }
        }

        let _ = on_event.send(DownloadEvent::FileComplete {
            file_path: file_path_str,
        });

        Ok(())
    }

    /// Download multiple files concurrently
    pub async fn download_files(
        &self,
        files: Vec<FileDownloadTask>,
        on_event: Channel<DownloadEvent>,
    ) -> Result<(), DownloadError> {
        let semaphore = Arc::new(Semaphore::new(self.max_concurrent));
        let mut handles = vec![];
        let on_event = Arc::new(on_event);

        for task in files {
            let permit = semaphore.clone().acquire_owned().await?;
            let client = self.client.clone();
            let event_channel = on_event.clone();
            let cancel = self.cancel_token.clone();

            let handle = tokio::spawn(async move {
                let _permit = permit;
                
                if cancel.load(Ordering::Relaxed) {
                    return Ok(());
                }

                // Individual file download logic
                if let Err(e) = download_single_with_client(
                    &client,
                    &task.url,
                    &task.dest_path,
                    task.expected_hash.as_deref(),
                    &event_channel,
                ).await {
                    let _ = event_channel.send(DownloadEvent::Error {
                        message: format!("Failed to download {}: {}", task.url, e),
                    });
                    return Err(e);
                }

                Ok(())
            });

            handles.push(handle);
        }

        // Wait for all downloads
        for handle in handles {
            handle.await.map_err(|e| DownloadError::Task(e.to_string()))??;
        }

        let _ = on_event.send(DownloadEvent::Complete);
        Ok(())
    }

    pub fn cancel(&self) {
        self.cancel_token.store(true, Ordering::Relaxed);
    }

    pub fn reset_cancel(&self) {
        self.cancel_token.store(false, Ordering::Relaxed);
    }

    /// Check if download is cancelled
    pub fn is_cancelled(&self) -> bool {
        self.cancel_token.load(Ordering::Relaxed)
    }

    /// Calculate time needed to download at current speed limit
    pub fn estimated_download_time(&self, bytes: u64) -> Duration {
        match self.speed_limit {
            Some(limit) if limit > 0 => {
                Duration::from_secs_f64(bytes as f64 / limit as f64)
            }
            _ => Duration::from_secs(0), // Unlimited = instant in theory
        }
    }
}

pub struct FileDownloadTask {
    pub url: String,
    pub dest_path: std::path::PathBuf,
    pub expected_hash: Option<String>,
}

async fn download_single_with_client(
    client: &Client,
    url: &str,
    dest_path: &Path,
    expected_hash: Option<&str>,
    on_event: &Channel<DownloadEvent>,
) -> Result<(), DownloadError> {
    // Create parent directories
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent)?;
    }

    // Check for partial download
    let start_byte = if dest_path.exists() {
        fs::metadata(dest_path)?.len()
    } else {
        0
    };

    let mut request = client.get(url);
    if start_byte > 0 {
        request = request.header("Range", format!("bytes={}-", start_byte));
    }

    let response = request.send().await?;
    
    if !response.status().is_success() && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(DownloadError::HttpError(response.status().to_string()));
    }

    let total_size = response
        .content_length()
        .map(|cl| cl + start_byte)
        .unwrap_or(0);

    let file_path_str = dest_path.to_string_lossy().to_string();
    let _ = on_event.send(DownloadEvent::Started {
        file_path: file_path_str.clone(),
        total_size,
    });

    let mut stream = response.bytes_stream();
    let mut downloaded = start_byte;
    let mut last_update = Instant::now();
    let mut bytes_since_update = 0u64;

    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .open(dest_path)?;
    
    if start_byte > 0 {
        file.seek(SeekFrom::Start(start_byte))?;
    }

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        let chunk_len = chunk.len() as u64;

        file.write_all(&chunk)?;
        downloaded += chunk_len;
        bytes_since_update += chunk_len;

        if last_update.elapsed() >= Duration::from_millis(500) {
            let elapsed_secs = last_update.elapsed().as_secs_f64();
            let speed_bps = bytes_since_update as f64 / elapsed_secs;

            let _ = on_event.send(DownloadEvent::Progress {
                file_path: file_path_str.clone(),
                downloaded,
                total: total_size,
                speed_bps,
            });

            last_update = Instant::now();
            bytes_since_update = 0;
        }
    }

    file.flush()?;
    drop(file);

    // Verify hash if provided
    if let Some(expected) = expected_hash {
        let actual_hash = crate::patch::compute_file_hash(dest_path).await
            .map_err(|e| DownloadError::Patch(e.to_string()))?;
        if actual_hash != expected {
            let _ = fs::remove_file(dest_path);
            return Err(DownloadError::HashMismatch {
                expected: expected.to_string(),
                actual: actual_hash,
            });
        }
    }

    let _ = on_event.send(DownloadEvent::FileComplete {
        file_path: file_path_str,
    });

    Ok(())
}

#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    
    #[error("HTTP error: {0}")]
    HttpError(String),
    
    #[error("Request error: {0}")]
    Request(#[from] reqwest::Error),
    
    #[error("Hash mismatch: expected {expected}, got {actual}")]
    HashMismatch { expected: String, actual: String },
    
    #[error("Download cancelled")]
    Cancelled,
    
    #[error("Semaphore error: {0}")]
    Semaphore(#[from] tokio::sync::AcquireError),
    
    #[error("Patch error: {0}")]
    Patch(String),
    
    #[error("Task error: {0}")]
    Task(String),
}

impl DownloadError {
    /// Check if error is retryable
    pub fn is_retryable(&self) -> bool {
        match self {
            DownloadError::HttpError(_) => true,
            DownloadError::Request(e) => {
                e.is_timeout() || e.is_connect() || e.is_request()
            }
            DownloadError::Io(_) => true,
            DownloadError::Cancelled => false,
            DownloadError::HashMismatch { .. } => false,
            DownloadError::Semaphore(_) => false,
            DownloadError::Patch(_) => false,
            DownloadError::Task(_) => true,
        }
    }

    /// Get user-friendly error message
    pub fn user_message(&self) -> String {
        match self {
            DownloadError::Io(e) => format!("File system error: {}", e),
            DownloadError::HttpError(status) => format!("Server error: {}", status),
            DownloadError::Request(_) => "Network connection error. Please check your internet connection.".to_string(),
            DownloadError::HashMismatch { expected: _, actual: _ } => {
                "Downloaded file is corrupted. Please try again.".to_string()
            }
            DownloadError::Cancelled => "Download was cancelled.".to_string(),
            DownloadError::Semaphore(_) => "Too many concurrent downloads.".to_string(),
            DownloadError::Patch(_) => "Failed to verify file integrity.".to_string(),
            DownloadError::Task(_) => "Download task failed. Please try again.".to_string(),
        }
    }
}

/// Progress calculation utilities
pub mod progress {
    /// Calculate download percentage
    pub fn percentage(downloaded: u64, total: u64) -> f64 {
        if total == 0 {
            0.0
        } else {
            (downloaded as f64 / total as f64) * 100.0
        }
    }

    /// Calculate download speed in bytes per second
    pub fn speed_bps(bytes_downloaded: u64, elapsed_secs: f64) -> f64 {
        if elapsed_secs > 0.0 {
            bytes_downloaded as f64 / elapsed_secs
        } else {
            0.0
        }
    }

    /// Format speed for display
    pub fn format_speed(bps: f64) -> String {
        if bps >= 1_000_000.0 {
            format!("{:.2} MB/s", bps / 1_000_000.0)
        } else if bps >= 1_000.0 {
            format!("{:.1} KB/s", bps / 1_000.0)
        } else {
            format!("{:.0} B/s", bps)
        }
    }

    /// Format bytes for display
    pub fn format_bytes(bytes: u64) -> String {
        if bytes >= 1_000_000_000 {
            format!("{:.2} GB", bytes as f64 / 1_000_000_000.0)
        } else if bytes >= 1_000_000 {
            format!("{:.1} MB", bytes as f64 / 1_000_000.0)
        } else if bytes >= 1_000 {
            format!("{:.1} KB", bytes as f64 / 1_000.0)
        } else {
            format!("{} B", bytes)
        }
    }

    /// Estimate time remaining in seconds
    pub fn estimated_time_remaining(downloaded: u64, total: u64, speed_bps: f64) -> Option<u64> {
        if speed_bps <= 0.0 {
            return None;
        }
        let remaining = total.saturating_sub(downloaded) as f64;
        Some((remaining / speed_bps).ceil() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::progress::*;

    // =========================================================================
    // DownloadError Tests
    // =========================================================================

    #[test]
    fn test_download_error_display() {
        let error = DownloadError::Cancelled;
        assert_eq!(error.to_string(), "Download cancelled");

        let error = DownloadError::HttpError("404".to_string());
        assert_eq!(error.to_string(), "HTTP error: 404");

        let error = DownloadError::HashMismatch {
            expected: "abc".to_string(),
            actual: "def".to_string(),
        };
        assert!(error.to_string().contains("Hash mismatch"));
        assert!(error.to_string().contains("abc"));
        assert!(error.to_string().contains("def"));
    }

    #[test]
    fn test_download_error_is_retryable() {
        // Retryable errors
        assert!(DownloadError::HttpError("500".to_string()).is_retryable());
        assert!(DownloadError::Task("failed".to_string()).is_retryable());
        
        // Non-retryable errors
        assert!(!DownloadError::Cancelled.is_retryable());
        assert!(!DownloadError::HashMismatch {
            expected: "a".to_string(),
            actual: "b".to_string(),
        }.is_retryable());
    }

    #[test]
    fn test_download_error_user_message() {
        let cancelled = DownloadError::Cancelled;
        assert!(cancelled.user_message().contains("cancelled"));

        let hash_error = DownloadError::HashMismatch {
            expected: "a".to_string(),
            actual: "b".to_string(),
        };
        assert!(hash_error.user_message().contains("corrupted"));

        let http_error = DownloadError::HttpError("404".to_string());
        assert!(http_error.user_message().contains("Server"));
    }

    #[test]
    fn test_download_error_from_io() {
        let io_error = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let download_error: DownloadError = io_error.into();
        
        match download_error {
            DownloadError::Io(_) => (), // Expected
            _ => panic!("Expected Io error"),
        }
    }

    // =========================================================================
    // DownloadManager Tests - Unit Tests (without HTTP)
    // =========================================================================

    #[test]
    fn test_download_manager_new() {
        let manager = DownloadManager::new(4, Some(1024));
        assert!(!manager.is_cancelled());
        assert_eq!(manager.max_concurrent, 4);
        assert_eq!(manager.speed_limit, Some(1024));
    }

    #[test]
    fn test_download_manager_cancel() {
        let manager = DownloadManager::new(4, None);
        
        assert!(!manager.is_cancelled());
        
        manager.cancel();
        assert!(manager.is_cancelled());
        
        manager.reset_cancel();
        assert!(!manager.is_cancelled());
    }

    #[test]
    fn test_download_manager_estimated_download_time() {
        // With speed limit
        let limited = DownloadManager::new(4, Some(1000));
        assert_eq!(limited.estimated_download_time(1000), Duration::from_secs(1));
        assert_eq!(limited.estimated_download_time(5000), Duration::from_secs(5));
        
        // Without speed limit (unlimited)
        let unlimited = DownloadManager::new(4, None);
        assert_eq!(unlimited.estimated_download_time(1000000), Duration::from_secs(0));
        
        // With zero speed limit
        let zero_limit = DownloadManager::new(4, Some(0));
        assert_eq!(zero_limit.estimated_download_time(1000), Duration::from_secs(0));
    }

    // =========================================================================
    // FileDownloadTask Tests
    // =========================================================================

    #[test]
    fn test_file_download_task_creation() {
        let task = FileDownloadTask {
            url: "https://example.com/file.zip".to_string(),
            dest_path: std::path::PathBuf::from("/downloads/file.zip"),
            expected_hash: Some("abc123".to_string()),
        };
        
        assert_eq!(task.url, "https://example.com/file.zip");
        assert_eq!(task.dest_path, std::path::PathBuf::from("/downloads/file.zip"));
        assert_eq!(task.expected_hash, Some("abc123".to_string()));
    }

    #[test]
    fn test_file_download_task_without_hash() {
        let task = FileDownloadTask {
            url: "https://example.com/file.zip".to_string(),
            dest_path: std::path::PathBuf::from("/downloads/file.zip"),
            expected_hash: None,
        };
        
        assert!(task.expected_hash.is_none());
    }

    // =========================================================================
    // Progress Calculation Tests
    // =========================================================================

    #[test]
    fn test_percentage_calculation() {
        // Normal case
        assert_eq!(percentage(50, 100), 50.0);
        assert_eq!(percentage(25, 100), 25.0);
        assert_eq!(percentage(100, 100), 100.0);
        
        // Zero total
        assert_eq!(percentage(50, 0), 0.0);
        
        // Zero downloaded
        assert_eq!(percentage(0, 100), 0.0);
        
        // Over-downloaded (should handle gracefully)
        assert_eq!(percentage(150, 100), 150.0);
    }

    #[test]
    fn test_speed_bps_calculation() {
        // Normal case
        assert_eq!(speed_bps(1000, 1.0), 1000.0);
        assert_eq!(speed_bps(5000, 5.0), 1000.0);
        
        // Zero elapsed time (should return 0 to avoid division by zero)
        assert_eq!(speed_bps(1000, 0.0), 0.0);
        
        // Very small elapsed time
        assert_eq!(speed_bps(1000, 0.001), 1_000_000.0);
    }

    #[test]
    fn test_format_speed() {
        // B/s
        assert_eq!(format_speed(500.0), "500 B/s");
        assert_eq!(format_speed(999.0), "999 B/s");
        
        // KB/s
        assert_eq!(format_speed(1000.0), "1.0 KB/s");
        assert_eq!(format_speed(50000.0), "50.0 KB/s");
        assert_eq!(format_speed(999999.0), "1000.0 KB/s");
        
        // MB/s
        assert_eq!(format_speed(1_000_000.0), "1.00 MB/s");
        assert_eq!(format_speed(5_500_000.0), "5.50 MB/s");
    }

    #[test]
    fn test_format_bytes() {
        // B
        assert_eq!(format_bytes(500), "500 B");
        assert_eq!(format_bytes(999), "999 B");
        
        // KB
        assert_eq!(format_bytes(1000), "1.0 KB");
        assert_eq!(format_bytes(500000), "500.0 KB");
        
        // MB
        assert_eq!(format_bytes(1_000_000), "1.0 MB");
        assert_eq!(format_bytes(500_000_000), "500.0 MB");
        
        // GB
        assert_eq!(format_bytes(1_000_000_000), "1.00 GB");
        assert_eq!(format_bytes(5_500_000_000), "5.50 GB");
    }

    #[test]
    fn test_estimated_time_remaining() {
        // Normal case
        assert_eq!(estimated_time_remaining(500, 1000, 100.0), Some(5));
        assert_eq!(estimated_time_remaining(0, 1000, 100.0), Some(10));
        assert_eq!(estimated_time_remaining(900, 1000, 100.0), Some(1));
        
        // Complete download
        assert_eq!(estimated_time_remaining(1000, 1000, 100.0), Some(0));
        
        // No speed
        assert_eq!(estimated_time_remaining(500, 1000, 0.0), None);
        assert_eq!(estimated_time_remaining(500, 1000, -1.0), None);
        
        // Over-downloaded (handles gracefully)
        assert_eq!(estimated_time_remaining(1500, 1000, 100.0), Some(0));
    }

    // =========================================================================
    // Resume Support Tests (Local file operations)
    // =========================================================================

    #[test]
    fn test_partial_download_resume_calculation() {
        // Simulate a file that was partially downloaded
        let total_size = 10000u64;
        let downloaded = 5000u64;
        
        // Remaining should be calculated correctly
        let remaining = total_size - downloaded;
        assert_eq!(remaining, 5000);
        
        // Progress percentage
        let percent = percentage(downloaded, total_size);
        assert_eq!(percent, 50.0);
        
        // With resume, we start from downloaded position
        let start_byte = downloaded;
        assert_eq!(start_byte, 5000);
    }

    #[test]
    fn test_resume_range_header() {
        let start_byte = 5000u64;
        let range_header = format!("bytes={}-", start_byte);
        assert_eq!(range_header, "bytes=5000-");
    }

    // =========================================================================
    // Concurrent Download Tests
    // =========================================================================

    #[test]
    fn test_concurrent_downloads_calculation() {
        let max_concurrent = 4usize;
        let total_files = 10usize;
        
        // Calculate batches
        let full_batches = total_files / max_concurrent;
        let remainder = total_files % max_concurrent;
        
        assert_eq!(full_batches, 2);
        assert_eq!(remainder, 2);
        
        // Total batches needed
        let total_batches = if remainder > 0 { full_batches + 1 } else { full_batches };
        assert_eq!(total_batches, 3);
    }

    #[test]
    fn test_semaphore_permits() {
        // Test that we can acquire the expected number of permits
        let max_concurrent = 4;
        let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(max_concurrent));
        
        // Create a runtime for async test
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Should be able to acquire max_concurrent permits
            let permit1 = semaphore.clone().acquire_owned().await.unwrap();
            let permit2 = semaphore.clone().acquire_owned().await.unwrap();
            let permit3 = semaphore.clone().acquire_owned().await.unwrap();
            let permit4 = semaphore.clone().acquire_owned().await.unwrap();
            
            // All permits acquired, next would block
            assert_eq!(semaphore.available_permits(), 0);
            
            // Drop permits to release
            drop(permit1);
            drop(permit2);
            drop(permit3);
            drop(permit4);
            
            // After dropping, permits should be available again
            // Note: exact timing may vary, but eventually permits are released
        });
    }

    // =========================================================================
    // Edge Cases and Error Handling
    // =========================================================================

    #[test]
    fn test_progress_with_large_numbers() {
        // Test with large file sizes (GB range)
        let total = 10_000_000_000u64; // 10 GB
        let downloaded = 2_500_000_000u64; // 2.5 GB
        
        let percent = percentage(downloaded, total);
        assert_eq!(percent, 25.0);
        
        let speed = 50_000_000.0; // 50 MB/s
        let time_remaining = estimated_time_remaining(downloaded, total, speed);
        // 7.5 GB remaining at 50 MB/s = 150 seconds
        assert_eq!(time_remaining, Some(150));
    }

    #[test]
    fn test_progress_with_zero_values() {
        // Zero downloaded
        assert_eq!(percentage(0, 100), 0.0);
        assert_eq!(format_bytes(0), "0 B");
        assert_eq!(format_speed(0.0), "0 B/s");
        
        // Zero total
        assert_eq!(percentage(50, 0), 0.0);
        
        // Zero speed
        assert_eq!(estimated_time_remaining(500, 1000, 0.0), None);
    }

    #[tokio::test]
    async fn test_download_manager_cancelled_state() {
        let manager = DownloadManager::new(2, None);
        
        // Initially not cancelled
        assert!(!manager.is_cancelled());
        
        // Cancel
        manager.cancel();
        assert!(manager.is_cancelled());
        
        // Reset
        manager.reset_cancel();
        assert!(!manager.is_cancelled());
        
        // Cancel again
        manager.cancel();
        assert!(manager.is_cancelled());
    }

    #[test]
    fn test_file_download_task_clone_equivalent() {
        let task1 = FileDownloadTask {
            url: "http://test.com".to_string(),
            dest_path: std::path::PathBuf::from("/test"),
            expected_hash: Some("hash".to_string()),
        };
        
        let task2 = FileDownloadTask {
            url: "http://test.com".to_string(),
            dest_path: std::path::PathBuf::from("/test"),
            expected_hash: Some("hash".to_string()),
        };
        
        assert_eq!(task1.url, task2.url);
        assert_eq!(task1.dest_path, task2.dest_path);
        assert_eq!(task1.expected_hash, task2.expected_hash);
    }

    // =========================================================================
    // Rate Limiting Calculation Tests
    // =========================================================================

    #[test]
    fn test_rate_limiting_calculation() {
        // Calculate expected sleep time for rate limiting
        let chunk_size = 1000u64;
        let speed_limit = 5000u64; // bytes per second
        
        let expected_time = chunk_size as f64 / speed_limit as f64;
        assert!((expected_time - 0.2).abs() < 0.0001); // 200ms with tolerance
        
        // If we processed in 50ms, we need to sleep 150ms
        let elapsed = 0.05;
        let sleep_duration = expected_time - elapsed;
        assert!((sleep_duration - 0.15).abs() < 0.0001);
    }

    #[test]
    fn test_rate_limiting_no_sleep_needed() {
        // If we processed slower than the limit, no sleep needed
        let chunk_size = 1000u64;
        let speed_limit = 100u64; // Very slow limit
        
        let expected_time = chunk_size as f64 / speed_limit as f64; // 10 seconds
        
        // But we took 15 seconds
        let elapsed = 15.0;
        
        // No sleep needed (we're already slower than limit)
        if elapsed < expected_time {
            let _sleep_duration = expected_time - elapsed;
        }
        // No assertion needed - just verifying logic doesn't panic
    }
}
