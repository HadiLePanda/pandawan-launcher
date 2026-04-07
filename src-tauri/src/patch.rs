use crate::types::{DownloadEvent, FileEntry, GameInstallation, GameManifest, PatchProgress, PatchState, PatchStatus};
use crate::download::{DownloadManager, FileDownloadTask, DownloadError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::sync::Mutex;
use walkdir::WalkDir;

/// Manages game patching operations
pub struct PatchManager {
    download_manager: DownloadManager,
    state: Arc<Mutex<PatchStatus>>,
}

impl PatchManager {
    pub fn new(max_concurrent: usize, speed_limit: Option<u64>) -> Self {
        Self {
            download_manager: DownloadManager::new(max_concurrent, speed_limit),
            state: Arc::new(Mutex::new(PatchStatus {
                game_id: String::new(),
                current_version: String::new(),
                target_version: String::new(),
                status: PatchState::Idle,
                progress: PatchProgress::default(),
            })),
        }
    }

    /// Check which files need to be updated
    pub async fn check_for_updates(
        &self,
        manifest: &GameManifest,
        install_path: &Path,
    ) -> Result<Vec<FileEntry>, PatchError> {
        let mut files_to_update = Vec::new();

        for file_entry in &manifest.files {
            let file_path = install_path.join(&file_entry.path);
            
            if !file_path.exists() {
                // File doesn't exist, needs download
                files_to_update.push(file_entry.clone());
                continue;
            }

            // Check hash
            match compute_file_hash(&file_path).await {
                Ok(hash) => {
                    if hash != file_entry.hash {
                        // Hash mismatch, needs re-download
                        files_to_update.push(file_entry.clone());
                    }
                }
                Err(_) => {
                    // Can't read file, re-download
                    files_to_update.push(file_entry.clone());
                }
            }
        }

        Ok(files_to_update)
    }

    /// Perform full patch/installation
    pub async fn patch_game(
        &self,
        manifest: GameManifest,
        install_path: PathBuf,
        base_url: String,
        on_event: Channel<DownloadEvent>,
    ) -> Result<GameInstallation, PatchError> {
        // Update state
        {
            let mut state = self.state.lock().await;
            state.game_id = manifest.game_id.clone();
            state.current_version = "none".to_string();
            state.target_version = manifest.version.clone();
            state.status = PatchState::Checking;
            state.progress = PatchProgress::default();
        }

        // Create install directory
        fs::create_dir_all(&install_path)?;

        // Check which files need updating
        let files_to_update = self.check_for_updates(&manifest, &install_path).await?;
        
        if files_to_update.is_empty() {
            // Already up to date
            let installation = GameInstallation {
                game_id: manifest.game_id.clone(),
                installed_version: manifest.version.clone(),
                installed_build: manifest.build_number,
                install_path: install_path.clone(),
                installed_files: manifest.files.iter()
                    .map(|f| (f.path.clone(), f.hash.clone()))
                    .collect(),
                installed_at: chrono::Utc::now(),
                last_played: None,
                total_playtime_seconds: 0,
                executable: manifest.executable.clone(),
            };
            
            let _ = on_event.send(DownloadEvent::Complete);
            return Ok(installation);
        }

        // Update state for downloading
        {
            let mut state = self.state.lock().await;
            state.status = PatchState::Downloading;
            state.progress.total_files = files_to_update.len();
            state.progress.total_bytes = files_to_update.iter().map(|f| f.size).sum();
        }

        // Prepare download tasks
        let mut download_tasks = Vec::new();
        for file in &files_to_update {
            let url = format!("{}/{}", base_url, file.url);
            let dest_path = install_path.join(&file.path);
            
            download_tasks.push(FileDownloadTask {
                url,
                dest_path,
                expected_hash: Some(file.hash.clone()),
            });
        }

        // Download files
        self.download_manager.reset_cancel();
        self.download_manager.download_files(download_tasks, on_event.clone()).await?;

        // Clean up orphaned files
        self.cleanup_orphaned_files(&manifest, &install_path).await?;

        // Create installation record
        let installation = GameInstallation {
            game_id: manifest.game_id.clone(),
            installed_version: manifest.version.clone(),
            installed_build: manifest.build_number,
            install_path,
            installed_files: manifest.files.iter()
                .map(|f| (f.path.clone(), f.hash.clone()))
                .collect(),
            installed_at: chrono::Utc::now(),
            last_played: None,
            total_playtime_seconds: 0,
            executable: manifest.executable.clone(),
        };

        // Update state
        {
            let mut state = self.state.lock().await;
            state.status = PatchState::Complete;
        }

        Ok(installation)
    }

    /// Verify game installation integrity
    pub async fn verify_installation(
        &self,
        manifest: &GameManifest,
        install_path: &Path,
    ) -> Result<VerificationResult, PatchError> {
        let mut valid_files = 0;
        let mut invalid_files = Vec::new();
        let mut missing_files = Vec::new();

        for file_entry in &manifest.files {
            let file_path = install_path.join(&file_entry.path);
            
            if !file_path.exists() {
                missing_files.push(file_entry.path.clone());
                continue;
            }

            match compute_file_hash(&file_path).await {
                Ok(hash) => {
                    if hash == file_entry.hash {
                        valid_files += 1;
                    } else {
                        invalid_files.push(file_entry.path.clone());
                    }
                }
                Err(_) => {
                    invalid_files.push(file_entry.path.clone());
                }
            }
        }

        let is_valid = invalid_files.is_empty() && missing_files.is_empty();
        
        Ok(VerificationResult {
            valid_files,
            invalid_files,
            missing_files,
            is_valid,
        })
    }

    /// Remove files not in manifest
    async fn cleanup_orphaned_files(
        &self,
        manifest: &GameManifest,
        install_path: &Path,
    ) -> Result<(), PatchError> {
        let manifest_paths: HashSet<String> = manifest.files
            .iter()
            .map(|f| f.path.replace('\\', "/"))
            .collect();

        for entry in WalkDir::new(install_path)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
        {
            let relative_path = entry
                .path()
                .strip_prefix(install_path)
                .map_err(|e| PatchError::Other(e.to_string()))?
                .to_string_lossy()
                .replace('\\', "/");

            if !manifest_paths.contains(&relative_path) {
                // File not in manifest, remove it
                let _ = fs::remove_file(entry.path());
            }
        }

        // Remove empty directories
        self.remove_empty_dirs(install_path);

        Ok(())
    }

    fn remove_empty_dirs(&self, path: &Path) {
        for entry in WalkDir::new(path)
            .contents_first(true)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_dir())
        {
            if let Ok(entries) = fs::read_dir(entry.path()) {
                if entries.count() == 0 {
                    let _ = fs::remove_dir(entry.path());
                }
            }
        }
    }

    pub fn cancel(&self) {
        self.download_manager.cancel();
    }

    pub async fn get_status(&self) -> PatchStatus {
        self.state.lock().await.clone()
    }
}

/// Compute SHA256 hash of a file
pub async fn compute_file_hash(path: &Path) -> Result<String, PatchError> {
    let bytes = fs::read(path)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let result = hasher.finalize();
    Ok(hex::encode(result))
}

/// Compute hash synchronously (for small files)
pub fn compute_file_hash_sync(path: &Path) -> Result<String, PatchError> {
    let bytes = fs::read(path)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let result = hasher.finalize();
    Ok(hex::encode(result))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationResult {
    pub valid_files: usize,
    pub invalid_files: Vec<String>,
    pub missing_files: Vec<String>,
    pub is_valid: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum PatchError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    
    #[error("Download error: {0}")]
    Download(#[from] DownloadError),
    
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    
    #[error("{0}")]
    Other(String),
}

/// Save installation to disk
pub fn save_installation(
    app_data_dir: &Path,
    installation: &GameInstallation,
) -> Result<(), PatchError> {
    let installs_dir = app_data_dir.join("installations");
    fs::create_dir_all(&installs_dir)?;
    
    let file_path = installs_dir.join(format!("{}.json", installation.game_id));
    let json = serde_json::to_string_pretty(installation)?;
    fs::write(file_path, json)?;
    
    Ok(())
}

/// Load installation from disk
pub fn load_installation(
    app_data_dir: &Path,
    game_id: &str,
) -> Result<Option<GameInstallation>, PatchError> {
    let file_path = app_data_dir.join("installations").join(format!("{}.json", game_id));
    
    if !file_path.exists() {
        return Ok(None);
    }
    
    let json = fs::read_to_string(file_path)?;
    let installation = serde_json::from_str(&json)?;
    
    Ok(Some(installation))
}

/// List all installations
pub fn list_installations(app_data_dir: &Path) -> Result<Vec<GameInstallation>, PatchError> {
    let installs_dir = app_data_dir.join("installations");
    
    if !installs_dir.exists() {
        return Ok(Vec::new());
    }
    
    let mut installations = Vec::new();
    
    for entry in fs::read_dir(installs_dir)? {
        let entry = entry?;
        let path = entry.path();
        
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            let json = fs::read_to_string(&path)?;
            if let Ok(installation) = serde_json::from_str(&json) {
                installations.push(installation);
            }
        }
    }
    
    Ok(installations)
}
