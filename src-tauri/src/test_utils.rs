//! Test utilities for Pandawan Launcher
//!
//! This module provides helper functions and mock data for testing
//! the launcher components.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::Path;

use crate::types::{
    FileEntry, GameInstallation, GameManifest, LauncherSettings, PatchProgress, PatchState,
    PatchStatus,
};

/// Creates a test file with specified content and returns its SHA256 hash
pub fn create_test_file_with_content(path: &Path, content: &[u8]) -> String {
    let parent = path.parent().expect("Path must have parent directory");
    fs::create_dir_all(parent).expect("Failed to create parent directories");

    let mut file = fs::File::create(path).expect("Failed to create test file");
    file.write_all(content)
        .expect("Failed to write test content");
    file.flush().expect("Failed to flush file");

    // Compute and return SHA256 hash
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(content);
    hex::encode(hasher.finalize())
}

/// Creates a test manifest with sample files
pub fn create_test_manifest() -> GameManifest {
    GameManifest {
        game_id: "test-game".to_string(),
        name: "Test Game".to_string(),
        version: "1.0.0".to_string(),
        build_number: 100,
        channel: "stable".to_string(),
        description: Some("A test game for unit tests".to_string()),
        icon_url: Some("https://example.com/icon.png".to_string()),
        banner_url: Some("https://example.com/banner.png".to_string()),
        executable: "game.exe".to_string(),
        files: vec![
            FileEntry {
                path: "game.exe".to_string(),
                hash: "a".repeat(64), // Placeholder hash
                size: 1024,
                url: "files/game.exe".to_string(),
                compress: Some(false),
            },
            FileEntry {
                path: "data/config.json".to_string(),
                hash: "b".repeat(64), // Placeholder hash
                size: 256,
                url: "files/config.json".to_string(),
                compress: Some(false),
            },
            FileEntry {
                path: "assets/texture.png".to_string(),
                hash: "c".repeat(64), // Placeholder hash
                size: 4096,
                url: "files/texture.png".to_string(),
                compress: Some(true),
            },
        ],
        launch_args: Some(vec!["--fullscreen".to_string()]),

        platforms: None,
        size_bytes: None,
    }
}

/// Creates a test manifest with updated version
pub fn create_updated_test_manifest() -> GameManifest {
    let mut manifest = create_test_manifest();
    manifest.version = "1.1.0".to_string();
    manifest.build_number = 101;
    // Modify one file to simulate update
    manifest.files[1].hash = "d".repeat(64);
    manifest.files[1].size = 300;
    manifest
}

/// Creates a test game installation
pub fn create_test_installation(install_path: &Path) -> GameInstallation {
    let mut installed_files = HashMap::new();
    installed_files.insert("game.exe".to_string(), "a".repeat(64));
    installed_files.insert("data/config.json".to_string(), "b".repeat(64));
    installed_files.insert("assets/texture.png".to_string(), "c".repeat(64));

    GameInstallation {
        game_id: "test-game".to_string(),
        installed_version: "1.0.0".to_string(),
        installed_build: 100,
        channel: "stable".to_string(),
        install_path: install_path.to_path_buf(),
        installed_files,
        installed_at: chrono::Utc::now(),
        last_played: None,
        total_playtime_seconds: 0,
        executable: "game.exe".to_string(),
    }
}

/// Creates default test settings
pub fn create_test_settings() -> LauncherSettings {
    LauncherSettings {
        games_install_path: None,
        max_download_speed: None,
        max_concurrent_downloads: 4,
        auto_update_games: true,
        auto_update_launcher: true,
        minimize_to_tray: true,
        close_to_tray: false,
        language: "en".to_string(),
        theme: "adaptive".to_string(),
        ..Default::default()
    }
}

/// Creates a test patch status
pub fn create_test_patch_status() -> PatchStatus {
    PatchStatus {
        game_id: "test-game".to_string(),
        current_version: "1.0.0".to_string(),
        target_version: "1.1.0".to_string(),
        status: PatchState::Idle,
        progress: PatchProgress::default(),
    }
}

/// Sets up a temporary directory for testing
pub fn setup_test_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("Failed to create temp directory")
}

/// Computes SHA256 hash of bytes
pub fn compute_hash(content: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(content);
    hex::encode(hasher.finalize())
}

/// Creates a realistic test environment with actual files
pub fn create_realistic_test_environment(base_path: &Path) -> (GameManifest, GameInstallation) {
    // Create actual files with real content
    let exe_content = b"This is the game executable content";
    let config_content = b"{\"resolution\": \"1920x1080\"}";
    let texture_content = vec![0x89, 0x50, 0x4E, 0x47]; // PNG magic bytes

    let exe_path = base_path.join("game.exe");
    let config_path = base_path.join("data/config.json");
    let texture_path = base_path.join("assets/texture.png");

    let exe_hash = create_test_file_with_content(&exe_path, exe_content);
    let config_hash = create_test_file_with_content(&config_path, config_content);
    let texture_hash = create_test_file_with_content(&texture_path, &texture_content);

    // Create manifest with actual hashes
    let manifest = GameManifest {
        game_id: "realistic-game".to_string(),
        name: "Realistic Test Game".to_string(),
        version: "1.0.0".to_string(),
        build_number: 1,
        channel: "stable".to_string(),
        description: None,
        icon_url: None,
        banner_url: None,
        executable: "game.exe".to_string(),
        files: vec![
            FileEntry {
                path: "game.exe".to_string(),
                hash: exe_hash.clone(),
                size: exe_content.len() as u64,
                url: "files/game.exe".to_string(),
                compress: Some(false),
            },
            FileEntry {
                path: "data/config.json".to_string(),
                hash: config_hash.clone(),
                size: config_content.len() as u64,
                url: "files/config.json".to_string(),
                compress: Some(false),
            },
            FileEntry {
                path: "assets/texture.png".to_string(),
                hash: texture_hash.clone(),
                size: texture_content.len() as u64,
                url: "files/texture.png".to_string(),
                compress: Some(true),
            },
        ],
        launch_args: None,

        platforms: None,
        size_bytes: None,
    };

    // Create installation record
    let mut installed_files = HashMap::new();
    installed_files.insert("game.exe".to_string(), exe_hash);
    installed_files.insert("data/config.json".to_string(), config_hash);
    installed_files.insert("assets/texture.png".to_string(), texture_hash);

    let installation = GameInstallation {
        game_id: "realistic-game".to_string(),
        installed_version: "1.0.0".to_string(),
        installed_build: 1,
        channel: "stable".to_string(),
        install_path: base_path.to_path_buf(),
        installed_files,
        installed_at: chrono::Utc::now(),
        last_played: None,
        total_playtime_seconds: 0,
        executable: "game.exe".to_string(),
    };

    (manifest, installation)
}

/// Assertion helpers
pub mod assertions {
    use std::path::Path;

    /// Assert that a file exists
    pub fn assert_file_exists(path: &Path) {
        assert!(path.exists(), "Expected file to exist: {}", path.display());
    }

    /// Assert that a file does not exist
    pub fn assert_file_not_exists(path: &Path) {
        assert!(
            !path.exists(),
            "Expected file to NOT exist: {}",
            path.display()
        );
    }

    /// Assert that a directory exists
    pub fn assert_dir_exists(path: &Path) {
        assert!(
            path.exists() && path.is_dir(),
            "Expected directory to exist: {}",
            path.display()
        );
    }

    /// Assert file content equals expected
    pub fn assert_file_content(path: &Path, expected: &[u8]) {
        let actual = std::fs::read(path).expect("Failed to read file");
        assert_eq!(
            actual,
            expected,
            "File content mismatch for {}",
            path.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_test_file_with_content() {
        let temp_dir = setup_test_dir();
        let file_path = temp_dir.path().join("test.txt");
        let content = b"Hello, World!";

        let hash = create_test_file_with_content(&file_path, content);

        assert!(file_path.exists());
        assertions::assert_file_content(&file_path, content);
        assert_eq!(hash.len(), 64); // SHA256 hex string length
    }

    #[test]
    fn test_create_test_manifest() {
        let manifest = create_test_manifest();

        assert_eq!(manifest.game_id, "test-game");
        assert_eq!(manifest.version, "1.0.0");
        assert_eq!(manifest.files.len(), 3);
    }

    #[test]
    fn test_create_test_installation() {
        let temp_dir = setup_test_dir();
        let installation = create_test_installation(temp_dir.path());

        assert_eq!(installation.game_id, "test-game");
        assert_eq!(installation.installed_files.len(), 3);
    }

    #[test]
    fn test_create_test_settings() {
        let settings = create_test_settings();

        assert_eq!(settings.max_concurrent_downloads, 4);
        assert_eq!(settings.language, "en");
        assert!(settings.auto_update_games);
    }

    #[test]
    fn test_compute_hash() {
        let content = b"test content";
        let hash1 = compute_hash(content);
        let hash2 = compute_hash(content);

        assert_eq!(hash1, hash2);
        assert_eq!(hash1.len(), 64);

        // Different content should have different hash
        let different_content = b"different content";
        let different_hash = compute_hash(different_content);
        assert_ne!(hash1, different_hash);
    }

    #[test]
    fn test_create_realistic_test_environment() {
        let temp_dir = setup_test_dir();
        let (manifest, installation) = create_realistic_test_environment(temp_dir.path());

        assert_eq!(manifest.game_id, "realistic-game");
        assert_eq!(installation.game_id, "realistic-game");

        // Verify files were created
        assertions::assert_file_exists(&temp_dir.path().join("game.exe"));
        assertions::assert_file_exists(&temp_dir.path().join("data/config.json"));
        assertions::assert_file_exists(&temp_dir.path().join("assets/texture.png"));

        // Verify hashes match
        for file in &manifest.files {
            let expected_hash = installation.installed_files.get(&file.path).unwrap();
            assert_eq!(&file.hash, expected_hash);
        }
    }
}
