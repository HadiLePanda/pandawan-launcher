use crate::types::{DownloadEvent, DownloadStats};
use futures_util::StreamExt;
use reqwest::Client;
use std::fs::{self, OpenOptions};
use std::io::Write;
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

const MAX_RETRIES: u32 = 3;
const INITIAL_RETRY_DELAY_MS: u64 = 500;

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

    /// Download a single file with resume support and retries
    pub async fn download_file(
        &self,
        url: &str,
        dest_path: &Path,
        expected_hash: Option<&str>,
        on_event: &Channel<DownloadEvent>,
    ) -> Result<(), DownloadError> {
        self.download_file_with_stats(url, dest_path, expected_hash, on_event, None)
            .await
    }

    /// Download a single file, tracking per-file stats and overall contribution
    async fn download_file_with_stats(
        &self,
        url: &str,
        dest_path: &Path,
        expected_hash: Option<&str>,
        on_event: &Channel<DownloadEvent>,
        stats: Option<Arc<DownloadStats>>,
    ) -> Result<(), DownloadError> {
        let mut last_error: Option<DownloadError> = None;

        for attempt in 0..MAX_RETRIES {
            if self.cancel_token.load(Ordering::Relaxed) {
                return Err(DownloadError::Cancelled);
            }

            if attempt > 0 {
                let delay = INITIAL_RETRY_DELAY_MS * 2u64.pow(attempt - 1);
                let _ = on_event.send(DownloadEvent::Retry {
                    file_path: dest_path.to_string_lossy().to_string(),
                    attempt,
                    max_attempts: MAX_RETRIES,
                    error: last_error
                        .as_ref()
                        .map(|e| e.to_string())
                        .unwrap_or_default(),
                });
                sleep(Duration::from_millis(delay)).await;
            }

            match self
                .download_file_single_attempt(
                    url,
                    dest_path,
                    expected_hash,
                    on_event,
                    stats.clone(),
                )
                .await
            {
                Ok(()) => return Ok(()),
                Err(e) if e.is_retryable() && attempt < MAX_RETRIES - 1 => {
                    last_error = Some(e);
                    continue;
                }
                Err(e) => return Err(e),
            }
        }

        Err(last_error.unwrap_or(DownloadError::Cancelled))
    }

    /// Single attempt at downloading a file
    async fn download_file_single_attempt(
        &self,
        url: &str,
        dest_path: &Path,
        expected_hash: Option<&str>,
        on_event: &Channel<DownloadEvent>,
        stats: Option<Arc<DownloadStats>>,
    ) -> Result<(), DownloadError> {
        // Create parent directories
        if let Some(parent) = dest_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // Determine existing partial size for resume header
        let start_byte = if dest_path.exists() {
            fs::metadata(dest_path)?.len()
        } else {
            0
        };

        // Build request with resume header
        if self.cancel_token.load(Ordering::Relaxed) {
            return Err(DownloadError::Cancelled);
        }

        let mut request = self.client.get(url);
        if start_byte > 0 {
            request = request.header("Range", format!("bytes={}-", start_byte));
        }

        if self.cancel_token.load(Ordering::Relaxed) {
            return Err(DownloadError::Cancelled);
        }

        let response = request.send().await?;
        let status = response.status();

        if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(DownloadError::HttpError(status.to_string()));
        }

        let is_partial = status == reqwest::StatusCode::PARTIAL_CONTENT;

        // Open the destination: truncate for a full response, append only for a real partial response
        let mut file = if is_partial && start_byte > 0 {
            OpenOptions::new()
                .append(true)
                .open(dest_path)?
        } else {
            OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(dest_path)?
        };

        let total_size = if is_partial {
            response
                .content_length()
                .map(|cl| cl + start_byte)
                .unwrap_or(start_byte)
        } else {
            response.content_length().unwrap_or(0)
        };

        let file_path_str = dest_path.to_string_lossy().to_string();
        let _ = on_event.send(DownloadEvent::Started {
            file_path: file_path_str.clone(),
            total_size,
            file_index: stats.as_ref().map(|s| s.file_index()).unwrap_or(0),
            total_files: stats.as_ref().map(|s| s.total_files()).unwrap_or(0),
        });

        let mut stream = response.bytes_stream();
        let mut downloaded = start_byte;
        let mut last_update = Instant::now();
        let mut bytes_since_update = 0u64;

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

            if let Some(ref s) = stats {
                s.add_downloaded(chunk_len);
            }

            if last_update.elapsed() >= Duration::from_millis(500) {
                let elapsed_secs = last_update.elapsed().as_secs_f64();
                let speed_bps = bytes_since_update as f64 / elapsed_secs;

                let _ = on_event.send(DownloadEvent::Progress {
                    file_path: file_path_str.clone(),
                    downloaded,
                    total: total_size,
                    speed_bps,
                    overall_downloaded: stats.as_ref().map(|s| s.downloaded()),
                    overall_total: stats.as_ref().map(|s| s.total()),
                    completed_files: stats.as_ref().map(|s| s.completed()),
                    total_files: stats.as_ref().map(|s| s.total_files()),
                    current_file: Some(file_path_str.clone()),
                });

                last_update = Instant::now();
                bytes_since_update = 0;
            }
        }

        file.flush()?;
        drop(file);

        // Verify hash if provided
        if let Some(expected) = expected_hash {
            let actual_hash = crate::patch::compute_file_hash(dest_path)
                .await
                .map_err(|e| DownloadError::Patch(e.to_string()))?;
            if actual_hash != expected {
                let _ = fs::remove_file(dest_path);
                return Err(DownloadError::HashMismatch {
                    expected: expected.to_string(),
                    actual: actual_hash,
                });
            }
        }

        if let Some(ref s) = stats {
            s.increment_completed();
        }

        let _ = on_event.send(DownloadEvent::FileComplete {
            file_path: file_path_str,
            completed_files: stats.as_ref().map(|s| s.completed()),
            total_files: stats.as_ref().map(|s| s.total_files()),
        });

        Ok(())
    }

    /// Download multiple files concurrently with retry support and overall progress
    pub async fn download_files(
        &self,
        files: Vec<FileDownloadTask>,
        on_event: Channel<DownloadEvent>,
    ) -> Result<(), DownloadError> {
        let client = self.client.clone();
        let cancel = self.cancel_token.clone();
        let max_concurrent = self.max_concurrent;
        let speed_limit = self.speed_limit;
        let on_event = Arc::new(on_event);
        let total_bytes: u64 = files.iter().map(|f| f.size).sum();
        let total_files = files.len();
        let stats = Arc::new(DownloadStats::new(total_bytes, total_files));
        let semaphore = Arc::new(Semaphore::new(max_concurrent));

        let mut handles = vec![];

        for (index, task) in files.into_iter().enumerate() {
            let permit = semaphore.clone().acquire_owned().await?;
            let event_channel = on_event.clone();
            let cancel = cancel.clone();
            let stats = Arc::clone(&stats);
            let task_stats = Arc::clone(&stats);
            let client = client.clone();

            let handle = tokio::spawn(async move {
                let _permit = permit;

                if cancel.load(Ordering::Relaxed) {
                    return Ok(());
                }

                task_stats.set_file_index(index);

                let dm = DownloadManager {
                    client,
                    max_concurrent,
                    speed_limit,
                    cancel_token: cancel,
                };

                if let Err(e) = dm
                    .download_file_with_stats(
                        &task.url,
                        &task.dest_path,
                        task.expected_hash.as_deref(),
                        &event_channel,
                        Some(stats),
                    )
                    .await
                {
                    let _ = event_channel.send(DownloadEvent::Error {
                        message: format!("Failed to download {}: {}", task.url, e),
                    });
                    return Err(e);
                }

                Ok(())
            });

            handles.push(handle);
        }

        for handle in handles {
            handle
                .await
                .map_err(|e| DownloadError::Task(e.to_string()))??;
        }

        let _ = on_event.send(DownloadEvent::Complete {
            completed_files: stats.completed(),
            total_files: stats.total_files(),
        });
        Ok(())
    }

    pub fn cancel(&self) {
        self.cancel_token.store(true, Ordering::Relaxed);
    }

    pub fn reset_cancel(&self) {
        self.cancel_token.store(false, Ordering::Relaxed);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancel_token.load(Ordering::Relaxed)
    }

    pub fn estimated_download_time(&self, bytes: u64) -> Duration {
        match self.speed_limit {
            Some(limit) if limit > 0 => Duration::from_secs_f64(bytes as f64 / limit as f64),
            _ => Duration::from_secs(0),
        }
    }
}

pub struct FileDownloadTask {
    pub url: String,
    pub dest_path: std::path::PathBuf,
    pub expected_hash: Option<String>,
    pub size: u64,
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
    pub fn is_retryable(&self) -> bool {
        match self {
            DownloadError::HttpError(_) => true,
            DownloadError::Request(e) => e.is_timeout() || e.is_connect() || e.is_request(),
            DownloadError::Io(_) => true,
            DownloadError::Cancelled => false,
            DownloadError::HashMismatch { .. } => false,
            DownloadError::Semaphore(_) => false,
            DownloadError::Patch(_) => false,
            DownloadError::Task(_) => true,
        }
    }

    pub fn user_message(&self) -> String {
        match self {
            DownloadError::Io(e) => format!("File system error: {}", e),
            DownloadError::HttpError(status) => format!("Server error: {}", status),
            DownloadError::Request(_) => {
                "Network connection error. Please check your internet connection.".to_string()
            }
            DownloadError::HashMismatch {
                expected: _,
                actual: _,
            } => "Downloaded file is corrupted. Please try again.".to_string(),
            DownloadError::Cancelled => "Download was cancelled.".to_string(),
            DownloadError::Semaphore(_) => "Too many concurrent downloads.".to_string(),
            DownloadError::Patch(_) => "Failed to verify file integrity.".to_string(),
            DownloadError::Task(_) => "Download task failed. Please try again.".to_string(),
        }
    }
}

/// Progress calculation utilities
pub mod progress {
    pub fn percentage(downloaded: u64, total: u64) -> f64 {
        if total == 0 {
            0.0
        } else {
            (downloaded as f64 / total as f64) * 100.0
        }
    }

    pub fn speed_bps(bytes_downloaded: u64, elapsed_secs: f64) -> f64 {
        if elapsed_secs > 0.0 {
            bytes_downloaded as f64 / elapsed_secs
        } else {
            0.0
        }
    }

    pub fn format_speed(bps: f64) -> String {
        if bps >= 1_000_000.0 {
            format!("{:.2} MB/s", bps / 1_000_000.0)
        } else if bps >= 1_000.0 {
            format!("{:.1} KB/s", bps / 1_000.0)
        } else {
            format!("{:.0} B/s", bps)
        }
    }

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
    use super::progress::*;
    use super::*;

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
        assert!(DownloadError::HttpError("500".to_string()).is_retryable());
        assert!(DownloadError::Task("failed".to_string()).is_retryable());

        assert!(!DownloadError::Cancelled.is_retryable());
        assert!(!DownloadError::HashMismatch {
            expected: "a".to_string(),
            actual: "b".to_string(),
        }
        .is_retryable());
    }

    #[test]
    fn test_progress_percentage() {
        assert_eq!(percentage(0, 100), 0.0);
        assert_eq!(percentage(50, 100), 50.0);
        assert_eq!(percentage(100, 100), 100.0);
        assert_eq!(percentage(0, 0), 0.0);
    }

    #[test]
    fn test_format_speed() {
        assert!(format_speed(1_500_000.0).contains("MB/s"));
        assert!(format_speed(1_500.0).contains("KB/s"));
        assert!(format_speed(500.0).contains("B/s"));
    }

    #[test]
    fn test_format_bytes() {
        assert!(format_bytes(1_500_000_000).contains("GB"));
        assert!(format_bytes(1_500_000).contains("MB"));
        assert!(format_bytes(1_500).contains("KB"));
        assert!(format_bytes(500).contains("B"));
    }

    #[test]
    fn test_estimated_time_remaining() {
        assert_eq!(estimated_time_remaining(0, 100, 10.0), Some(10));
        assert_eq!(estimated_time_remaining(50, 100, 25.0), Some(2));
        assert_eq!(estimated_time_remaining(0, 100, 0.0), None);
    }

    #[test]
    fn test_download_stats() {
        let stats = DownloadStats::new(1000, 5);
        assert_eq!(stats.total(), 1000);
        assert_eq!(stats.total_files(), 5);
        assert_eq!(stats.completed(), 0);
        stats.add_downloaded(250);
        assert_eq!(stats.downloaded(), 250);
        stats.increment_completed();
        assert_eq!(stats.completed(), 1);
    }
}
