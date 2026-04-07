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
        let (mut start_byte, mut file) = if dest_path.exists() {
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
        let mut speed_bps = 0.0;

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
