//! Integration tests for the patching system
//!
//! These tests verify the complete patching flow including:
//! - File comparison and update detection
//! - Hash verification
//! - Installation persistence

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use pandawan_launcher_lib::patch::{
    compute_file_hash_sync, save_installation, load_installation, list_installations,
    VerificationResult,
};

// Re-export types from the library
use pandawan_launcher_lib::types::{FileEntry, GameInstallation, GameManifest};

/// Helper to create a temporary directory for tests
fn temp_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("Failed to create temp directory")
}

/// Helper to create a test file with content
fn create_test_file(path: &std::path::Path, content: &[u8]) -> String {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
    compute_file_hash_sync(path).unwrap()
}

// ============================================================================
// Hash Verification Integration Tests
// ============================================================================

#[test]
fn test_hash_verification_across_different_content() {
    let temp_dir = temp_dir();
    let base_path = temp_dir.path();

    // Create files with different content
    let file1 = base_path.join("file1.txt");
    let file2 = base_path.join("file2.txt");
    let file3 = base_path.join("file3.txt");

    create_test_file(&file1, b"content A");
    create_test_file(&file2, b"content B");
    create_test_file(&file3, b"content C");

    // Same content should produce same hash
    let file1_copy = base_path.join("file1_copy.txt");
    create_test_file(&file1_copy, b"content A");

    let hash1 = compute_file_hash_sync(&file1).unwrap();
    let hash1_copy = compute_file_hash_sync(&file1_copy).unwrap();
    let hash2 = compute_file_hash_sync(&file2).unwrap();
    let hash3 = compute_file_hash_sync(&file3).unwrap();

    assert_eq!(hash1, hash1_copy, "Same content should have same hash");
    assert_ne!(hash1, hash2, "Different content should have different hash");
    assert_ne!(hash1, hash3, "Different content should have different hash");
    assert_ne!(hash2, hash3, "Different content should have different hash");
}

#[test]
fn test_hash_verification_binary_content() {
    let temp_dir = temp_dir();
    let file_path = temp_dir.path().join("binary.bin");

    // Create binary content with various byte patterns
    let content: Vec<u8> = (0..=255).collect();
    let hash = create_test_file(&file_path, &content);

    assert_eq!(hash.len(), 64, "SHA256 hash should be 64 hex characters");

    // Verify hash is consistent
    let hash2 = compute_file_hash_sync(&file_path).unwrap();
    assert_eq!(hash, hash2, "Hash should be consistent for same file");
}

#[test]
fn test_hash_verification_large_file() {
    let temp_dir = temp_dir();
    let file_path = temp_dir.path().join("large.bin");

    // Create a 1MB file
    let content = vec![0xABu8; 1_048_576];
    create_test_file(&file_path, &content);

    let hash = compute_file_hash_sync(&file_path).unwrap();
    assert_eq!(hash.len(), 64);

    // Verify we can hash it again
    let hash2 = compute_file_hash_sync(&file_path).unwrap();
    assert_eq!(hash, hash2);
}

#[test]
fn test_hash_verification_empty_file() {
    let temp_dir = temp_dir();
    let file_path = temp_dir.path().join("empty.txt");

    fs::write(&file_path, b"").unwrap();

    let hash = compute_file_hash_sync(&file_path).unwrap();
    
    // SHA256 of empty content
    assert_eq!(
        hash,
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn test_hash_verification_nonexistent_file() {
    let temp_dir = temp_dir();
    let file_path = temp_dir.path().join("does_not_exist.txt");

    let result = compute_file_hash_sync(&file_path);
    assert!(result.is_err(), "Should fail for non-existent file");
}

// ============================================================================
// Installation Persistence Integration Tests
// ============================================================================

#[test]
fn test_save_and_load_installation_roundtrip() {
    let temp_dir = temp_dir();
    let app_data_dir = temp_dir.path();

    let mut installed_files = HashMap::new();
    installed_files.insert("game.exe".to_string(), "abc123".repeat(8));
    installed_files.insert("data/config.json".to_string(), "def456".repeat(8));

    let installation = GameInstallation {
        game_id: "test-game-123".to_string(),
        installed_version: "1.2.3".to_string(),
        installed_build: 456,
        install_path: PathBuf::from("/games/test-game-123"),
        installed_files: installed_files.clone(),
        installed_at: chrono::Utc::now(),
        last_played: Some(chrono::Utc::now()),
        total_playtime_seconds: 7200,
        executable: "game.exe".to_string(),
    };

    // Save
    save_installation(app_data_dir, &installation).unwrap();

    // Load
    let loaded = load_installation(app_data_dir, &installation.game_id)
        .unwrap()
        .expect("Installation should exist");

    // Verify
    assert_eq!(loaded.game_id, installation.game_id);
    assert_eq!(loaded.installed_version, installation.installed_version);
    assert_eq!(loaded.installed_build, installation.installed_build);
    assert_eq!(loaded.install_path, installation.install_path);
    assert_eq!(loaded.total_playtime_seconds, installation.total_playtime_seconds);
    assert_eq!(loaded.executable, installation.executable);
    assert_eq!(loaded.installed_files.len(), installation.installed_files.len());
}

#[test]
fn test_load_nonexistent_installation() {
    let temp_dir = temp_dir();
    let app_data_dir = temp_dir.path();

    let result = load_installation(app_data_dir, "nonexistent-game").unwrap();
    assert!(result.is_none(), "Should return None for non-existent installation");
}

#[test]
fn test_list_multiple_installations() {
    let temp_dir = temp_dir();
    let app_data_dir = temp_dir.path();

    // Create multiple installations
    let games = vec![
        ("game-a", "1.0.0", 100u64),
        ("game-b", "2.0.0", 200u64),
        ("game-c", "1.5.0", 150u64),
    ];

    for (game_id, version, build) in &games {
        let installation = GameInstallation {
            game_id: game_id.to_string(),
            installed_version: version.to_string(),
            installed_build: *build,
            install_path: PathBuf::from(format!("/games/{}", game_id)),
            installed_files: HashMap::new(),
            installed_at: chrono::Utc::now(),
            last_played: None,
            total_playtime_seconds: 0,
            executable: "game.exe".to_string(),
        };
        save_installation(app_data_dir, &installation).unwrap();
    }

    // List all installations
    let installations = list_installations(app_data_dir).unwrap();
    assert_eq!(installations.len(), 3, "Should list all 3 installations");

    // Verify all games are present
    let game_ids: Vec<_> = installations.iter().map(|i| i.game_id.clone()).collect();
    assert!(game_ids.contains(&"game-a".to_string()));
    assert!(game_ids.contains(&"game-b".to_string()));
    assert!(game_ids.contains(&"game-c".to_string()));
}

#[test]
fn test_list_installations_with_corrupted_files() {
    let temp_dir = temp_dir();
    let app_data_dir = temp_dir.path();
    let installs_dir = app_data_dir.join("installations");

    // Create a valid installation
    let valid = GameInstallation {
        game_id: "valid-game".to_string(),
        installed_version: "1.0.0".to_string(),
        installed_build: 1,
        install_path: PathBuf::from("/valid"),
        installed_files: HashMap::new(),
        installed_at: chrono::Utc::now(),
        last_played: None,
        total_playtime_seconds: 0,
        executable: "game.exe".to_string(),
    };
    save_installation(app_data_dir, &valid).unwrap();

    // Create a corrupted JSON file
    fs::create_dir_all(&installs_dir).unwrap();
    fs::write(installs_dir.join("corrupted.json"), "{ not valid json").unwrap();

    // Create a non-JSON file
    fs::write(installs_dir.join("readme.txt"), "This is not JSON").unwrap();

    // List should only return valid installation
    let installations = list_installations(app_data_dir).unwrap();
    assert_eq!(installations.len(), 1);
    assert_eq!(installations[0].game_id, "valid-game");
}

#[test]
fn test_list_installations_empty_directory() {
    let temp_dir = temp_dir();
    let app_data_dir = temp_dir.path();

    // Create installations directory but no files
    fs::create_dir_all(app_data_dir.join("installations")).unwrap();

    let installations = list_installations(app_data_dir).unwrap();
    assert!(installations.is_empty());
}

#[test]
fn test_list_installations_no_directory() {
    let temp_dir = temp_dir();
    let app_data_dir = temp_dir.path();

    // Don't create installations directory
    let installations = list_installations(app_data_dir).unwrap();
    assert!(installations.is_empty());
}

#[test]
fn test_save_installation_creates_directory_structure() {
    let temp_dir = temp_dir();
    let app_data_dir = temp_dir.path().join("deep").join("nested").join("path");

    let installation = GameInstallation {
        game_id: "deep-game".to_string(),
        installed_version: "1.0.0".to_string(),
        installed_build: 1,
        install_path: PathBuf::from("/test"),
        installed_files: HashMap::new(),
        installed_at: chrono::Utc::now(),
        last_played: None,
        total_playtime_seconds: 0,
        executable: "game.exe".to_string(),
    };

    // Save should create all necessary directories
    save_installation(&app_data_dir, &installation).unwrap();

    assert!(app_data_dir.join("installations").exists());
    assert!(app_data_dir.join("installations").join("deep-game.json").exists());
}

#[test]
fn test_update_existing_installation() {
    let temp_dir = temp_dir();
    let app_data_dir = temp_dir.path();

    // Create initial installation
    let installation_v1 = GameInstallation {
        game_id: "update-test".to_string(),
        installed_version: "1.0.0".to_string(),
        installed_build: 1,
        install_path: PathBuf::from("/games/v1"),
        installed_files: HashMap::new(),
        installed_at: chrono::Utc::now(),
        last_played: None,
        total_playtime_seconds: 0,
        executable: "game.exe".to_string(),
    };
    save_installation(app_data_dir, &installation_v1).unwrap();

    // Update to v2
    let installation_v2 = GameInstallation {
        game_id: "update-test".to_string(),
        installed_version: "2.0.0".to_string(),
        installed_build: 2,
        install_path: PathBuf::from("/games/v2"),
        installed_files: {
            let mut files = HashMap::new();
            files.insert("new_file.txt".to_string(), "hash123".to_string());
            files
        },
        installed_at: chrono::Utc::now(),
        last_played: Some(chrono::Utc::now()),
        total_playtime_seconds: 3600,
        executable: "game.exe".to_string(),
    };
    save_installation(app_data_dir, &installation_v2).unwrap();

    // Load and verify it's v2
    let loaded = load_installation(app_data_dir, "update-test")
        .unwrap()
        .unwrap();
    assert_eq!(loaded.installed_version, "2.0.0");
    assert_eq!(loaded.installed_build, 2);
    assert_eq!(loaded.total_playtime_seconds, 3600);
    assert!(loaded.installed_files.contains_key("new_file.txt"));
}

// ============================================================================
// Verification Result Tests
// ============================================================================

#[test]
fn test_verification_result_all_valid() {
    let result = VerificationResult {
        valid_files: 10,
        invalid_files: vec![],
        missing_files: vec![],
        is_valid: true,
    };

    assert!(result.is_valid);
    assert_eq!(result.total_files(), 10);
    assert_eq!(result.problematic_count(), 0);
    assert!(result.summary().contains("successfully"));
}

#[test]
fn test_verification_result_with_problems() {
    let result = VerificationResult {
        valid_files: 7,
        invalid_files: vec!["corrupt1.txt".to_string(), "corrupt2.txt".to_string()],
        missing_files: vec!["missing1.txt".to_string()],
        is_valid: false,
    };

    assert!(!result.is_valid);
    assert_eq!(result.total_files(), 10);
    assert_eq!(result.problematic_count(), 3);
    assert!(result.summary().contains("failed"));
    assert!(result.summary().contains("7 valid"));
    assert!(result.summary().contains("2 invalid"));
    assert!(result.summary().contains("1 missing"));
}

#[test]
fn test_verification_result_is_file_problematic() {
    let result = VerificationResult {
        valid_files: 5,
        invalid_files: vec!["bad_file.txt".to_string()],
        missing_files: vec!["gone_file.txt".to_string()],
        is_valid: false,
    };

    assert!(result.is_file_problematic("bad_file.txt"));
    assert!(result.is_file_problematic("gone_file.txt"));
    assert!(!result.is_file_problematic("good_file.txt"));
}

// ============================================================================
// File Entry and Manifest Integration Tests
// ============================================================================

#[test]
fn test_file_entry_with_hash() {
    let temp_dir = temp_dir();
    let file_path = temp_dir.path().join("test.txt");
    
    let content = b"test content for hashing";
    let expected_hash = create_test_file(&file_path, content);

    let entry = FileEntry {
        path: "test.txt".to_string(),
        hash: expected_hash,
        size: content.len() as u64,
        url: "files/test.txt".to_string(),
        compress: Some(false),
    };

    // Verify the actual hash matches
    let actual_hash = compute_file_hash_sync(&file_path).unwrap();
    assert_eq!(entry.hash, actual_hash);
}

#[test]
fn test_manifest_file_validation() {
    let temp_dir = temp_dir();
    let base_path = temp_dir.path();

    // Create actual files
    let exe_path = base_path.join("game.exe");
    let config_path = base_path.join("config.json");
    
    let exe_hash = create_test_file(&exe_path, b"game executable");
    let config_hash = create_test_file(&config_path, b"{\"key\": \"value\"}");

    let manifest = GameManifest {
        game_id: "real-game".to_string(),
        name: "Real Game".to_string(),
        version: "1.0.0".to_string(),
        build_number: 1,
        description: None,
        icon_url: None,
        banner_url: None,
        executable: "game.exe".to_string(),
        files: vec![
            FileEntry {
                path: "game.exe".to_string(),
                hash: exe_hash,
                size: fs::metadata(&exe_path).unwrap().len(),
                url: "game.exe".to_string(),
                compress: None,
            },
            FileEntry {
                path: "config.json".to_string(),
                hash: config_hash,
                size: fs::metadata(&config_path).unwrap().len(),
                url: "config.json".to_string(),
                compress: None,
            },
        ],
        launch_args: None,
    };

    // Verify all files in manifest exist and have correct hashes
    for file in &manifest.files {
        let file_path = base_path.join(&file.path);
        assert!(file_path.exists());
        
        let actual_hash = compute_file_hash_sync(&file_path).unwrap();
        assert_eq!(actual_hash, file.hash, "Hash mismatch for {}", file.path);
    }
}

// ============================================================================
// Complex Scenario Tests
// ============================================================================

#[test]
fn test_complete_installation_scenario() {
    let temp_dir = temp_dir();
    let app_data_dir = temp_dir.path().join("app_data");
    let install_dir = temp_dir.path().join("install");

    // 1. Create game files
    fs::create_dir_all(&install_dir.join("data")).unwrap();
    let exe_path = install_dir.join("game.exe");
    let data_path = install_dir.join("data").join("assets.pak");
    
    create_test_file(&exe_path, b"game executable v1.0");
    create_test_file(&data_path, b"game assets v1.0");

    // 2. Create manifest with actual hashes
    let manifest = GameManifest {
        game_id: "scenario-game".to_string(),
        name: "Scenario Game".to_string(),
        version: "1.0.0".to_string(),
        build_number: 100,
        description: None,
        icon_url: None,
        banner_url: None,
        executable: "game.exe".to_string(),
        files: vec![
            FileEntry {
                path: "game.exe".to_string(),
                hash: compute_file_hash_sync(&exe_path).unwrap(),
                size: fs::metadata(&exe_path).unwrap().len(),
                url: "game.exe".to_string(),
                compress: None,
            },
            FileEntry {
                path: "data/assets.pak".to_string(),
                hash: compute_file_hash_sync(&data_path).unwrap(),
                size: fs::metadata(&data_path).unwrap().len(),
                url: "data/assets.pak".to_string(),
                compress: None,
            },
        ],
        launch_args: None,
    };

    // 3. Save installation record
    let mut installed_files = HashMap::new();
    for file in &manifest.files {
        installed_files.insert(file.path.clone(), file.hash.clone());
    }

    let installation = GameInstallation {
        game_id: manifest.game_id.clone(),
        installed_version: manifest.version.clone(),
        installed_build: manifest.build_number,
        install_path: install_dir.clone(),
        installed_files,
        installed_at: chrono::Utc::now(),
        last_played: None,
        total_playtime_seconds: 0,
        executable: manifest.executable.clone(),
    };

    save_installation(&app_data_dir, &installation).unwrap();

    // 4. Verify installation can be loaded
    let loaded = load_installation(&app_data_dir, &manifest.game_id)
        .unwrap()
        .unwrap();
    
    assert_eq!(loaded.game_id, "scenario-game");
    assert_eq!(loaded.installed_files.len(), 2);

    // 5. Verify actual files match the recorded hashes
    for (path, expected_hash) in &loaded.installed_files {
        let file_path = install_dir.join(path);
        let actual_hash = compute_file_hash_sync(&file_path).unwrap();
        assert_eq!(&actual_hash, expected_hash, "File {} hash mismatch", path);
    }

    // 6. Simulate an update (modify one file)
    create_test_file(&exe_path, b"game executable v1.1");
    
    // 7. Verify hash has changed
    let new_hash = compute_file_hash_sync(&exe_path).unwrap();
    assert_ne!(new_hash, manifest.files[0].hash);

    // 8. Update installation record
    let updated_installation = GameInstallation {
        game_id: manifest.game_id.clone(),
        installed_version: "1.1.0".to_string(),
        installed_build: 101,
        install_path: install_dir.clone(),
        installed_files: {
            let mut files = HashMap::new();
            files.insert("game.exe".to_string(), new_hash.clone());
            files.insert(
                "data/assets.pak".to_string(),
                manifest.files[1].hash.clone(),
            );
            files
        },
        installed_at: loaded.installed_at,
        last_played: Some(chrono::Utc::now()),
        total_playtime_seconds: 3600,
        executable: manifest.executable.clone(),
    };

    save_installation(&app_data_dir, &updated_installation).unwrap();

    // 9. Verify updated installation
    let final_loaded = load_installation(&app_data_dir, &manifest.game_id)
        .unwrap()
        .unwrap();
    
    assert_eq!(final_loaded.installed_version, "1.1.0");
    assert_eq!(final_loaded.installed_build, 101);
    assert_eq!(final_loaded.installed_files.get("game.exe").unwrap(), &new_hash);
}

#[test]
fn test_corrupted_file_detection() {
    let temp_dir = temp_dir();
    let install_dir = temp_dir.path().join("install");
    fs::create_dir_all(&install_dir).unwrap();

    // Create a file
    let file_path = install_dir.join("important.dat");
    create_test_file(&file_path, b"original data");
    let original_hash = compute_file_hash_sync(&file_path).unwrap();

    // Record the "expected" hash
    let expected_hash = original_hash.clone();

    // Simulate corruption (modify the file)
    fs::write(&file_path, b"corrupted data").unwrap();

    // Verify hash no longer matches
    let current_hash = compute_file_hash_sync(&file_path).unwrap();
    assert_ne!(current_hash, expected_hash, "Corrupted file should have different hash");

    // Create verification result
    let result = VerificationResult {
        valid_files: 0,
        invalid_files: vec!["important.dat".to_string()],
        missing_files: vec![],
        is_valid: false,
    };

    assert!(!result.is_valid);
    assert!(result.is_file_problematic("important.dat"));
}

#[test]
fn test_missing_file_detection() {
    let temp_dir = temp_dir();
    let install_dir = temp_dir.path().join("install");
    fs::create_dir_all(&install_dir).unwrap();

    // Expected files
    let expected_files = vec![
        ("file1.txt", "abc123"),
        ("file2.txt", "def456"),
        ("file3.txt", "ghi789"),
    ];

    // Only create some files
    create_test_file(&install_dir.join("file1.txt"), b"content1");
    create_test_file(&install_dir.join("file2.txt"), b"content2");
    // file3.txt is missing

    // Check which files exist
    let mut missing = Vec::new();
    let mut present = Vec::new();

    for (filename, _) in &expected_files {
        let path = install_dir.join(filename);
        if path.exists() {
            present.push(*filename);
        } else {
            missing.push(*filename);
        }
    }

    assert_eq!(present.len(), 2);
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0], "file3.txt");
}
