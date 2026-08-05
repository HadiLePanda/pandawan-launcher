use crate::download::{DownloadError, DownloadManager, FileDownloadTask};
use crate::path_utils::{assert_path_inside, safe_join, validate_download_url, validate_game_id};
use crate::types::{
    DownloadEvent, FileEntry, GameInstallation, GameManifest, LauncherError, PatchProgress,
    PatchState, PatchStatus,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::io::{AsyncReadExt, BufReader};
use tokio::sync::{Mutex, RwLock};
use walkdir::WalkDir;

/// Manages game patching operations
pub struct PatchManager {
    download_manager: RwLock<DownloadManager>,
    state: Arc<Mutex<PatchStatus>>,
}

impl PatchManager {
    pub fn new(max_concurrent: usize, speed_limit: Option<u64>) -> Self {
        Self {
            download_manager: RwLock::new(DownloadManager::new(max_concurrent, speed_limit)),
            state: Arc::new(Mutex::new(PatchStatus {
                game_id: String::new(),
                current_version: String::new(),
                target_version: String::new(),
                status: PatchState::Idle,
                progress: PatchProgress::default(),
            })),
        }
    }

    /// Reconfigure the underlying download manager with new concurrency and
    /// speed limits. Existing downloads are not affected, but future operations
    /// will use the new limits.
    pub async fn reconfigure(
        &self,
        max_concurrent: usize,
        speed_limit: Option<u64>,
    ) {
        *self.download_manager.write().await = DownloadManager::new(max_concurrent, speed_limit);
    }

    /// Return the current download limits.
    pub async fn current_limits(&self) -> (usize, Option<u64>) {
        let dm = self.download_manager.read().await;
        (dm.max_concurrent(), dm.speed_limit())
    }

    /// Check which files need to be updated
    pub async fn check_for_updates(
        &self,
        manifest: &GameManifest,
        install_path: &Path,
    ) -> Result<Vec<FileEntry>, PatchError> {
        let mut files_to_update = Vec::new();

        for file_entry in &manifest.files {
            let file_path = safe_join(install_path, &file_entry.path)?;

            if !file_path.exists() {
                files_to_update.push(file_entry.clone());
                continue;
            }

            match compute_file_hash(&file_path).await {
                Ok(hash) => {
                    if hash != file_entry.hash {
                        files_to_update.push(file_entry.clone());
                    }
                }
                Err(_) => {
                    files_to_update.push(file_entry.clone());
                }
            }
        }

        Ok(files_to_update)
    }

    fn build_installation(
        manifest: &GameManifest,
        install_path: &Path,
        previous: Option<&GameInstallation>,
    ) -> Result<GameInstallation, PatchError> {
        // Reject traversal/absolute executable paths coming from a manifest.
        let executable = crate::path_utils::sanitize_relative_path(&manifest.executable,
        )?
        .to_string_lossy()
        .replace('\\', "/");

        Ok(GameInstallation {
            game_id: manifest.game_id.clone(),
            installed_version: manifest.version.clone(),
            installed_build: manifest.build_number,
            install_path: install_path.to_path_buf(),
            installed_files: manifest
                .files
                .iter()
                .map(|f| (f.path.replace('\\', "/"), f.hash.clone()))
                .collect(),
            installed_at: previous
                .map(|p| p.installed_at)
                .unwrap_or_else(chrono::Utc::now),
            last_played: previous.and_then(|p| p.last_played),
            total_playtime_seconds: previous.map(|p| p.total_playtime_seconds).unwrap_or(0),
            executable,
        })
    }

    /// Perform full patch/installation
    pub async fn patch_game(
        &self,
        manifest: GameManifest,
        install_path: PathBuf,
        app_data_dir: &Path,
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

        // Validate game id before touching disk
        validate_game_id(&manifest.game_id)?;

        // Ensure base_url behaves as a directory when joining file URLs
        let base_url = if base_url.ends_with('/') {
            base_url
        } else {
            format!("{}/", base_url)
        };

        // Create install directory
        fs::create_dir_all(&install_path)?;

        // Check which files need updating
        let files_to_update = self.check_for_updates(&manifest, &install_path).await?;

        // Load the previous installation once: it preserves play history
        // (installed_at, last_played, total_playtime_seconds) across updates
        // and provides the previous manifest for orphan cleanup. A corrupt
        // record is treated as absent but logged so the data loss is visible.
        let previous_installation = match load_installation(app_data_dir, &manifest.game_id) {
            Ok(v) => v,
            Err(e) => {
                eprintln!(
                    "warning: failed to load previous installation for '{}': {}",
                    manifest.game_id, e
                );
                None
            }
        };

        if files_to_update.is_empty() {
            // Already up to date
            let installation =
                Self::build_installation(&manifest, &install_path, previous_installation.as_ref())?;

            let _ = on_event.send(DownloadEvent::Complete {
                completed_files: 1,
                total_files: 1,
            });
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
        let base = reqwest::Url::parse(&base_url)
            .map_err(|e| PatchError::Other(format!("Invalid base URL '{}': {}", base_url, e)))?;
        let mut download_tasks = Vec::new();
        for file in &files_to_update {
            let relative_url = validate_download_url(&base_url, &file.url)?;
            let url = base
                .join(&relative_url)
                .map_err(|e| PatchError::Other(format!("Invalid file URL '{}': {}", file.url, e)))?
                .to_string();
            let dest_path = safe_join(&install_path, &file.path)?;
            assert_path_inside(&dest_path, &install_path)?;

            download_tasks.push(FileDownloadTask {
                url,
                dest_path,
                expected_hash: Some(file.hash.clone()),
                size: file.size,
            });
        }

        // Update state progress before downloading
        {
            let mut state = self.state.lock().await;
            state.progress.total_files = files_to_update.len();
            state.progress.total_bytes = files_to_update.iter().map(|f| f.size).sum();
            state.progress.completed_files = 0;
            state.progress.downloaded_bytes = 0;
        }

        // Download files
        {
            let dm = self.download_manager.read().await;
            dm.reset_cancel();
            dm.download_files(download_tasks, on_event.clone())
                .await?;
        }

        // After download, ensure progress is complete
        {
            let mut state = self.state.lock().await;
            state.progress.completed_files = state.progress.total_files;
            state.progress.downloaded_bytes = state.progress.total_bytes;
        }

        // Clean up orphaned files from the previous manifest only
        let previous_files: Option<HashSet<String>> = previous_installation
            .as_ref()
            .map(|inst| inst.installed_files.keys().cloned().collect());
        self.cleanup_orphaned_files(&manifest, &install_path, previous_files.as_ref())
            .await?;

        // Create installation record
        let installation =
            Self::build_installation(&manifest, &install_path, previous_installation.as_ref())?;

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
            let file_path = safe_join(install_path, &file_entry.path)?;

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

    /// Remove files from the previous manifest that are no longer in the new manifest.
    /// If no previous manifest is provided, cleanup is skipped to avoid deleting user files.
    async fn cleanup_orphaned_files(
        &self,
        manifest: &GameManifest,
        install_path: &Path,
        previous_files: Option<&HashSet<String>>,
    ) -> Result<(), PatchError> {
        let Some(previous_files) = previous_files else {
            return Ok(());
        };

        let manifest_paths: HashSet<String> = manifest
            .files
            .iter()
            .map(|f| f.path.replace('\\', "/"))
            .collect();

        for relative_path in previous_files {
            let normalized_path = relative_path.replace('\\', "/");
            if manifest_paths.contains(&normalized_path) {
                continue;
            }
            let file_path = safe_join(install_path, &normalized_path)?;
            assert_path_inside(&file_path, install_path)?;
            if file_path.exists() {
                let _ = fs::remove_file(&file_path);
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

    pub async fn cancel(&self) {
        self.download_manager.read().await.cancel();
    }

    pub async fn get_status(&self) -> PatchStatus {
        self.state.lock().await.clone()
    }
}

/// Compute SHA256 hash of a file using streaming reads
pub async fn compute_file_hash(path: &Path) -> Result<String, PatchError> {
    let file = tokio::fs::File::open(path).await?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];

    loop {
        let n = reader.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    Ok(hex::encode(hasher.finalize()))
}

/// Compute hash synchronously using streaming reads (for small files)
pub fn compute_file_hash_sync(path: &Path) -> Result<String, PatchError> {
    let file = fs::File::open(path)?;
    let mut reader = std::io::BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];

    loop {
        let n = reader.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    Ok(hex::encode(hasher.finalize()))
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct VerificationResult {
    #[specta(type = u32)]
    pub valid_files: usize,
    pub invalid_files: Vec<String>,
    pub missing_files: Vec<String>,
    pub is_valid: bool,
}

impl VerificationResult {
    /// Get total number of files checked
    pub fn total_files(&self) -> usize {
        self.valid_files + self.invalid_files.len() + self.missing_files.len()
    }

    /// Get number of problematic files (invalid or missing)
    pub fn problematic_count(&self) -> usize {
        self.invalid_files.len() + self.missing_files.len()
    }

    /// Create a summary string
    pub fn summary(&self) -> String {
        if self.is_valid {
            format!("All {} files verified successfully", self.valid_files)
        } else {
            format!(
                "Verification failed: {} valid, {} invalid, {} missing",
                self.valid_files,
                self.invalid_files.len(),
                self.missing_files.len()
            )
        }
    }

    /// Check if a specific file is problematic
    pub fn is_file_problematic(&self, file_path: &str) -> bool {
        self.invalid_files.contains(&file_path.to_string())
            || self.missing_files.contains(&file_path.to_string())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PatchError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Download error: {0}")]
    Download(#[from] DownloadError),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Path not allowed: {0}")]
    PathNotAllowed(String),

    #[error("{0}")]
    Other(String),
}

impl From<crate::path_utils::PathError> for PatchError {
    fn from(err: crate::path_utils::PathError) -> Self {
        PatchError::PathNotAllowed(err.to_string())
    }
}

impl From<PatchError> for LauncherError {
    fn from(err: PatchError) -> Self {
        match err {
            PatchError::Io(e) => LauncherError::Io(e.to_string()),
            PatchError::Download(e) => e.into(),
            PatchError::Serialization(e) => LauncherError::ManifestParse(e.to_string()),
            PatchError::PathNotAllowed(path) => LauncherError::PathNotAllowed { path },
            PatchError::Other(s) => LauncherError::Other(s),
        }
    }
}

/// Save installation to disk
pub fn save_installation(
    app_data_dir: &Path,
    installation: &GameInstallation,
) -> Result<(), PatchError> {
    validate_game_id(&installation.game_id)?;

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
    validate_game_id(game_id)?;

    let file_path = app_data_dir
        .join("installations")
        .join(format!("{}.json", game_id));

    if !file_path.exists() {
        return Ok(None);
    }

    let json = fs::read_to_string(file_path)?;
    let installation = serde_json::from_str(&json)?;

    Ok(Some(installation))
}

/// Record a play session for an installed game: adds `duration_seconds` to the
/// accumulated playtime, sets `last_played` to now, and saves the record.
/// Returns the updated installation.
pub fn record_playtime(
    app_data_dir: &Path,
    game_id: &str,
    duration_seconds: u64,
) -> Result<GameInstallation, PatchError> {
    let mut installation = load_installation(app_data_dir, game_id)?
        .ok_or_else(|| PatchError::Other(format!("Game '{}' is not installed", game_id)))?;

    installation.total_playtime_seconds = installation
        .total_playtime_seconds
        .saturating_add(duration_seconds);
    installation.last_played = Some(chrono::Utc::now());

    save_installation(app_data_dir, &installation)?;

    Ok(installation)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    // =========================================================================
    // compute_file_hash Tests
    // =========================================================================

    #[test]
    fn test_compute_file_hash_sync_success() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("test.txt");

        let content = b"Hello, World!";
        fs::write(&file_path, content).unwrap();

        let hash = compute_file_hash_sync(&file_path).unwrap();

        // SHA256 of "Hello, World!" is known
        assert_eq!(hash.len(), 64); // Hex encoded SHA256

        // Same content should produce same hash
        let hash2 = compute_file_hash_sync(&file_path).unwrap();
        assert_eq!(hash, hash2);
    }

    #[tokio::test]
    async fn test_compute_file_hash_async_success() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("test.txt");

        let content = b"Hello, World!";
        fs::write(&file_path, content).unwrap();

        let hash = compute_file_hash(&file_path).await.unwrap();

        // Async and sync should produce same result
        let hash_sync = compute_file_hash_sync(&file_path).unwrap();
        assert_eq!(hash, hash_sync);
    }

    #[tokio::test]
    async fn test_compute_file_hash_matches_sync_on_large_file() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("large.bin");

        let content: Vec<u8> = (0..4_000_000).map(|i| (i % 256) as u8).collect();
        fs::write(&file_path, &content).unwrap();

        let sync_hash = compute_file_hash_sync(&file_path).unwrap();
        let async_hash = compute_file_hash(&file_path).await.unwrap();

        assert_eq!(async_hash, sync_hash);
        assert_eq!(async_hash.len(), 64);
    }

    #[test]
    fn test_compute_file_hash_different_content() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file1 = temp_dir.path().join("file1.txt");
        let file2 = temp_dir.path().join("file2.txt");

        fs::write(&file1, b"content A").unwrap();
        fs::write(&file2, b"content B").unwrap();

        let hash1 = compute_file_hash_sync(&file1).unwrap();
        let hash2 = compute_file_hash_sync(&file2).unwrap();

        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_compute_file_hash_nonexistent_file() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("does_not_exist.txt");

        let result = compute_file_hash_sync(&file_path);
        assert!(result.is_err());
    }

    #[test]
    fn test_compute_file_hash_empty_file() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("empty.txt");

        fs::write(&file_path, b"").unwrap();

        let hash = compute_file_hash_sync(&file_path).unwrap();

        // SHA256 of empty file
        assert_eq!(
            hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    // =========================================================================
    // VerificationResult Tests
    // =========================================================================

    #[test]
    fn test_verification_result_total_files() {
        let result = VerificationResult {
            valid_files: 5,
            invalid_files: vec!["file1.txt".to_string(), "file2.txt".to_string()],
            missing_files: vec!["file3.txt".to_string()],
            is_valid: false,
        };

        assert_eq!(result.total_files(), 8);
    }

    #[test]
    fn test_verification_result_problematic_count() {
        let result = VerificationResult {
            valid_files: 5,
            invalid_files: vec!["file1.txt".to_string()],
            missing_files: vec!["file2.txt".to_string(), "file3.txt".to_string()],
            is_valid: false,
        };

        assert_eq!(result.problematic_count(), 3);
    }

    #[test]
    fn test_verification_result_summary_valid() {
        let result = VerificationResult {
            valid_files: 10,
            invalid_files: vec![],
            missing_files: vec![],
            is_valid: true,
        };

        assert_eq!(result.summary(), "All 10 files verified successfully");
    }

    #[test]
    fn test_verification_result_summary_invalid() {
        let result = VerificationResult {
            valid_files: 7,
            invalid_files: vec!["bad1.txt".to_string(), "bad2.txt".to_string()],
            missing_files: vec!["missing.txt".to_string()],
            is_valid: false,
        };

        assert_eq!(
            result.summary(),
            "Verification failed: 7 valid, 2 invalid, 1 missing"
        );
    }

    #[test]
    fn test_verification_result_is_file_problematic() {
        let result = VerificationResult {
            valid_files: 5,
            invalid_files: vec!["invalid.txt".to_string()],
            missing_files: vec!["missing.txt".to_string()],
            is_valid: false,
        };

        assert!(result.is_file_problematic("invalid.txt"));
        assert!(result.is_file_problematic("missing.txt"));
        assert!(!result.is_file_problematic("valid.txt"));
    }

    #[test]
    fn test_verification_result_serialization() {
        let result = VerificationResult {
            valid_files: 8,
            invalid_files: vec!["corrupt.dat".to_string()],
            missing_files: vec!["gone.txt".to_string()],
            is_valid: false,
        };

        let json = serde_json::to_string(&result).unwrap();
        let deserialized: VerificationResult = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.valid_files, result.valid_files);
        assert_eq!(deserialized.invalid_files, result.invalid_files);
        assert_eq!(deserialized.is_valid, result.is_valid);
    }

    // =========================================================================
    // save_installation Tests
    // =========================================================================

    #[test]
    fn test_save_installation_creates_directory() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path().join("app_data");

        let installation = create_test_installation();

        save_installation(&app_data_dir, &installation).unwrap();

        // Check directory was created
        assert!(app_data_dir.join("installations").exists());

        // Check file was created
        let file_path = app_data_dir.join("installations").join("test-game.json");
        assert!(file_path.exists());
    }

    #[test]
    fn test_save_and_load_installation() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();

        let installation = create_test_installation();

        // Save
        save_installation(app_data_dir, &installation).unwrap();

        // Load
        let loaded = load_installation(app_data_dir, "test-game").unwrap();

        assert!(loaded.is_some());
        let loaded = loaded.unwrap();
        assert_eq!(loaded.game_id, installation.game_id);
        assert_eq!(loaded.installed_version, installation.installed_version);
        assert_eq!(
            loaded.installed_files.len(),
            installation.installed_files.len()
        );
    }

    #[test]
    fn test_load_installation_not_found() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();

        let result = load_installation(app_data_dir, "nonexistent").unwrap();

        assert!(result.is_none());
    }

    #[test]
    fn test_load_installation_invalid_json() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();
        let installs_dir = app_data_dir.join("installations");
        fs::create_dir_all(&installs_dir).unwrap();

        // Write invalid JSON
        let file_path = installs_dir.join("bad-game.json");
        fs::write(&file_path, "not valid json").unwrap();

        let result = load_installation(app_data_dir, "bad-game");
        assert!(result.is_err());
    }

    // =========================================================================
    // list_installations Tests
    // =========================================================================

    #[test]
    fn test_list_installations_empty() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();

        let installations = list_installations(app_data_dir).unwrap();
        assert!(installations.is_empty());
    }

    #[test]
    fn test_list_installations_with_no_installs_dir() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();

        let installations = list_installations(app_data_dir).unwrap();
        assert!(installations.is_empty());
    }

    #[test]
    fn test_list_installations_multiple() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();

        // Create multiple installations
        let mut inst1 = create_test_installation();
        inst1.game_id = "game-1".to_string();

        let mut inst2 = create_test_installation();
        inst2.game_id = "game-2".to_string();

        let mut inst3 = create_test_installation();
        inst3.game_id = "game-3".to_string();

        save_installation(app_data_dir, &inst1).unwrap();
        save_installation(app_data_dir, &inst2).unwrap();
        save_installation(app_data_dir, &inst3).unwrap();

        let installations = list_installations(app_data_dir).unwrap();

        assert_eq!(installations.len(), 3);

        let game_ids: Vec<_> = installations.iter().map(|i| &i.game_id).collect();
        assert!(game_ids.contains(&&"game-1".to_string()));
        assert!(game_ids.contains(&&"game-2".to_string()));
        assert!(game_ids.contains(&&"game-3".to_string()));
    }

    #[test]
    fn test_list_installations_skips_invalid_files() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();
        let installs_dir = app_data_dir.join("installations");
        fs::create_dir_all(&installs_dir).unwrap();

        // Create one valid installation
        let installation = create_test_installation();
        save_installation(app_data_dir, &installation).unwrap();

        // Create an invalid JSON file
        fs::write(installs_dir.join("invalid.json"), "not json").unwrap();

        // Create a non-JSON file
        fs::write(installs_dir.join("readme.txt"), "hello").unwrap();

        let installations = list_installations(app_data_dir).unwrap();

        // Should only return the valid one
        assert_eq!(installations.len(), 1);
        assert_eq!(installations[0].game_id, "test-game");
    }

    // =========================================================================
    // PatchManager Tests
    // =========================================================================

    #[tokio::test]
    async fn test_patch_manager_new() {
        let manager = PatchManager::new(4, Some(1024));
        let status = manager.get_status().await;

        assert_eq!(status.status, PatchState::Idle);
        assert_eq!(status.game_id, "");
    }

    #[tokio::test]
    async fn test_check_for_updates_new_install() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path().join("install");

        let manifest = create_test_manifest();
        let manager = PatchManager::new(4, None);

        let files_to_update = manager
            .check_for_updates(&manifest, &install_path)
            .await
            .unwrap();

        // All files should need updating since directory doesn't exist
        assert_eq!(files_to_update.len(), manifest.files.len());
    }

    #[tokio::test]
    async fn test_check_for_updates_all_valid() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path().join("install");

        // Create files with correct hashes
        fs::create_dir_all(&install_path).unwrap();

        let exe_content = b"game exe";
        let config_content = b"config json";

        let exe_path = install_path.join("game.exe");
        let config_path = install_path.join("data");
        fs::create_dir_all(&config_path).unwrap();
        let config_path = config_path.join("config.json");

        fs::write(&exe_path, exe_content).unwrap();
        fs::write(&config_path, config_content).unwrap();

        // Get actual hashes
        let exe_hash = compute_file_hash_sync(&exe_path).unwrap();
        let config_hash = compute_file_hash_sync(&config_path).unwrap();

        // Create manifest with correct hashes
        let mut manifest = create_test_manifest();
        manifest
            .files
            .retain(|f| f.path == "game.exe" || f.path == "data/config.json");
        manifest.files[0].hash = exe_hash;
        manifest.files[0].size = exe_content.len() as u64;
        manifest.files[1].hash = config_hash;
        manifest.files[1].size = config_content.len() as u64;

        let manager = PatchManager::new(4, None);
        let files_to_update = manager
            .check_for_updates(&manifest, &install_path)
            .await
            .unwrap();

        // No files should need updating
        assert!(files_to_update.is_empty());
    }

    #[tokio::test]
    async fn test_check_for_updates_modified_file() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path().join("install");
        fs::create_dir_all(&install_path).unwrap();

        // Create a file
        let file_path = install_path.join("game.exe");
        fs::write(&file_path, b"original").unwrap();
        let correct_hash = compute_file_hash_sync(&file_path).unwrap();

        // Modify the file
        fs::write(&file_path, b"modified").unwrap();

        // Create manifest with original hash
        let mut manifest = create_test_manifest();
        manifest.files.retain(|f| f.path == "game.exe");
        manifest.files[0].hash = correct_hash;

        let manager = PatchManager::new(4, None);
        let files_to_update = manager
            .check_for_updates(&manifest, &install_path)
            .await
            .unwrap();

        // File should need updating due to hash mismatch
        assert_eq!(files_to_update.len(), 1);
        assert_eq!(files_to_update[0].path, "game.exe");
    }

    #[tokio::test]
    async fn test_verify_installation_all_valid() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path();

        // Create files
        let exe_content = b"game exe";
        let exe_path = install_path.join("game.exe");
        fs::write(&exe_path, exe_content).unwrap();
        let exe_hash = compute_file_hash_sync(&exe_path).unwrap();

        // Create manifest
        let mut manifest = create_test_manifest();
        manifest.files = vec![FileEntry {
            path: "game.exe".to_string(),
            hash: exe_hash,
            size: exe_content.len() as u64,
            url: "game.exe".to_string(),
            compress: None,
        }];

        let manager = PatchManager::new(4, None);
        let result = manager
            .verify_installation(&manifest, install_path)
            .await
            .unwrap();

        assert!(result.is_valid);
        assert_eq!(result.valid_files, 1);
        assert!(result.invalid_files.is_empty());
        assert!(result.missing_files.is_empty());
    }

    #[tokio::test]
    async fn test_verify_installation_with_missing() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path();

        // Create only one file
        let exe_content = b"game exe";
        let exe_path = install_path.join("game.exe");
        fs::write(&exe_path, exe_content).unwrap();
        let exe_hash = compute_file_hash_sync(&exe_path).unwrap();

        // Create manifest with two files
        let mut manifest = create_test_manifest();
        manifest.files = vec![
            FileEntry {
                path: "game.exe".to_string(),
                hash: exe_hash,
                size: exe_content.len() as u64,
                url: "game.exe".to_string(),
                compress: None,
            },
            FileEntry {
                path: "missing.dat".to_string(),
                hash: "abc".repeat(16),
                size: 100,
                url: "missing.dat".to_string(),
                compress: None,
            },
        ];

        let manager = PatchManager::new(4, None);
        let result = manager
            .verify_installation(&manifest, install_path)
            .await
            .unwrap();

        assert!(!result.is_valid);
        assert_eq!(result.valid_files, 1);
        assert_eq!(result.missing_files.len(), 1);
        assert!(result.missing_files.contains(&"missing.dat".to_string()));
    }

    #[tokio::test]
    async fn test_verify_installation_with_invalid() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path();

        // Create a file with wrong content
        let exe_path = install_path.join("game.exe");
        fs::write(&exe_path, b"wrong content").unwrap();

        // Create manifest with different hash
        let mut manifest = create_test_manifest();
        manifest.files = vec![FileEntry {
            path: "game.exe".to_string(),
            hash: "abc".repeat(16),
            size: 100,
            url: "game.exe".to_string(),
            compress: None,
        }];

        let manager = PatchManager::new(4, None);
        let result = manager
            .verify_installation(&manifest, install_path)
            .await
            .unwrap();

        assert!(!result.is_valid);
        assert_eq!(result.valid_files, 0);
        assert_eq!(result.invalid_files.len(), 1);
        assert!(result.invalid_files.contains(&"game.exe".to_string()));
    }

    #[tokio::test]
    async fn test_verify_installation_empty_manifest() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path();

        let mut manifest = create_test_manifest();
        manifest.files = vec![];

        let manager = PatchManager::new(4, None);
        let result = manager
            .verify_installation(&manifest, install_path)
            .await
            .unwrap();

        assert!(result.is_valid);
        assert_eq!(result.valid_files, 0);
        assert!(result.invalid_files.is_empty());
        assert!(result.missing_files.is_empty());
    }

    // =========================================================================
    // Orphan Cleanup Tests
    // =========================================================================

    #[tokio::test]
    async fn test_cleanup_orphaned_files_removes_obsolete_previous_files() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path().join("install");
        fs::create_dir_all(&install_path).unwrap();

        fs::write(install_path.join("old.dat"), "old").unwrap();
        fs::write(install_path.join("keep.dat"), "keep").unwrap();

        let mut previous_files = HashSet::new();
        previous_files.insert("old.dat".to_string());
        previous_files.insert("keep.dat".to_string());

        let manifest = GameManifest {
            game_id: "test-game".to_string(),
            name: "Test Game".to_string(),
            version: "1.0.0".to_string(),
            build_number: 1,
            description: None,
            icon_url: None,
            banner_url: None,
            executable: "game.exe".to_string(),
            files: vec![FileEntry {
                path: "keep.dat".to_string(),
                hash: "abc".repeat(16),
                size: 4,
                url: "keep.dat".to_string(),
                compress: None,
            }],
            launch_args: None,
        };

        let manager = PatchManager::new(4, None);
        manager
            .cleanup_orphaned_files(&manifest, &install_path, Some(&previous_files))
            .await
            .unwrap();

        assert!(!install_path.join("old.dat").exists());
        assert!(install_path.join("keep.dat").exists());
    }

    #[tokio::test]
    async fn test_cleanup_orphaned_files_preserves_user_files_when_no_previous_manifest() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path().join("install");
        let saves_dir = install_path.join("saves");
        fs::create_dir_all(&saves_dir).unwrap();
        fs::write(saves_dir.join("save.sav"), "player data").unwrap();

        let manifest = create_test_manifest();

        let manager = PatchManager::new(4, None);
        manager
            .cleanup_orphaned_files(&manifest, &install_path, None)
            .await
            .unwrap();

        assert!(saves_dir.join("save.sav").exists());
    }

    #[tokio::test]
    async fn test_cleanup_orphaned_files_normalizes_backslash_paths() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path().join("install");
        let data_dir = install_path.join("data");
        fs::create_dir_all(&data_dir).unwrap();

        fs::write(data_dir.join("config.json"), "config").unwrap();

        let mut previous_files = HashSet::new();
        previous_files.insert("data\\config.json".to_string());

        let manifest = GameManifest {
            game_id: "test-game".to_string(),
            name: "Test Game".to_string(),
            version: "1.0.0".to_string(),
            build_number: 1,
            description: None,
            icon_url: None,
            banner_url: None,
            executable: "game.exe".to_string(),
            files: vec![FileEntry {
                path: "data/config.json".to_string(),
                hash: "def".repeat(16),
                size: 7,
                url: "data/config.json".to_string(),
                compress: None,
            }],
            launch_args: None,
        };

        let manager = PatchManager::new(4, None);
        manager
            .cleanup_orphaned_files(&manifest, &install_path, Some(&previous_files))
            .await
            .unwrap();

        assert!(data_dir.join("config.json").exists());
    }

    #[tokio::test]
    async fn test_check_for_updates_rejects_traversal_path() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path().join("install");

        let mut manifest = create_test_manifest();
        manifest.files = vec![FileEntry {
            path: "../secret.txt".to_string(),
            hash: "a".repeat(64),
            size: 100,
            url: "secret.txt".to_string(),
            compress: None,
        }];

        let manager = PatchManager::new(4, None);
        let result = manager.check_for_updates(&manifest, &install_path).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_verify_installation_rejects_traversal_path() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path();

        let mut manifest = create_test_manifest();
        manifest.files = vec![FileEntry {
            path: "../secret.txt".to_string(),
            hash: "a".repeat(64),
            size: 100,
            url: "secret.txt".to_string(),
            compress: None,
        }];

        let manager = PatchManager::new(4, None);
        let result = manager.verify_installation(&manifest, install_path).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_cleanup_orphaned_files_rejects_traversal_previous_files() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path().join("install");
        fs::create_dir_all(&install_path).unwrap();

        let mut previous_files = HashSet::new();
        previous_files.insert("../outside.txt".to_string());

        let manifest = create_test_manifest();

        let manager = PatchManager::new(4, None);
        let result = manager
            .cleanup_orphaned_files(&manifest, &install_path, Some(&previous_files))
            .await;
        assert!(result.is_err());
    }

    // =========================================================================
    // Helper Functions for Tests
    // =========================================================================

    fn create_test_installation() -> GameInstallation {
        let mut installed_files = HashMap::new();
        installed_files.insert("game.exe".to_string(), "abc".repeat(16));

        GameInstallation {
            game_id: "test-game".to_string(),
            installed_version: "1.0.0".to_string(),
            installed_build: 1,
            install_path: PathBuf::from("/test/path"),
            installed_files,
            installed_at: chrono::Utc::now(),
            last_played: None,
            total_playtime_seconds: 0,
            executable: "game.exe".to_string(),
        }
    }

    fn create_test_manifest() -> GameManifest {
        GameManifest {
            game_id: "test-game".to_string(),
            name: "Test Game".to_string(),
            version: "1.0.0".to_string(),
            build_number: 1,
            description: None,
            icon_url: None,
            banner_url: None,
            executable: "game.exe".to_string(),
            files: vec![
                FileEntry {
                    path: "game.exe".to_string(),
                    hash: "abc".repeat(16),
                    size: 100,
                    url: "game.exe".to_string(),
                    compress: None,
                },
                FileEntry {
                    path: "data/config.json".to_string(),
                    hash: "def".repeat(16),
                    size: 50,
                    url: "config.json".to_string(),
                    compress: None,
                },
            ],
            launch_args: None,
        }
    }
}
