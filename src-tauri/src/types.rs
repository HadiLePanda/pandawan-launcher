use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Game manifest from CDN
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameManifest {
    pub game_id: String,
    pub name: String,
    pub version: String,
    pub build_number: u64,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub banner_url: Option<String>,
    pub executable: String,
    pub files: Vec<FileEntry>,
    pub launch_args: Option<Vec<String>>,
}

/// Individual file entry in manifest
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub hash: String, // SHA256
    pub size: u64,
    pub url: String,
    pub compress: Option<bool>,
}

/// Local game installation state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameInstallation {
    pub game_id: String,
    pub installed_version: String,
    pub installed_build: u64,
    pub install_path: PathBuf,
    pub installed_files: HashMap<String, String>, // path -> hash
    pub installed_at: chrono::DateTime<chrono::Utc>,
    pub last_played: Option<chrono::DateTime<chrono::Utc>>,
    pub total_playtime_seconds: u64,
    pub executable: String,
}

/// Download progress event
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        file_path: String,
        total_size: u64,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        file_path: String,
        downloaded: u64,
        total: u64,
        speed_bps: f64,
    },
    #[serde(rename_all = "camelCase")]
    FileComplete {
        file_path: String,
    },
    #[serde(rename_all = "camelCase")]
    Complete,
    #[serde(rename_all = "camelCase")]
    Error {
        message: String,
    },
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PatchProgress {
    pub total_files: usize,
    pub completed_files: usize,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub current_file: Option<String>,
}

impl Default for PatchProgress {
    fn default() -> Self {
        Self {
            total_files: 0,
            completed_files: 0,
            total_bytes: 0,
            downloaded_bytes: 0,
            current_file: None,
        }
    }
}

/// Game launch result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchResult {
    pub success: bool,
    pub message: String,
    pub process_id: Option<u32>,
}

/// Launcher settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherSettings {
    pub games_install_path: Option<PathBuf>,
    pub max_download_speed: Option<u64>, // bytes per second, None = unlimited
    pub max_concurrent_downloads: usize,
    pub auto_update_games: bool,
    pub auto_update_launcher: bool,
    pub minimize_to_tray: bool,
    pub close_to_tray: bool,
    pub language: String,
}

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
        }
    }
}

/// Available game info (from remote catalog)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub developer: String,
    pub genre: Vec<String>,
    pub icon_url: String,
    pub banner_url: String,
    pub screenshots: Vec<String>,
    pub version: String,
    pub size_bytes: u64,
    pub release_date: chrono::DateTime<chrono::Utc>,
    pub manifest_url: String,
}
