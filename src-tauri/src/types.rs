use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri_specta::Event;
use thiserror::Error;

#[cfg(test)]
use serde_json;

/// Game manifest from CDN
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GameManifest {
    pub game_id: String,
    pub name: String,
    pub version: String,
    #[specta(type = u32)]
    pub build_number: u64,
    /// Channel this build was published to (`stable` / `beta` / `alpha`).
    /// Defaults to `stable` so manifests generated before channels existed
    /// still load.
    #[serde(default = "default_channel")]
    pub channel: String,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub banner_url: Option<String>,
    pub executable: String,
    pub files: Vec<FileEntry>,
    pub launch_args: Option<Vec<String>>,
    /// One platform's slice of a multi-platform manifest. Each platform's files
    /// live under its own subdirectory of the version, so builds for different
    /// platforms cannot overwrite each other.
    ///
    /// Absent on single-platform manifests, which keep the top-level
    /// executable/files shape so clients built before platforms existed still
    /// load them.
    #[serde(default)]
    pub platforms: Option<HashMap<String, PlatformBuild>>,
    /// Total across all platforms, when the manifest is multi-platform.
    #[serde(default)]
    pub size_bytes: Option<u64>,
}

/// One platform's slice of a multi-platform manifest.
///
/// Mirrors the `platforms` map on `GameManifest`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PlatformBuild {
    pub executable: String,
    #[serde(default)]
    pub files: Vec<FileEntry>,
    pub base_url: Option<String>,
    #[serde(default)]
    pub size_bytes: Option<u64>,
}

/// Individual file entry in manifest
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct FileEntry {
    pub path: String,
    pub hash: String, // SHA256
    #[specta(type = u32)]
    pub size: u64,
    pub url: String,
    pub compress: Option<bool>,
}

/// Local game installation state
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GameInstallation {
    pub game_id: String,
    pub installed_version: String,
    #[specta(type = u32)]
    pub installed_build: u64,
    /// Release channel this build came from (`stable` / `beta` / `alpha`).
    ///
    /// Recorded so `needs_update` can detect a channel switch and force a
    /// re-sync even when the target build number is not higher. Defaults to
    /// `stable` for installation records written before channels existed.
    #[serde(default = "default_channel")]
    pub channel: String,
    pub install_path: PathBuf,
    pub installed_files: HashMap<String, String>, // path -> hash
    pub installed_at: chrono::DateTime<chrono::Utc>,
    pub last_played: Option<chrono::DateTime<chrono::Utc>>,
    #[specta(type = u32)]
    pub total_playtime_seconds: u64,
    pub executable: String,
}

/// Download progress event
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        file_path: String,
        #[specta(type = u32)]
        total_size: u64,
        #[specta(type = u32)]
        file_index: usize,
        #[specta(type = u32)]
        total_files: usize,
        /// Bytes already moved across the whole build, and the build's total.
        ///
        /// Carried on every event, not just `Progress`. A Unity build is a few
        /// hundred files and most are a few KB, so they finish inside the 500ms
        /// progress throttle and never emit `Progress` at all. Without these the
        /// frontend could only learn the true position on the handful of large
        /// files, which left the bar frozen between them.
        #[specta(type = Option<u32>)]
        overall_downloaded: Option<u64>,
        #[specta(type = Option<u32>)]
        overall_total: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        file_path: String,
        #[specta(type = u32)]
        downloaded: u64,
        #[specta(type = u32)]
        total: u64,
        speed_bps: f64,
        #[specta(type = Option<u32>)]
        overall_downloaded: Option<u64>,
        #[specta(type = Option<u32>)]
        overall_total: Option<u64>,
        #[specta(type = Option<u32>)]
        completed_files: Option<usize>,
        #[specta(type = Option<u32>)]
        total_files: Option<usize>,
        current_file: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    FileComplete {
        file_path: String,
        #[specta(type = Option<u32>)]
        completed_files: Option<usize>,
        #[specta(type = Option<u32>)]
        total_files: Option<usize>,
        /// Whole-build byte counts, for the same reason as on `Started`.
        #[specta(type = Option<u32>)]
        overall_downloaded: Option<u64>,
        #[specta(type = Option<u32>)]
        overall_total: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Retry {
        file_path: String,
        attempt: u32,
        max_attempts: u32,
        error: String,
    },
    #[serde(rename_all = "camelCase")]
    Complete {
        #[specta(type = u32)]
        completed_files: usize,
        #[specta(type = u32)]
        total_files: usize,
    },
    #[serde(rename_all = "camelCase")]
    Error { message: String },
}

/// Thread-safe download statistics for tracking overall progress across files
#[derive(Debug)]
pub struct DownloadStats {
    downloaded: std::sync::atomic::AtomicU64,
    total: u64,
    completed: std::sync::atomic::AtomicUsize,
    total_files: usize,
    file_index: std::sync::atomic::AtomicUsize,
}

impl DownloadStats {
    pub fn new(total: u64, total_files: usize) -> Self {
        Self {
            downloaded: std::sync::atomic::AtomicU64::new(0),
            total,
            completed: std::sync::atomic::AtomicUsize::new(0),
            total_files,
            file_index: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    pub fn add_downloaded(&self, bytes: u64) {
        self.downloaded
            .fetch_add(bytes, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn increment_completed(&self) {
        self.completed
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn set_file_index(&self, index: usize) {
        self.file_index
            .store(index, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn downloaded(&self) -> u64 {
        self.downloaded.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn total(&self) -> u64 {
        self.total
    }

    pub fn completed(&self) -> usize {
        self.completed.load(std::sync::atomic::Ordering::Relaxed)
    }

    pub fn total_files(&self) -> usize {
        self.total_files
    }

    pub fn file_index(&self) -> usize {
        self.file_index.load(std::sync::atomic::Ordering::Relaxed)
    }
}

/// Patch operation status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchStatus {
    pub game_id: String,
    pub current_version: String,
    pub target_version: String,
    pub status: PatchState,
    pub progress: PatchProgress,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PatchState {
    Idle,
    Checking,
    Downloading,
    Verifying,
    Installing,
    Complete,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PatchProgress {
    pub total_files: usize,
    pub completed_files: usize,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub current_file: Option<String>,
}

impl PatchProgress {
    /// Calculate download percentage (0.0 to 100.0)
    pub fn percentage(&self) -> f64 {
        if self.total_bytes == 0 {
            0.0
        } else {
            (self.downloaded_bytes as f64 / self.total_bytes as f64) * 100.0
        }
    }

    /// Calculate file completion percentage (0.0 to 100.0)
    pub fn file_percentage(&self) -> f64 {
        if self.total_files == 0 {
            0.0
        } else {
            (self.completed_files as f64 / self.total_files as f64) * 100.0
        }
    }

    /// Check if download is complete
    pub fn is_complete(&self) -> bool {
        self.downloaded_bytes >= self.total_bytes && self.total_bytes > 0
    }

    /// Get remaining bytes to download
    pub fn remaining_bytes(&self) -> u64 {
        self.total_bytes.saturating_sub(self.downloaded_bytes)
    }

    /// Estimate time remaining in seconds (based on current speed in bytes/sec)
    pub fn estimated_time_remaining(&self, speed_bps: f64) -> Option<u64> {
        if speed_bps <= 0.0 {
            return None;
        }
        let remaining = self.remaining_bytes() as f64;
        Some((remaining / speed_bps).ceil() as u64)
    }
}

/// Game launch result
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LaunchResult {
    pub success: bool,
    pub message: String,
    pub process_id: Option<u32>,
}

/// Emitted when a launched game process exits
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
#[tauri_specta(event_name = "game-exited")]
pub struct GameExited {
    pub game_id: String,
    #[specta(type = u32)]
    pub duration_seconds: u64,
}

/// Structured error returned by Tauri commands.
#[derive(Debug, Clone, Error, Serialize, Type)]
#[serde(tag = "code", content = "details")]
pub enum LauncherError {
    #[error("Game is not installed")]
    NotInstalled,
    #[error("Game is already running")]
    AlreadyRunning,
    #[error("Game is not running")]
    NotRunning,
    #[error("Executable not found")]
    ExecutableNotFound { path: String },
    #[error("Path is outside allowed root")]
    PathNotAllowed { path: String },
    #[error("Network request failed")]
    Network(String),
    #[error("Failed to parse manifest")]
    ManifestParse(String),
    #[error("Invalid settings")]
    Validation(String),
    #[error("IO error")]
    Io(String),
    #[error("{0}")]
    Other(String),
}

impl From<std::io::Error> for LauncherError {
    fn from(err: std::io::Error) -> Self {
        LauncherError::Io(err.to_string())
    }
}

/// Launcher settings
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(default, rename_all = "camelCase")]
pub struct LauncherSettings {
    pub games_install_path: Option<PathBuf>,
    #[specta(type = Option<u32>)]
    pub max_download_speed: Option<u64>, // bytes per second, None = unlimited
    #[specta(type = u32)]
    pub max_concurrent_downloads: usize,
    pub auto_update_games: bool,
    pub auto_update_launcher: bool,
    pub minimize_to_tray: bool,
    pub close_to_tray: bool,
    pub language: String,
    pub theme: String,
    #[serde(default = "default_true")]
    pub notify_game_updates: bool,
    #[serde(default = "default_true")]
    pub notify_download_complete: bool,
}

fn default_true() -> bool {
    true
}

/// Channel assumed when a manifest or older installation record omits one.
pub fn default_channel() -> String {
    DEFAULT_CHANNEL.to_string()
}

/// The channel a game ships on unless the publisher opts into others. Kept in
/// sync with DEFAULT_CHANNEL in src/lib/catalog-service.ts.
pub const DEFAULT_CHANNEL: &str = "stable";

/// Channels a publisher can attach to a game, ordered most to least stable.
/// Mirrors KNOWN_CHANNELS in src/lib/catalog-service.ts.
pub const KNOWN_CHANNELS: [&str; 3] = ["stable", "beta", "alpha"];

impl Default for LauncherSettings {
    fn default() -> Self {
        Self {
            games_install_path: None,
            max_download_speed: None,
            max_concurrent_downloads: 4,
            auto_update_games: true,
            auto_update_launcher: true,
            minimize_to_tray: true,
            close_to_tray: false,
            language: "en".to_string(),
            theme: "adaptive".to_string(),
            notify_game_updates: true,
            notify_download_complete: true,
        }
    }
}

impl LauncherSettings {
    /// Validate settings
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();

        if self.max_concurrent_downloads == 0 {
            errors.push("max_concurrent_downloads must be at least 1".to_string());
        }

        if self.language.is_empty() {
            errors.push("language cannot be empty".to_string());
        }

        if let Some(speed) = self.max_download_speed {
            if speed == 0 {
                errors.push("max_download_speed must be None or greater than 0".to_string());
            }
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    /// Get download speed in human-readable format
    pub fn download_speed_display(&self) -> String {
        match self.max_download_speed {
            None => "Unlimited".to_string(),
            Some(bytes_per_sec) if bytes_per_sec >= 1_000_000 => {
                format!("{:.1} MB/s", bytes_per_sec as f64 / 1_000_000.0)
            }
            Some(bytes_per_sec) if bytes_per_sec >= 1_000 => {
                format!("{:.1} KB/s", bytes_per_sec as f64 / 1_000.0)
            }
            Some(bytes_per_sec) => format!("{} B/s", bytes_per_sec),
        }
    }
}

/// Test utilities for types module
#[cfg(test)]
impl GameManifest {
    /// Create a minimal manifest for testing
    pub fn test_manifest() -> Self {
        Self {
            game_id: "test-game".to_string(),
            name: "Test Game".to_string(),
            version: "1.0.0".to_string(),
            build_number: 1,
            channel: "stable".to_string(),
            description: None,
            icon_url: None,
            banner_url: None,
            executable: "game.exe".to_string(),
            files: vec![],
            launch_args: None,
            platforms: None,
            size_bytes: None,
        }
    }

    /// Get total size of all files
    pub fn total_size(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }

    /// Check if manifest has valid file entries
    pub fn validate(&self) -> Result<(), String> {
        if self.game_id.is_empty() {
            return Err("game_id cannot be empty".to_string());
        }
        if self.version.is_empty() {
            return Err("version cannot be empty".to_string());
        }
        if self.executable.is_empty() {
            return Err("executable cannot be empty".to_string());
        }
        if self.files.is_empty() {
            return Err("files cannot be empty".to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::path::PathBuf;

    // =========================================================================
    // GameManifest Tests
    // =========================================================================

    #[test]
    fn test_game_manifest_serialization() {
        let manifest = GameManifest {
            game_id: "my-game".to_string(),
            name: "My Game".to_string(),
            version: "1.0.0".to_string(),
            build_number: 42,
            description: Some("A great game".to_string()),
            icon_url: Some("https://example.com/icon.png".to_string()),
            banner_url: None,
            executable: "game.exe".to_string(),
            files: vec![],
            launch_args: Some(vec!["--fullscreen".to_string()]),
            platforms: None,
            size_bytes: None,
            channel: "stable".to_string(),
        };

        let json = serde_json::to_string(&manifest).expect("Failed to serialize");
        assert!(json.contains("my-game"));
        assert!(json.contains("1.0.0"));
        assert!(json.contains("game.exe"));

        let deserialized: GameManifest =
            serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.game_id, manifest.game_id);
        assert_eq!(deserialized.version, manifest.version);
        assert_eq!(deserialized.build_number, manifest.build_number);
    }

    #[test]
    fn test_game_manifest_deserialization() {
        let json = r#"
        {
            "game_id": "test-game",
            "name": "Test Game",
            "version": "2.0.0",
            "build_number": 100,
            "description": "Test description",
            "executable": "run.exe",
            "files": [],
            "launch_args": ["--windowed"]
        }
        "#;

        let manifest: GameManifest = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(manifest.game_id, "test-game");
        assert_eq!(manifest.version, "2.0.0");
        assert_eq!(manifest.build_number, 100);
        assert_eq!(manifest.executable, "run.exe");
    }

    #[test]
    fn test_game_manifest_validate() {
        // Valid manifest
        let valid = GameManifest {
            game_id: "game".to_string(),
            name: "Game".to_string(),
            version: "1.0".to_string(),
            build_number: 1,
            description: None,
            icon_url: None,
            banner_url: None,
            executable: "game.exe".to_string(),
            files: vec![FileEntry {
                path: "file.txt".to_string(),
                hash: "a".repeat(64),
                size: 100,
                url: "files/file.txt".to_string(),
                compress: None,
            }],
            launch_args: None,
            platforms: None,
            size_bytes: None,
            channel: "stable".to_string(),
        };
        assert!(valid.validate().is_ok());

        // Invalid: empty game_id
        let mut invalid = valid.clone();
        invalid.game_id = "".to_string();
        assert!(invalid.validate().is_err());

        // Invalid: empty version
        let mut invalid = valid.clone();
        invalid.version = "".to_string();
        assert!(invalid.validate().is_err());

        // Invalid: empty executable
        let mut invalid = valid.clone();
        invalid.executable = "".to_string();
        assert!(invalid.validate().is_err());

        // Invalid: empty files
        let mut invalid = valid.clone();
        invalid.files = vec![];
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn test_game_manifest_total_size() {
        let manifest = GameManifest {
            game_id: "game".to_string(),
            name: "Game".to_string(),
            version: "1.0".to_string(),
            build_number: 1,
            description: None,
            icon_url: None,
            banner_url: None,
            executable: "game.exe".to_string(),
            files: vec![
                FileEntry {
                    path: "a.txt".to_string(),
                    hash: "a".repeat(64),
                    size: 100,
                    url: "a.txt".to_string(),
                    compress: None,
                },
                FileEntry {
                    path: "b.txt".to_string(),
                    hash: "b".repeat(64),
                    size: 200,
                    url: "b.txt".to_string(),
                    compress: None,
                },
            ],
            launch_args: None,
            platforms: None,
            size_bytes: None,
            channel: "stable".to_string(),
        };

        assert_eq!(manifest.total_size(), 300);
    }

    // =========================================================================
    // FileEntry Tests
    // =========================================================================

    #[test]
    fn test_file_entry_serialization() {
        let entry = FileEntry {
            path: "data/config.json".to_string(),
            hash: "abc123".repeat(8), // 64 chars
            size: 1024,
            url: "https://cdn.example.com/config.json".to_string(),
            compress: Some(true),
        };

        let json = serde_json::to_string(&entry).expect("Failed to serialize");
        let deserialized: FileEntry = serde_json::from_str(&json).expect("Failed to deserialize");

        assert_eq!(deserialized.path, entry.path);
        assert_eq!(deserialized.hash, entry.hash);
        assert_eq!(deserialized.size, entry.size);
        assert_eq!(deserialized.compress, entry.compress);
    }

    #[test]
    fn test_file_entry_optional_compress() {
        // With compress
        let json_with = r#"{"path":"file.txt","hash":"a","size":100,"url":"url","compress":true}"#;
        let entry: FileEntry = serde_json::from_str(json_with).unwrap();
        assert_eq!(entry.compress, Some(true));

        // Without compress
        let json_without = r#"{"path":"file.txt","hash":"a","size":100,"url":"url"}"#;
        let entry: FileEntry = serde_json::from_str(json_without).unwrap();
        assert_eq!(entry.compress, None);

        // With compress = null
        let json_null = r#"{"path":"file.txt","hash":"a","size":100,"url":"url","compress":null}"#;
        let entry: FileEntry = serde_json::from_str(json_null).unwrap();
        assert_eq!(entry.compress, None);
    }

    // =========================================================================
    // GameInstallation Tests
    // =========================================================================

    #[test]
    fn test_game_installation_serialization() {
        let mut files = HashMap::new();
        files.insert("game.exe".to_string(), "hash123".to_string());
        files.insert("data/file.txt".to_string(), "hash456".to_string());

        let installation = GameInstallation {
            game_id: "my-game".to_string(),
            installed_version: "1.0.0".to_string(),
            installed_build: 10,
            install_path: PathBuf::from("/games/my-game"),
            installed_files: files,
            installed_at: chrono::Utc::now(),
            last_played: Some(chrono::Utc::now()),
            total_playtime_seconds: 3600,
            executable: "game.exe".to_string(),
            channel: "stable".to_string(),
        };

        let json = serde_json::to_string(&installation).expect("Failed to serialize");
        assert!(json.contains("my-game"));
        assert!(json.contains("1.0.0"));
        assert!(json.contains("game.exe"));

        let deserialized: GameInstallation =
            serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.game_id, installation.game_id);
        assert_eq!(deserialized.installed_files.len(), 2);
    }

    #[test]
    fn test_game_installation_deserialization_with_optional_fields() {
        let json = r#"
        {
            "game_id": "test-game",
            "installed_version": "1.0.0",
            "installed_build": 5,
            "install_path": "/games/test",
            "installed_files": {},
            "installed_at": "2024-01-15T10:30:00Z",
            "last_played": null,
            "total_playtime_seconds": 0,
            "executable": "start.exe"
        }
        "#;

        let installation: GameInstallation =
            serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(installation.game_id, "test-game");
        assert!(installation.last_played.is_none());
        assert_eq!(installation.total_playtime_seconds, 0);
    }

    // =========================================================================
    // DownloadEvent Tests
    // =========================================================================

    #[test]
    fn test_download_event_started_serialization() {
        let event = DownloadEvent::Started {
            file_path: "/downloads/game.exe".to_string(),
            total_size: 1_000_000,
            file_index: 0,
            total_files: 1,
            overall_downloaded: Some(0),
            overall_total: Some(1_000_000),
        };

        let json = serde_json::to_string(&event).expect("Failed to serialize");
        assert!(json.contains("Started"));
        assert!(json.contains("filePath"));
        assert!(json.contains("/downloads/game.exe"));
        assert!(json.contains("1000000"));
    }

    #[test]
    fn test_download_event_progress_serialization() {
        let event = DownloadEvent::Progress {
            file_path: "/path/to/file.zip".to_string(),
            downloaded: 500_000,
            total: 1_000_000,
            speed_bps: 1024.5,
            overall_downloaded: Some(500_000),
            overall_total: Some(1_000_000),
            completed_files: Some(0),
            total_files: Some(1),
            current_file: Some("/path/to/file.zip".to_string()),
        };

        let json = serde_json::to_string(&event).expect("Failed to serialize");
        assert!(json.contains("Progress"));
        assert!(json.contains("speedBps"));
        assert!(json.contains("1024.5"));
    }

    #[test]
    fn test_download_event_complete_serialization() {
        let event = DownloadEvent::Complete {
            completed_files: 1,
            total_files: 1,
        };
        let json = serde_json::to_string(&event).expect("Failed to serialize");
        assert!(json.contains("Complete"));
    }

    #[test]
    fn test_download_event_error_serialization() {
        let event = DownloadEvent::Error {
            message: "Network timeout".to_string(),
        };

        let json = serde_json::to_string(&event).expect("Failed to serialize");
        assert!(json.contains("Error"));
        assert!(json.contains("Network timeout"));
    }

    #[test]
    fn test_download_event_file_complete_serialization() {
        let event = DownloadEvent::FileComplete {
            file_path: "/downloads/asset.pak".to_string(),
            completed_files: Some(1),
            total_files: Some(2),
            overall_downloaded: Some(500_000),
            overall_total: Some(2_000_000),
        };

        let json = serde_json::to_string(&event).expect("Failed to serialize");
        assert!(json.contains("FileComplete"));
        assert!(json.contains("filePath"));
    }

    // =========================================================================
    // PatchProgress Tests
    // =========================================================================

    #[test]
    fn test_patch_progress_default() {
        let progress = PatchProgress::default();
        assert_eq!(progress.total_files, 0);
        assert_eq!(progress.completed_files, 0);
        assert_eq!(progress.total_bytes, 0);
        assert_eq!(progress.downloaded_bytes, 0);
        assert!(progress.current_file.is_none());
    }

    #[test]
    fn test_patch_progress_percentage() {
        // 50% complete
        let progress = PatchProgress {
            total_files: 10,
            completed_files: 5,
            total_bytes: 1000,
            downloaded_bytes: 500,
            current_file: None,
        };
        assert_eq!(progress.percentage(), 50.0);
        assert_eq!(progress.file_percentage(), 50.0);

        // 0% when no total
        let empty = PatchProgress::default();
        assert_eq!(empty.percentage(), 0.0);
        assert_eq!(empty.file_percentage(), 0.0);

        // 100% when complete
        let complete = PatchProgress {
            total_files: 5,
            completed_files: 5,
            total_bytes: 1000,
            downloaded_bytes: 1000,
            current_file: None,
        };
        assert_eq!(complete.percentage(), 100.0);
        assert_eq!(complete.file_percentage(), 100.0);
    }

    #[test]
    fn test_patch_progress_is_complete() {
        // Not complete
        let incomplete = PatchProgress {
            total_files: 5,
            completed_files: 3,
            total_bytes: 1000,
            downloaded_bytes: 500,
            current_file: None,
        };
        assert!(!incomplete.is_complete());

        // Complete
        let complete = PatchProgress {
            total_files: 5,
            completed_files: 5,
            total_bytes: 1000,
            downloaded_bytes: 1000,
            current_file: None,
        };
        assert!(complete.is_complete());

        // Not complete when total is 0
        let zero = PatchProgress::default();
        assert!(!zero.is_complete());
    }

    #[test]
    fn test_patch_progress_remaining_bytes() {
        let progress = PatchProgress {
            total_files: 5,
            completed_files: 2,
            total_bytes: 1000,
            downloaded_bytes: 600,
            current_file: None,
        };
        assert_eq!(progress.remaining_bytes(), 400);

        // Handles underflow
        let over = PatchProgress {
            total_files: 5,
            completed_files: 5,
            total_bytes: 1000,
            downloaded_bytes: 1500,
            current_file: None,
        };
        assert_eq!(over.remaining_bytes(), 0);
    }

    #[test]
    fn test_patch_progress_estimated_time_remaining() {
        let progress = PatchProgress {
            total_files: 5,
            completed_files: 2,
            total_bytes: 1000,
            downloaded_bytes: 600,
            current_file: None,
        };

        // 400 bytes remaining at 100 bytes/sec = 4 seconds
        assert_eq!(progress.estimated_time_remaining(100.0), Some(4));

        // No speed = no estimate
        assert_eq!(progress.estimated_time_remaining(0.0), None);
        assert_eq!(progress.estimated_time_remaining(-1.0), None);
    }

    #[test]
    fn test_patch_progress_serialization() {
        let progress = PatchProgress {
            total_files: 10,
            completed_files: 5,
            total_bytes: 1000000,
            downloaded_bytes: 500000,
            current_file: Some("file.zip".to_string()),
        };

        let json = serde_json::to_string(&progress).expect("Failed to serialize");
        let deserialized: PatchProgress =
            serde_json::from_str(&json).expect("Failed to deserialize");

        assert_eq!(deserialized.total_files, progress.total_files);
        assert_eq!(deserialized.completed_files, progress.completed_files);
        assert_eq!(deserialized.current_file, progress.current_file);
    }

    // =========================================================================
    // PatchState Tests
    // =========================================================================

    #[test]
    fn test_patch_state_serialization() {
        // Test camelCase serialization
        let states = vec![
            PatchState::Idle,
            PatchState::Checking,
            PatchState::Downloading,
            PatchState::Verifying,
            PatchState::Installing,
            PatchState::Complete,
            PatchState::Error,
        ];

        for state in states {
            let json = serde_json::to_string(&state).expect("Failed to serialize");
            // Check that it's camelCase (first letter lowercase)
            let first_char = json.chars().nth(1).unwrap();
            assert!(
                first_char.is_lowercase() || !first_char.is_alphabetic(),
                "State should be camelCase: {}",
                json
            );
        }
    }

    #[test]
    fn test_patch_status_serialization() {
        let status = PatchStatus {
            game_id: "game-123".to_string(),
            current_version: "1.0.0".to_string(),
            target_version: "1.1.0".to_string(),
            status: PatchState::Downloading,
            progress: PatchProgress {
                total_files: 10,
                completed_files: 5,
                total_bytes: 1000000,
                downloaded_bytes: 500000,
                current_file: Some("update.zip".to_string()),
            },
        };

        let json = serde_json::to_string(&status).expect("Failed to serialize");
        let deserialized: PatchStatus = serde_json::from_str(&json).expect("Failed to deserialize");

        assert_eq!(deserialized.game_id, status.game_id);
        assert_eq!(deserialized.current_version, status.current_version);
        assert_eq!(deserialized.target_version, status.target_version);
    }

    // =========================================================================
    // LauncherSettings Tests
    // =========================================================================

    #[test]
    fn test_launcher_settings_default() {
        let settings = LauncherSettings::default();
        assert_eq!(settings.max_concurrent_downloads, 4);
        assert_eq!(settings.language, "en");
        assert!(settings.auto_update_games);
        assert!(settings.auto_update_launcher);
        assert!(settings.minimize_to_tray);
        assert!(!settings.close_to_tray);
        assert!(settings.max_download_speed.is_none());
        assert!(settings.games_install_path.is_none());
        assert!(settings.notify_game_updates);
        assert!(settings.notify_download_complete);
    }

    #[test]
    fn test_launcher_settings_serialization() {
        let settings = LauncherSettings {
            games_install_path: Some(PathBuf::from("/games")),
            max_download_speed: Some(1_000_000),
            max_concurrent_downloads: 8,
            auto_update_games: false,
            auto_update_launcher: false,
            minimize_to_tray: false,
            close_to_tray: true,
            language: "fr".to_string(),
            theme: "dark".to_string(),
            notify_game_updates: false,
            notify_download_complete: false,
        };

        let json = serde_json::to_string(&settings).expect("Failed to serialize");
        let deserialized: LauncherSettings =
            serde_json::from_str(&json).expect("Failed to deserialize");

        assert_eq!(deserialized.max_concurrent_downloads, 8);
        assert_eq!(deserialized.language, "fr");
        assert!(!deserialized.auto_update_games);
        assert_eq!(
            deserialized.games_install_path,
            Some(PathBuf::from("/games"))
        );
        assert!(!deserialized.notify_game_updates);
        assert!(!deserialized.notify_download_complete);
    }

    #[test]
    fn test_launcher_settings_deserialization_ignores_removed_fields() {
        // `notifyFriendActivity` / `notifyNewsEvents` were removed from the
        // schema because no code read them. Settings files written by older
        // builds still contain those keys, so loading must ignore them rather
        // than fail and reset the user's configuration.
        let json = r#"{
            "language": "de",
            "theme": "light",
            "notifyFriendActivity": true,
            "notifyNewsEvents": false
        }"#;

        let settings: LauncherSettings = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(settings.language, "de");
        assert!(settings.notify_game_updates);
        assert!(settings.notify_download_complete);
    }

    #[test]
    fn test_launcher_settings_deserialization_missing_notifications() {
        let json = r#"{
            "language": "de",
            "theme": "light"
        }"#;

        let settings: LauncherSettings = serde_json::from_str(json).expect("Failed to deserialize");
        assert_eq!(settings.language, "de");
        assert!(settings.notify_game_updates);
        assert!(settings.notify_download_complete);
    }

    #[test]
    fn test_launcher_settings_validate() {
        // Valid settings
        let valid = LauncherSettings::default();
        assert!(valid.validate().is_ok());

        // Invalid: zero concurrent downloads
        let invalid = LauncherSettings {
            max_concurrent_downloads: 0,
            ..Default::default()
        };
        assert!(invalid.validate().is_err());

        // Invalid: empty language
        let invalid = LauncherSettings {
            language: "".to_string(),
            ..Default::default()
        };
        assert!(invalid.validate().is_err());

        // Invalid: zero download speed
        let invalid = LauncherSettings {
            max_download_speed: Some(0),
            ..Default::default()
        };
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn test_launcher_settings_download_speed_display() {
        // Unlimited
        let unlimited = LauncherSettings {
            max_download_speed: None,
            ..Default::default()
        };
        assert_eq!(unlimited.download_speed_display(), "Unlimited");

        // MB/s
        let mb = LauncherSettings {
            max_download_speed: Some(5_000_000),
            ..Default::default()
        };
        assert_eq!(mb.download_speed_display(), "5.0 MB/s");

        // KB/s
        let kb = LauncherSettings {
            max_download_speed: Some(500_000),
            ..Default::default()
        };
        assert_eq!(kb.download_speed_display(), "500.0 KB/s");

        // B/s
        let b = LauncherSettings {
            max_download_speed: Some(500),
            ..Default::default()
        };
        assert_eq!(b.download_speed_display(), "500 B/s");
    }

    // =========================================================================
    // LaunchResult Tests
    // =========================================================================

    #[test]
    fn test_launch_result_serialization() {
        let success = LaunchResult {
            success: true,
            message: "Game started".to_string(),
            process_id: Some(12345),
        };

        let failure = LaunchResult {
            success: false,
            message: "Game not found".to_string(),
            process_id: None,
        };

        let json_success = serde_json::to_string(&success).expect("Failed to serialize");
        let json_failure = serde_json::to_string(&failure).expect("Failed to serialize");

        assert!(json_success.contains("true"));
        assert!(json_success.contains("Game started"));
        assert!(json_success.contains("12345"));

        assert!(json_failure.contains("false"));
        assert!(json_failure.contains("Game not found"));
    }

    // =========================================================================
    // LauncherError Tests
    // =========================================================================

    #[test]
    fn test_launcher_error_serialization_tag() {
        let error = LauncherError::NotInstalled;
        let json = serde_json::to_string(&error).expect("Failed to serialize");
        assert!(json.contains("\"code\""));
        assert!(json.contains("\"NotInstalled\""));
    }

    #[test]
    fn test_launcher_error_serialization_simple_variant() {
        let error = LauncherError::AlreadyRunning;
        let json = serde_json::to_string(&error).expect("Failed to serialize");
        assert_eq!(json, r#"{"code":"AlreadyRunning"}"#);
    }

    #[test]
    fn test_launcher_error_serialization_struct_variant() {
        let error = LauncherError::ExecutableNotFound {
            path: "/games/test/game.exe".to_string(),
        };
        let json = serde_json::to_string(&error).expect("Failed to serialize");
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["code"], "ExecutableNotFound");
        assert_eq!(parsed["details"]["path"], "/games/test/game.exe");
    }

    #[test]
    fn test_launcher_error_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let err: LauncherError = io_err.into();
        assert!(matches!(err, LauncherError::Io(_)));
        assert!(err.to_string().contains("file missing"));
    }

    // =========================================================================
    // Edge Cases and Error Handling
    // =========================================================================

    #[test]
    fn test_deserialization_error_handling() {
        // Invalid JSON for GameManifest (malformed)
        let invalid_json = r#"{"invalid": "json""#;
        let result: Result<GameManifest, _> = serde_json::from_str(invalid_json);
        assert!(result.is_err(), "Malformed JSON should fail");

        // Missing required fields - serde will fail for non-optional fields
        let incomplete_json = r#"{"game_id": "game"}"#;
        let result: Result<GameManifest, _> = serde_json::from_str(incomplete_json);
        assert!(result.is_err(), "Missing required fields should fail");
    }

    #[test]
    fn test_empty_collections() {
        let manifest = GameManifest {
            files: vec![],
            ..GameManifest::test_manifest()
        };
        let json = serde_json::to_string(&manifest).expect("Failed to serialize");
        assert!(json.contains("[]"));

        let installation = GameInstallation {
            installed_files: HashMap::new(),
            ..create_test_installation()
        };
        let json = serde_json::to_string(&installation).expect("Failed to serialize");
        assert!(json.contains("{}"));
    }

    #[test]
    fn test_large_numbers() {
        let progress = PatchProgress {
            total_bytes: u64::MAX,
            downloaded_bytes: u64::MAX / 2,
            ..Default::default()
        };

        let json = serde_json::to_string(&progress).expect("Failed to serialize");
        let deserialized: PatchProgress =
            serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.total_bytes, u64::MAX);
    }

    #[test]
    fn test_game_exited_payload_serialization() {
        let payload = GameExited {
            game_id: "test-game".to_string(),
            duration_seconds: 42,
        };
        let json = serde_json::to_string(&payload).expect("Failed to serialize");
        assert!(json.contains("test-game"));
        assert!(json.contains("duration_seconds"));
    }

    // Helper function for GameInstallation tests
    fn create_test_installation() -> GameInstallation {
        GameInstallation {
            game_id: "test".to_string(),
            installed_version: "1.0".to_string(),
            installed_build: 1,
            install_path: PathBuf::from("/test"),
            installed_files: HashMap::new(),
            installed_at: chrono::Utc::now(),
            last_played: None,
            total_playtime_seconds: 0,
            executable: "game.exe".to_string(),
            channel: "stable".to_string(),
        }
    }
}
