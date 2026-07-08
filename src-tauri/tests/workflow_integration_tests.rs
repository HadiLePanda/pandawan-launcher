//! End-to-end workflow integration tests
//!
//! These tests verify complete workflows:
//! - Full installation workflow
//! - Update workflow
//! - Verification workflow
//! - Error recovery workflow

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use pandawan_launcher_lib::download::progress;
use pandawan_launcher_lib::patch::{
    compute_file_hash_sync, list_installations, load_installation, save_installation,
    VerificationResult,
};
use pandawan_launcher_lib::types::*;

fn temp_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("Failed to create temp directory")
}

fn create_test_file(path: &std::path::Path, content: &[u8]) -> String {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
    compute_file_hash_sync(path).unwrap()
}

// ============================================================================
// Full Installation Workflow Tests
// ============================================================================

#[test]
fn test_complete_new_installation_workflow() {
    let temp_dir = temp_dir();
    let app_data_dir = temp_dir.path().join("app_data");
    let install_dir = temp_dir.path().join("install");

    // Step 1: Create a game manifest
    let manifest = GameManifest {
        game_id: "new-game-workflow".to_string(),
        name: "New Game Workflow".to_string(),
        version: "1.0.0".to_string(),
        build_number: 100,
        description: Some("A test game".to_string()),
        icon_url: None,
        banner_url: None,
        executable: "game.exe".to_string(),
        files: vec![
            FileEntry {
                path: "game.exe".to_string(),
                hash: "placeholder_hash_1".to_string(),
                size: 10_000_000,
                url: "files/game.exe".to_string(),
                compress: Some(false),
            },
            FileEntry {
                path: "data/assets.pak".to_string(),
                hash: "placeholder_hash_2".to_string(),
                size: 100_000_000,
                url: "files/assets.pak".to_string(),
                compress: Some(true),
            },
        ],
        launch_args: Some(vec!["--fullscreen".to_string()]),
    };

    // Step 2: Simulate downloading and creating files
    fs::create_dir_all(install_dir.join("data")).unwrap();

    let exe_content = b"game executable content";
    let assets_content = vec![0xABu8; 1000]; // Simulated asset data

    let exe_hash = create_test_file(&install_dir.join("game.exe"), exe_content);
    let assets_hash = create_test_file(
        &install_dir.join("data").join("assets.pak"),
        &assets_content,
    );

    // Step 3: Create installation record with actual hashes
    let mut installed_files = HashMap::new();
    installed_files.insert("game.exe".to_string(), exe_hash.clone());
    installed_files.insert("data/assets.pak".to_string(), assets_hash.clone());

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

    // Step 4: Save installation
    save_installation(&app_data_dir, &installation).unwrap();

    // Step 5: Verify installation was saved correctly
    let loaded = load_installation(&app_data_dir, &manifest.game_id)
        .unwrap()
        .expect("Installation should exist");

    assert_eq!(loaded.game_id, manifest.game_id);
    assert_eq!(loaded.installed_version, manifest.version);
    assert_eq!(loaded.installed_files.len(), 2);

    // Step 6: Verify files match hashes
    for (path, expected_hash) in &loaded.installed_files {
        let file_path = install_dir.join(path);
        let actual_hash = compute_file_hash_sync(&file_path).unwrap();
        assert_eq!(&actual_hash, expected_hash, "Hash mismatch for {}", path);
    }

    // Step 7: Calculate total size
    let total_size: u64 = manifest.files.iter().map(|f| f.size).sum();
    assert_eq!(total_size, 110_000_000);

    // Step 8: Format for display
    assert_eq!(progress::format_bytes(total_size), "110.0 MB");
}

#[test]
fn test_update_workflow_with_version_change() {
    let temp_dir = temp_dir();
    let app_data_dir = temp_dir.path();
    let install_dir = temp_dir.path().join("install");

    // Step 1: Create initial v1 installation
    fs::create_dir_all(&install_dir).unwrap();

    let v1_content = b"game v1 content";
    let v1_hash = create_test_file(&install_dir.join("game.exe"), v1_content);

    let v1_installation = GameInstallation {
        game_id: "update-workflow-game".to_string(),
        installed_version: "1.0.0".to_string(),
        installed_build: 100,
        install_path: install_dir.clone(),
        installed_files: {
            let mut files = HashMap::new();
            files.insert("game.exe".to_string(), v1_hash.clone());
            files
        },
        installed_at: chrono::Utc::now(),
        last_played: Some(chrono::Utc::now()),
        total_playtime_seconds: 3600,
        executable: "game.exe".to_string(),
    };

    save_installation(app_data_dir, &v1_installation).unwrap();

    // Step 2: Create v2 manifest
    let v2_manifest = GameManifest {
        game_id: "update-workflow-game".to_string(),
        name: "Update Workflow Game".to_string(),
        version: "1.1.0".to_string(),
        build_number: 110,
        description: None,
        icon_url: None,
        banner_url: None,
        executable: "game.exe".to_string(),
        files: vec![
            FileEntry {
                path: "game.exe".to_string(),
                hash: "new_v2_hash".to_string(), // Different hash
                size: 15_000_000,
                url: "files/v1.1/game.exe".to_string(),
                compress: None,
            },
            FileEntry {
                path: "new_feature.dll".to_string(), // New file
                hash: "dll_hash".to_string(),
                size: 5_000_000,
                url: "files/v1.1/new_feature.dll".to_string(),
                compress: None,
            },
        ],
        launch_args: None,
    };

    // Step 3: Check if update is needed
    let loaded = load_installation(app_data_dir, &v2_manifest.game_id)
        .unwrap()
        .unwrap();

    let needs_update = loaded.installed_build < v2_manifest.build_number;
    assert!(needs_update, "Should need update");

    // Step 4: Simulate update - create new files
    let v2_content = b"game v2 content - updated";
    let v2_hash = create_test_file(&install_dir.join("game.exe"), v2_content);
    let dll_hash = create_test_file(&install_dir.join("new_feature.dll"), b"dll content");

    // Step 5: Update installation record
    let v2_installation = GameInstallation {
        game_id: v2_manifest.game_id.clone(),
        installed_version: v2_manifest.version.clone(),
        installed_build: v2_manifest.build_number,
        install_path: install_dir.clone(),
        installed_files: {
            let mut files = HashMap::new();
            files.insert("game.exe".to_string(), v2_hash);
            files.insert("new_feature.dll".to_string(), dll_hash);
            files
        },
        installed_at: loaded.installed_at,
        last_played: loaded.last_played,
        total_playtime_seconds: loaded.total_playtime_seconds + 1800, // Additional playtime
        executable: v2_manifest.executable.clone(),
    };

    save_installation(app_data_dir, &v2_installation).unwrap();

    // Step 6: Verify update
    let updated = load_installation(app_data_dir, &v2_manifest.game_id)
        .unwrap()
        .unwrap();

    assert_eq!(updated.installed_version, "1.1.0");
    assert_eq!(updated.installed_build, 110);
    assert_eq!(updated.installed_files.len(), 2);
    assert_eq!(updated.total_playtime_seconds, 5400); // 1.5 hours
}

#[test]
fn test_verification_workflow() {
    let temp_dir = temp_dir();
    let install_dir = temp_dir.path().join("install");
    fs::create_dir_all(&install_dir).unwrap();

    // Step 1: Create files
    let exe_content = b"game executable";
    let config_content = b"{\"version\": \"1.0\"}";
    let missing_content = b"this file will be missing";

    let exe_path = install_dir.join("game.exe");
    let config_path = install_dir.join("config.json");
    // Don't create missing.dat

    let exe_hash = create_test_file(&exe_path, exe_content);
    let config_hash = create_test_file(&config_path, config_content);
    let missing_hash = {
        // Compute hash but don't save file
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(missing_content);
        hex::encode(hasher.finalize())
    };

    // Step 2: Create manifest
    let manifest = GameManifest {
        game_id: "verify-test".to_string(),
        name: "Verification Test".to_string(),
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
                size: exe_content.len() as u64,
                url: "game.exe".to_string(),
                compress: None,
            },
            FileEntry {
                path: "config.json".to_string(),
                hash: config_hash,
                size: config_content.len() as u64,
                url: "config.json".to_string(),
                compress: None,
            },
            FileEntry {
                path: "missing.dat".to_string(),
                hash: missing_hash,
                size: missing_content.len() as u64,
                url: "missing.dat".to_string(),
                compress: None,
            },
        ],
        launch_args: None,
    };

    // Step 3: Verify installation
    let mut valid_files = 0;
    let mut invalid_files = Vec::new();
    let mut missing_files = Vec::new();

    for file_entry in &manifest.files {
        let file_path = install_dir.join(&file_entry.path);

        if !file_path.exists() {
            missing_files.push(file_entry.path.clone());
            continue;
        }

        match compute_file_hash_sync(&file_path) {
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

    let result = VerificationResult {
        valid_files,
        invalid_files: invalid_files.clone(),
        missing_files: missing_files.clone(),
        is_valid,
    };

    // Step 4: Verify results
    assert!(!result.is_valid);
    assert_eq!(result.valid_files, 2); // game.exe and config.json
    assert_eq!(result.invalid_files.len(), 0);
    assert_eq!(result.missing_files.len(), 1);
    assert!(result.missing_files.contains(&"missing.dat".to_string()));

    // Step 5: Generate summary
    let summary = result.summary();
    assert!(summary.contains("failed"));
    assert!(summary.contains("2 valid"));
    assert!(summary.contains("1 missing"));
}

#[test]
fn test_corrupted_file_recovery_workflow() {
    let temp_dir = temp_dir();
    let install_dir = temp_dir.path().join("install");
    fs::create_dir_all(&install_dir).unwrap();

    // Step 1: Create original file
    let original_content = b"original game data";
    let file_path = install_dir.join("game.dat");
    let original_hash = create_test_file(&file_path, original_content);

    // Step 2: Create manifest
    let manifest = GameManifest {
        game_id: "corrupt-test".to_string(),
        name: "Corruption Test".to_string(),
        version: "1.0.0".to_string(),
        build_number: 1,
        description: None,
        icon_url: None,
        banner_url: None,
        executable: "game.exe".to_string(),
        files: vec![FileEntry {
            path: "game.dat".to_string(),
            hash: original_hash.clone(),
            size: original_content.len() as u64,
            url: "game.dat".to_string(),
            compress: None,
        }],
        launch_args: None,
    };

    // Step 3: Verify initial state
    let initial_hash = compute_file_hash_sync(&file_path).unwrap();
    assert_eq!(initial_hash, original_hash);

    // Step 4: Simulate corruption
    fs::write(&file_path, b"corrupted game data!!!").unwrap();
    let corrupted_hash = compute_file_hash_sync(&file_path).unwrap();
    assert_ne!(corrupted_hash, original_hash);

    // Step 5: Detect corruption through verification
    let current_hash = compute_file_hash_sync(&file_path).unwrap();
    let is_corrupted = current_hash != manifest.files[0].hash;
    assert!(is_corrupted);

    // Step 6: Simulate re-download (restore original)
    create_test_file(&file_path, original_content);

    // Step 7: Verify fixed
    let fixed_hash = compute_file_hash_sync(&file_path).unwrap();
    assert_eq!(fixed_hash, original_hash);
}

// ============================================================================
// Multiple Games Management Tests
// ============================================================================

#[test]
fn test_multiple_games_management() {
    let temp_dir = temp_dir();
    let app_data_dir = temp_dir.path();

    // Create multiple game installations
    let games = vec![
        ("game-alpha", "Alpha Game", "1.0.0", 100u64),
        ("game-beta", "Beta Game", "2.0.0", 200u64),
        ("game-gamma", "Gamma Game", "1.5.0", 150u64),
    ];

    for (game_id, _name, version, build) in games {
        let installation = GameInstallation {
            game_id: game_id.to_string(),
            installed_version: version.to_string(),
            installed_build: build,
            install_path: PathBuf::from(format!("/games/{}", game_id)),
            installed_files: HashMap::new(),
            installed_at: chrono::Utc::now(),
            last_played: if game_id == "game-alpha" {
                Some(chrono::Utc::now())
            } else {
                None
            },
            total_playtime_seconds: match game_id {
                "game-alpha" => 7200,
                "game-beta" => 3600,
                _ => 0,
            },
            executable: "game.exe".to_string(),
        };

        save_installation(app_data_dir, &installation).unwrap();
    }

    // List all installations
    let installations = list_installations(app_data_dir).unwrap();
    assert_eq!(installations.len(), 3);

    // Find specific game
    let alpha = installations
        .iter()
        .find(|i| i.game_id == "game-alpha")
        .unwrap();
    assert_eq!(alpha.installed_version, "1.0.0");
    assert!(alpha.last_played.is_some());
    assert_eq!(alpha.total_playtime_seconds, 7200);

    // Remove one game
    fs::remove_file(app_data_dir.join("installations").join("game-beta.json")).unwrap();

    // Verify removal
    let installations = list_installations(app_data_dir).unwrap();
    assert_eq!(installations.len(), 2);
    assert!(!installations.iter().any(|i| i.game_id == "game-beta"));
}

// ============================================================================
// Progress Tracking Workflow Tests
// ============================================================================

#[test]
fn test_download_progress_tracking() {
    // Simulate a download progress scenario
    let total_size = 1_000_000_000u64; // 1 GB
    let chunk_size = 10_000_000u64; // 10 MB chunks

    let mut downloaded = 0u64;
    let mut progress_history = Vec::new();

    while downloaded < total_size {
        // Simulate receiving a chunk
        let chunk = std::cmp::min(chunk_size, total_size - downloaded);
        downloaded += chunk;

        // Calculate progress
        let percent = progress::percentage(downloaded, total_size);
        progress_history.push((downloaded, percent));
    }

    // Verify progress reached 100%
    assert_eq!(downloaded, total_size);
    assert_eq!(progress_history.last().unwrap().1, 100.0);

    // Verify progress increases monotonically
    for i in 1..progress_history.len() {
        assert!(
            progress_history[i].0 > progress_history[i - 1].0,
            "Downloaded bytes should increase"
        );
        assert!(
            progress_history[i].1 >= progress_history[i - 1].1,
            "Percentage should not decrease"
        );
    }
}

#[test]
fn test_speed_calculation_over_time() {
    // Simulate speed calculation over multiple intervals
    let _chunk_size = 1_000_000u64; // 1 MB per chunk
    let interval_duration = 0.5f64; // 500ms intervals

    let speeds = vec![
        2_000_000.0, // 2 MB/s
        2_500_000.0, // 2.5 MB/s
        1_800_000.0, // 1.8 MB/s
        2_200_000.0, // 2.2 MB/s
    ];

    let mut total_downloaded = 0u64;

    for speed in &speeds {
        let bytes_in_interval = (speed * interval_duration) as u64;
        total_downloaded += bytes_in_interval;
    }

    // Calculate average speed
    let total_time = speeds.len() as f64 * interval_duration;
    let average_speed = total_downloaded as f64 / total_time;

    // Average should be approximately the mean of individual speeds
    let expected_average = speeds.iter().sum::<f64>() / speeds.len() as f64;
    assert!((average_speed - expected_average).abs() < 1.0);
}

// ============================================================================
// Error Handling Workflow Tests
// ============================================================================

#[test]
fn test_error_classification_workflow() {
    use pandawan_launcher_lib::download::DownloadError;

    // Classify various errors
    let errors = vec![
        (DownloadError::Cancelled, false, "cancelled"),
        (DownloadError::HttpError("500".to_string()), true, "http"),
        (DownloadError::HttpError("404".to_string()), true, "http"),
        (
            DownloadError::HashMismatch {
                expected: "a".to_string(),
                actual: "b".to_string(),
            },
            false,
            "corrupted",
        ),
        (DownloadError::Task("failed".to_string()), true, "task"),
    ];

    for (error, expected_retryable, _name) in errors {
        let is_retryable = error.is_retryable();
        assert_eq!(
            is_retryable, expected_retryable,
            "Error {:?} retryable classification mismatch",
            error
        );

        let user_msg = error.user_message();
        assert!(!user_msg.is_empty(), "Error should have a user message");
    }
}

#[test]
fn test_recovery_from_partial_failure() {
    let temp_dir = temp_dir();
    let _app_data_dir = temp_dir.path();
    let install_dir = temp_dir.path().join("install");

    // Simulate a download that partially failed
    fs::create_dir_all(install_dir.join("data")).unwrap();

    // File 1: Successfully downloaded
    let file1_content = b"complete file data";
    create_test_file(&install_dir.join("file1.txt"), file1_content);

    // File 2: Partially downloaded (simulated)
    let file2_complete_content = vec![0xABu8; 1000];
    let file2_partial_content = &file2_complete_content[0..400];
    fs::write(install_dir.join("file2.bin"), file2_partial_content).unwrap();

    // File 3: Missing (download failed)
    // Don't create file3.dat

    // Create manifest
    let manifest = GameManifest {
        game_id: "recovery-test".to_string(),
        name: "Recovery Test".to_string(),
        version: "1.0.0".to_string(),
        build_number: 1,
        description: None,
        icon_url: None,
        banner_url: None,
        executable: "game.exe".to_string(),
        files: vec![
            FileEntry {
                path: "file1.txt".to_string(),
                hash: compute_file_hash_sync(&install_dir.join("file1.txt")).unwrap(),
                size: file1_content.len() as u64,
                url: "file1.txt".to_string(),
                compress: None,
            },
            FileEntry {
                path: "file2.bin".to_string(),
                hash: {
                    use sha2::{Digest, Sha256};
                    let mut hasher = Sha256::new();
                    hasher.update(&file2_complete_content);
                    hex::encode(hasher.finalize())
                },
                size: file2_complete_content.len() as u64,
                url: "file2.bin".to_string(),
                compress: None,
            },
            FileEntry {
                path: "file3.dat".to_string(),
                hash: "expected_hash".to_string(),
                size: 100,
                url: "file3.dat".to_string(),
                compress: None,
            },
        ],
        launch_args: None,
    };

    // Determine which files need re-download
    let mut files_to_update = Vec::new();

    for file_entry in &manifest.files {
        let file_path = install_dir.join(&file_entry.path);

        if !file_path.exists() {
            files_to_update.push(file_entry.clone());
            continue;
        }

        match compute_file_hash_sync(&file_path) {
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

    // Should need to update file2 (wrong hash) and file3 (missing)
    assert_eq!(files_to_update.len(), 2);
    assert!(files_to_update.iter().any(|f| f.path == "file2.bin"));
    assert!(files_to_update.iter().any(|f| f.path == "file3.dat"));
    assert!(!files_to_update.iter().any(|f| f.path == "file1.txt"));
}

// ============================================================================
// Settings and Configuration Workflow Tests
// ============================================================================

#[test]
fn test_settings_migration_workflow() {
    // Simulate settings from older version (partial fields)
    let old_settings_json = r#"
    {
        "language": "en",
        "max_concurrent_downloads": 4
    }
    "#;

    // Should deserialize with defaults for missing fields
    let settings: LauncherSettings = serde_json::from_str(old_settings_json).unwrap();

    assert_eq!(settings.language, "en");
    assert_eq!(settings.max_concurrent_downloads, 4);
    // Missing fields should use defaults
    assert!(settings.auto_update_games); // Default
    assert!(settings.auto_update_launcher); // Default
    assert!(!settings.close_to_tray); // Default
}

#[test]
fn test_settings_validation_workflow() {
    // Invalid settings that should fail validation
    let invalid_settings = vec![
        LauncherSettings {
            max_concurrent_downloads: 0,
            ..Default::default()
        },
        LauncherSettings {
            language: "".to_string(),
            ..Default::default()
        },
        LauncherSettings {
            max_download_speed: Some(0),
            ..Default::default()
        },
    ];

    for settings in invalid_settings {
        assert!(
            settings.validate().is_err(),
            "Settings should fail validation"
        );
    }

    // Valid settings
    let valid = LauncherSettings::default();
    assert!(valid.validate().is_ok(), "Default settings should be valid");
}

// ============================================================================
// Real-world Scenario Tests
// ============================================================================

#[test]
fn test_large_game_workflow() {
    // Simulate a 50GB game installation
    let total_size_gb = 50u64;
    let total_size_bytes = total_size_gb * 1_000_000_000;

    let files = [
        ("game.exe", 100_000_000u64),             // 100 MB
        ("data/pak0.pak", 10_000_000_000u64),     // 10 GB
        ("data/pak1.pak", 10_000_000_000u64),     // 10 GB
        ("data/pak2.pak", 10_000_000_000u64),     // 10 GB
        ("data/pak3.pak", 10_000_000_000u64),     // 10 GB
        ("content/videos.bik", 5_000_000_000u64), // 5 GB
        ("content/audio.fsb", 4_900_000_000u64),  // ~5 GB
    ];

    // Verify total size
    let calculated_total: u64 = files.iter().map(|(_, size)| size).sum();
    assert_eq!(calculated_total, total_size_bytes);

    // Calculate download time at various speeds
    let speeds = vec![
        (10_000_000.0, "10 MB/s"),   // Slow connection
        (50_000_000.0, "50 MB/s"),   // Average connection
        (100_000_000.0, "100 MB/s"), // Fast connection
    ];

    for (speed_bps, _desc) in speeds {
        let time_seconds = total_size_bytes as f64 / speed_bps;
        let time_hours = time_seconds / 3600.0;

        // Just verify calculation produces reasonable results
        assert!(time_seconds > 0.0);
        assert!(time_hours > 0.0);
    }

    // Format display
    assert_eq!(progress::format_bytes(total_size_bytes), "50.00 GB");
}

#[test]
fn test_rapid_update_workflow() {
    let temp_dir = temp_dir();
    let app_data_dir = temp_dir.path();

    // Simulate multiple rapid updates
    let versions = vec![
        ("1.0.0", 100u64),
        ("1.0.1", 101u64),
        ("1.0.2", 102u64),
        ("1.1.0", 110u64),
        ("1.1.1", 111u64),
    ];

    for (version, build) in &versions {
        let installation = GameInstallation {
            game_id: "rapid-update".to_string(),
            installed_version: version.to_string(),
            installed_build: *build,
            install_path: PathBuf::from("/games/rapid-update"),
            installed_files: HashMap::new(),
            installed_at: chrono::Utc::now(),
            last_played: None,
            total_playtime_seconds: 0,
            executable: "game.exe".to_string(),
        };

        save_installation(app_data_dir, &installation).unwrap();
    }

    // Verify final state
    let final_installation = load_installation(app_data_dir, "rapid-update")
        .unwrap()
        .unwrap();

    assert_eq!(final_installation.installed_version, "1.1.1");
    assert_eq!(final_installation.installed_build, 111);
}
