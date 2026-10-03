use crate::types::{DownloadEvent, DownloadStats, LauncherError};
use futures_util::StreamExt;
use reqwest::Client;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tokio::io::AsyncWriteExt;
use tokio::sync::Semaphore;
use tokio::time::sleep;

pub struct DownloadManager {
    client: Client,
    max_concurrent: usize,
    speed_limit: Option<u64>, // bytes per second
    cancel_token: Arc<AtomicBool>,
    rate_limiter: Option<Arc<RateLimiter>>,
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

        let rate_limiter = speed_limit
            .filter(|l| *l > 0)
            .map(|l| Arc::new(RateLimiter::new(l)));

        Self {
            client,
            max_concurrent,
            speed_limit,
            cancel_token: Arc::new(AtomicBool::new(false)),
            rate_limiter,
        }
    }

    /// Replace the limits a future batch will run under.
    ///
    /// A batch in flight captured the old values, so this only decides what the
    /// next one gets; nothing already running is disturbed.
    pub fn set_limits(&mut self, max_concurrent: usize, speed_limit: Option<u64>) {
        self.max_concurrent = max_concurrent;
        self.speed_limit = speed_limit;
        self.rate_limiter = speed_limit
            .filter(|l| *l > 0)
            .map(|l| Arc::new(RateLimiter::new(l)));
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

    async fn download_file_single_attempt(
        &self,
        url: &str,
        dest_path: &Path,
        expected_hash: Option<&str>,
        on_event: &Channel<DownloadEvent>,
        stats: Option<Arc<DownloadStats>>,
    ) -> Result<(), DownloadError> {
        if let Some(parent) = dest_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let start_byte = match tokio::fs::metadata(dest_path).await {
            Ok(meta) => meta.len(),
            Err(e) if e.kind() == ErrorKind::NotFound => 0,
            Err(e) => return Err(e.into()),
        };

        if self.cancel_token.load(Ordering::Relaxed) {
            return Err(DownloadError::Cancelled);
        }

        let mut request = self.client.get(url);
        if let Some(range) = resume_range(start_byte) {
            request = request.header("Range", range);
        }

        if self.cancel_token.load(Ordering::Relaxed) {
            return Err(DownloadError::Cancelled);
        }

        let response = request.send().await?;
        let status = response.status();

        if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
            // 416 means the local file is already at or past the server's length, so
            // the resume it asked for is unsatisfiable. Left alone the install is
            // permanently unrepairable: every retry sends the same Range against the
            // same too-long file. Deleting it makes the next attempt start from
            // zero, which is why 416 counts as retryable.
            if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && start_byte > 0 {
                let _ = tokio::fs::remove_file(dest_path).await;
            }
            return Err(DownloadError::HttpError(status));
        }

        let is_partial = status == reqwest::StatusCode::PARTIAL_CONTENT;

        // Open the destination: truncate for a full response, append only for a real partial response
        let mut file = if is_partial && start_byte > 0 {
            tokio::fs::OpenOptions::new()
                .append(true)
                .open(dest_path)
                .await?
        } else {
            tokio::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(dest_path)
                .await?
        };

        // Unix builds need the executable bit before the game can be spawned at
        // all. OpenOptions creates with the process umask, so a downloaded binary
        // lands as 0644 and Command::spawn fails with "Permission denied". Windows
        // ignores this, so it is applied only where it means something.
        //
        // `#[cfg(unix)]` is invisible to a Windows build: this code is not
        // compiled until a macOS or Linux runner builds it.
        #[cfg(unix)]
        {
            let mut perms = tokio::fs::metadata(dest_path).await?.permissions();
            perms.set_mode(perms.mode() | 0o755);
            tokio::fs::set_permissions(dest_path, perms).await?;
        }

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
            // Ship the running totals here too. Most files finish inside the
            // progress throttle below and never emit Progress, so this is the
            // only way the client learns the bar moved for them.
            overall_downloaded: stats.as_ref().map(|s| s.downloaded()),
            overall_total: stats.as_ref().map(|s| s.total()),
        });

        let mut stream = response.bytes_stream();
        let mut downloaded = start_byte;
        let mut last_update = Instant::now();
        let mut bytes_since_update = 0u64;

        while let Some(chunk) = stream.next().await {
            if self.cancel_token.load(Ordering::Relaxed) {
                return Err(DownloadError::Cancelled);
            }

            let chunk = chunk?;
            let chunk_len = chunk.len() as u64;

            if let Some(ref limiter) = self.rate_limiter {
                limiter.consume(chunk_len).await;
            }

            file.write_all(&chunk).await?;
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

        file.flush().await?;
        file.sync_all().await?;

        if let Some(expected) = expected_hash {
            let actual_hash = crate::patch::compute_file_hash(dest_path)
                .await
                .map_err(|e| DownloadError::Patch(e.to_string()))?;
            if actual_hash != expected {
                let _ = tokio::fs::remove_file(dest_path).await;
                return Err(DownloadError::HashMismatch {
                    expected: expected.to_string(),
                    actual: actual_hash,
                });
            }
        }

        if let Some(ref s) = stats {
            s.increment_completed();
        }

        // Reported after the completed count is incremented, so `downloaded()` already
        // includes this file's bytes.
        let _ = on_event.send(DownloadEvent::FileComplete {
            file_path: file_path_str,
            completed_files: stats.as_ref().map(|s| s.completed()),
            total_files: stats.as_ref().map(|s| s.total_files()),
            overall_downloaded: stats.as_ref().map(|s| s.downloaded()),
            overall_total: stats.as_ref().map(|s| s.total()),
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
        let rate_limiter = self.rate_limiter.clone();
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
            let rate_limiter = rate_limiter.clone();

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
                    rate_limiter,
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

        let mut first_error: Option<DownloadError> = None;
        for handle in handles {
            match handle.await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => {
                    if first_error.is_none() {
                        first_error = Some(e);
                    }
                }
                Err(e) => {
                    if first_error.is_none() {
                        first_error = Some(DownloadError::Task(e.to_string()));
                    }
                }
            }
        }

        if let Some(e) = first_error {
            let _ = on_event.send(DownloadEvent::Error {
                message: format!("Download batch failed: {}", e),
            });
            return Err(e);
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
    HttpError(reqwest::StatusCode),

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

/// True for IO conditions that may resolve themselves on retry.
fn is_retryable_io(error: &std::io::Error) -> bool {
    use std::io::ErrorKind;
    matches!(
        error.kind(),
        ErrorKind::WouldBlock
            | ErrorKind::Interrupted
            | ErrorKind::TimedOut
            | ErrorKind::NotConnected
            | ErrorKind::ConnectionRefused
            | ErrorKind::ConnectionReset
    )
}

impl DownloadError {
    pub fn is_retryable(&self) -> bool {
        match self {
            DownloadError::HttpError(status) => {
                status.is_server_error()
                                || *status == reqwest::StatusCode::TOO_MANY_REQUESTS
                                // Retrying a 416 alone cannot help: the local file is the problem,
                                // and download_file_single_attempt deletes it before returning, so
                                // the next attempt requests from zero.
                                || *status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE
            }
            DownloadError::Request(e) => e.is_timeout() || e.is_connect(),
            DownloadError::Io(e) => is_retryable_io(e),
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

impl From<DownloadError> for LauncherError {
    fn from(err: DownloadError) -> Self {
        match err {
            DownloadError::Io(e) => LauncherError::Io(e.to_string()),
            DownloadError::HttpError(status) => LauncherError::Network(status.to_string()),
            DownloadError::Request(e) => LauncherError::Network(e.to_string()),
            DownloadError::HashMismatch { expected, actual } => {
                LauncherError::Other(format!("Hash mismatch: expected {expected}, got {actual}"))
            }
            DownloadError::Cancelled => LauncherError::Other("Download cancelled".to_string()),
            DownloadError::Semaphore(e) => LauncherError::Other(e.to_string()),
            DownloadError::Patch(s) => LauncherError::Other(s),
            DownloadError::Task(s) => LauncherError::Other(s),
        }
    }
}

/// The Range header for a resume, or None when starting from zero.
///
/// A Range at 0 would make the server answer 200 with the whole file instead of
/// 206, which is the one case a fresh download must not look like.
pub fn resume_range(start_byte: u64) -> Option<String> {
    (start_byte > 0).then(|| format!("bytes={}-", start_byte))
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

/// A simple token-bucket rate limiter shared across concurrent downloads so that
/// `speed_limit` is enforced globally rather than per-connection.
pub struct RateLimiter {
    limit: f64,
    state: tokio::sync::Mutex<RateLimiterState>,
}

struct RateLimiterState {
    tokens: f64,
    last_update: Instant,
}

impl RateLimiter {
    pub fn new(limit_bytes_per_second: u64) -> Self {
        let limit = limit_bytes_per_second as f64;
        Self {
            limit,
            state: tokio::sync::Mutex::new(RateLimiterState {
                tokens: 0.0,
                last_update: Instant::now(),
            }),
        }
    }

    /// Wait until `amount` bytes can be sent without exceeding the limit.
    pub async fn consume(&self, amount: u64) {
        if amount == 0 {
            return;
        }
        let amount = amount as f64;
        loop {
            let mut state = self.state.lock().await;
            let now = Instant::now();
            let elapsed = now.duration_since(state.last_update).as_secs_f64();
            // The bucket holds up to one chunk's worth of burst, not one second's
            // worth. Capping at `limit` meant a chunk larger than the per-second
            // budget could never be satisfied: the loop woke, refilled to the same
            // ceiling, and slept again, so a 16 KB chunk at 500 B/s blocked for
            // over eight seconds and serialised every concurrent download.
            state.tokens = (state.tokens + elapsed * self.limit).min(self.limit.max(amount));
            state.last_update = now;

            if state.tokens >= amount {
                state.tokens -= amount;
                return;
            }

            let deficit = amount - state.tokens;
            let wait_secs = deficit / self.limit;
            drop(state);
            sleep(Duration::from_secs_f64(wait_secs)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::progress::*;
    use super::*;
    use reqwest::StatusCode;

    #[test]
    fn test_download_error_display() {
        let error = DownloadError::Cancelled;
        assert_eq!(error.to_string(), "Download cancelled");

        let error = DownloadError::HttpError(StatusCode::NOT_FOUND);
        assert_eq!(error.to_string(), "HTTP error: 404 Not Found");

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
        assert!(DownloadError::HttpError(StatusCode::INTERNAL_SERVER_ERROR).is_retryable());
        assert!(DownloadError::HttpError(StatusCode::TOO_MANY_REQUESTS).is_retryable());
        assert!(!DownloadError::HttpError(StatusCode::NOT_FOUND).is_retryable());
        assert!(!DownloadError::HttpError(StatusCode::FORBIDDEN).is_retryable());
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
