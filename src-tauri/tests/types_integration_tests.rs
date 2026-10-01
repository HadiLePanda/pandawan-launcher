//! Integration tests for the types module
//!
//! These tests verify:
//! - Serialization and deserialization of all data types
//! - Validation logic
//! - Helper methods on types

use std::collections::HashMap;
use std::path::PathBuf;

use pandawan_launcher_lib::types::*;

// ============================================================================
// GameManifest Serialization Tests
// ============================================================================

#[test]
fn test_game_manifest_full_serialization() {
    let manifest = GameManifest {
        game_id: "full-test-game".to_string(),
        name: "Full Test Game".to_string(),
        version: "1.2.3-beta".to_string(),
        build_number: 12345,
        description: Some("A comprehensive test game with all fields".to_string()),
        icon_url: Some("https://cdn.example.com/icons/game.png".to_string()),
        banner_url: Some("https://cdn.example.com/banners/game.jpg".to_string()),
        executable: "game.exe".to_string(),
        files: vec![
            FileEntry {
                path: "game.exe".to_string(),
                hash: "a".repeat(64),
                size: 50_000_000,
                url: "files/v1.2.3/game.exe".to_string(),
                compress: Some(false),
            },
            FileEntry {
                path: "data/assets.pak".to_string(),
                hash: "b".repeat(64),
                size: 500_000_000,
                url: "files/v1.2.3/assets.pak".to_string(),
                compress: Some(true),
            },
        ],
        launch_args: Some(vec![
            "--fullscreen".to_string(),
            "--resolution=1920x1080".to_string(),
        ]),
        channel: "stable".to_string(),

        platforms: None,
        size_bytes: None,
    };

    // Serialize
    let json = serde_json::to_string_pretty(&manifest).expect("Failed to serialize");

    // Verify JSON contains expected fields
    assert!(json.contains("full-test-game"));
    assert!(json.contains("1.2.3-beta"));
    assert!(json.contains("12345"));
    assert!(json.contains("game.exe"));
    assert!(json.contains("--fullscreen"));

    // Deserialize
    let deserialized: GameManifest = serde_json::from_str(&json).expect("Failed to deserialize");

    assert_eq!(deserialized.game_id, manifest.game_id);
    assert_eq!(deserialized.version, manifest.version);
    assert_eq!(deserialized.build_number, manifest.build_number);
    assert_eq!(deserialized.files.len(), manifest.files.len());
    assert_eq!(deserialized.launch_args, manifest.launch_args);
}

#[test]
fn test_game_manifest_minimal_serialization() {
    // Test with minimal fields (many optional fields as None)
    let manifest = GameManifest {
        game_id: "minimal-game".to_string(),
        name: "Minimal Game".to_string(),
        version: "1.0.0".to_string(),
        build_number: 1,
        description: None,
        icon_url: None,
        banner_url: None,
        executable: "run.exe".to_string(),
        files: vec![],
        launch_args: None,
        channel: "stable".to_string(),

        platforms: None,
        size_bytes: None,
    };

    let json = serde_json::to_string(&manifest).expect("Failed to serialize");
    let deserialized: GameManifest = serde_json::from_str(&json).expect("Failed to deserialize");

    assert_eq!(deserialized.description, None);
    assert_eq!(deserialized.icon_url, None);
    assert!(deserialized.files.is_empty());
    assert_eq!(deserialized.launch_args, None);
}

#[test]
fn test_game_manifest_deserialization_from_json() {
    let json = r#"
    {
        "game_id": "json-test",
        "name": "JSON Test Game",
        "version": "2.0.0",
        "build_number": 200,
        "description": "Test description from JSON",
        "icon_url": "https://example.com/icon.png",
        "banner_url": null,
        "executable": "start.exe",
        "files": [
            {
                "path": "start.exe",
                "hash": "abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234",
                "size": 1000000,
                "url": "files/start.exe",
                "compress": false
            }
        ],
        "launch_args": ["--windowed"]
    }
    "#;

    let manifest: GameManifest = serde_json::from_str(json).expect("Failed to deserialize");

    assert_eq!(manifest.game_id, "json-test");
    assert_eq!(manifest.version, "2.0.0");
    assert_eq!(manifest.build_number, 200);
    assert_eq!(manifest.files.len(), 1);
    assert_eq!(manifest.files[0].path, "start.exe");
    assert_eq!(manifest.files[0].size, 1_000_000);
}

// ============================================================================
// FileEntry Serialization Tests
// ============================================================================

#[test]
fn test_file_entry_serialization_variants() {
    // With compress = true
    let entry1 = FileEntry {
        path: "compressed.zip".to_string(),
        hash: "abc".repeat(16),
        size: 1000,
        url: "files/compressed.zip".to_string(),
        compress: Some(true),
    };

    // With compress = false
    let entry2 = FileEntry {
        path: "raw.bin".to_string(),
        hash: "def".repeat(16),
        size: 2000,
        url: "files/raw.bin".to_string(),
        compress: Some(false),
    };

    // Without compress field
    let entry3 = FileEntry {
        path: "unknown.bin".to_string(),
        hash: "ghi".repeat(16),
        size: 3000,
        url: "files/unknown.bin".to_string(),
        compress: None,
    };

    for entry in [entry1, entry2, entry3] {
        let json = serde_json::to_string(&entry).expect("Failed to serialize");
        let deserialized: FileEntry = serde_json::from_str(&json).expect("Failed to deserialize");

        assert_eq!(deserialized.path, entry.path);
        assert_eq!(deserialized.hash, entry.hash);
        assert_eq!(deserialized.size, entry.size);
        assert_eq!(deserialized.compress, entry.compress);
    }
}

#[test]
fn test_file_entry_deserialization_from_json() {
    // Test parsing with various compress field values
    let json_with_compress =
        r#"{"path":"a.txt","hash":"abc","size":100,"url":"a.txt","compress":true}"#;
    let entry: FileEntry = serde_json::from_str(json_with_compress).unwrap();
    assert_eq!(entry.compress, Some(true));

    let json_without_compress = r#"{"path":"b.txt","hash":"def","size":200,"url":"b.txt"}"#;
    let entry: FileEntry = serde_json::from_str(json_without_compress).unwrap();
    assert_eq!(entry.compress, None);

    let json_null_compress =
        r#"{"path":"c.txt","hash":"ghi","size":300,"url":"c.txt","compress":null}"#;
    let entry: FileEntry = serde_json::from_str(json_null_compress).unwrap();
    assert_eq!(entry.compress, None);
}

// ============================================================================
// GameInstallation Serialization Tests
// ============================================================================

#[test]
fn test_game_installation_full_serialization() {
    let mut installed_files = HashMap::new();
    installed_files.insert("game.exe".to_string(), "abc".repeat(16));
    installed_files.insert("data/config.json".to_string(), "def".repeat(16));
    installed_files.insert("assets/texture.png".to_string(), "ghi".repeat(16));

    let installation = GameInstallation {
        game_id: "full-install-test".to_string(),
        installed_version: "1.5.0".to_string(),
        installed_build: 150,
        install_path: PathBuf::from("C:/Games/full-install-test"),
        installed_files,
        installed_at: chrono::DateTime::parse_from_rfc3339("2024-01-15T10:30:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc),
        last_played: Some(
            chrono::DateTime::parse_from_rfc3339("2024-01-20T15:45:00Z")
                .unwrap()
                .with_timezone(&chrono::Utc),
        ),
        total_playtime_seconds: 36000, // 10 hours
        executable: "game.exe".to_string(),
        channel: "stable".to_string(),
    };

    let json = serde_json::to_string_pretty(&installation).expect("Failed to serialize");

    // Verify JSON structure
    assert!(json.contains("full-install-test"));
    assert!(json.contains("1.5.0"));
    assert!(
        json.contains("C:/Games/full-install-test")
            || json.contains("C:\\\\Games\\\\full-install-test")
    );
    assert!(json.contains("36000"));

    let deserialized: GameInstallation =
        serde_json::from_str(&json).expect("Failed to deserialize");

    assert_eq!(deserialized.game_id, installation.game_id);
    assert_eq!(deserialized.installed_files.len(), 3);
    assert!(deserialized.last_played.is_some());
    assert_eq!(deserialized.total_playtime_seconds, 36000);
}

#[test]
fn test_game_installation_with_null_last_played() {
    let installation = GameInstallation {
        game_id: "never-played".to_string(),
        installed_version: "1.0.0".to_string(),
        installed_build: 1,
        install_path: PathBuf::from("/games/never-played"),
        installed_files: HashMap::new(),
        installed_at: chrono::Utc::now(),
        last_played: None,
        total_playtime_seconds: 0,
        executable: "game.exe".to_string(),
        channel: "stable".to_string(),
    };

    let json = serde_json::to_string(&installation).unwrap();
    let deserialized: GameInstallation = serde_json::from_str(&json).unwrap();

    assert!(deserialized.last_played.is_none());
}

// ============================================================================
// DownloadEvent Serialization Tests
// ============================================================================

#[test]
fn test_download_event_started_serialization() {
    let event = DownloadEvent::Started {
        file_path: "/downloads/game.zip".to_string(),
        total_size: 1_000_000_000,
        file_index: 0,
        total_files: 1,
        overall_downloaded: Some(0),
        overall_total: Some(1_000_000_000),
    };

    let json = serde_json::to_string(&event).expect("Failed to serialize");

    // Verify tagged enum format
    assert!(json.contains("Started"));
    assert!(json.contains("filePath")); // camelCase
    assert!(json.contains("/downloads/game.zip"));
    assert!(json.contains("1000000000"));

    // Events can't be easily deserialized back due to Channel requirements
    // but we verify the serialization format is correct
}

#[test]
fn test_download_event_progress_serialization() {
    let event = DownloadEvent::Progress {
        file_path: "/downloads/game.zip".to_string(),
        downloaded: 500_000_000,
        total: 1_000_000_000,
        speed_bps: 50_000_000.5,
        overall_downloaded: Some(500_000_000),
        overall_total: Some(1_000_000_000),
        completed_files: Some(0),
        total_files: Some(5),
        current_file: Some("/downloads/game.zip".to_string()),
    };

    let json = serde_json::to_string(&event).expect("Failed to serialize");

    assert!(json.contains("Progress"));
    assert!(json.contains("downloaded"));
    assert!(json.contains("speedBps")); // camelCase
    assert!(json.contains("50000000.5"));
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
        message: "Network timeout after 30 seconds".to_string(),
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
        overall_downloaded: Some(500_000_000),
        overall_total: Some(2_000_000_000),
    };

    let json = serde_json::to_string(&event).expect("Failed to serialize");

    assert!(json.contains("FileComplete"));
    assert!(json.contains("/downloads/asset.pak"));
}

// ============================================================================
// PatchProgress and PatchStatus Tests
// ============================================================================

#[test]
fn test_patch_progress_serialization() {
    let progress = PatchProgress {
        total_files: 100,
        completed_files: 45,
        total_bytes: 10_000_000_000,
        downloaded_bytes: 4_500_000_000,
        current_file: Some("large_asset.pak".to_string()),
    };

    let json = serde_json::to_string_pretty(&progress).expect("Failed to serialize");
    let deserialized: PatchProgress = serde_json::from_str(&json).expect("Failed to deserialize");

    assert_eq!(deserialized.total_files, progress.total_files);
    assert_eq!(deserialized.completed_files, progress.completed_files);
    assert_eq!(deserialized.total_bytes, progress.total_bytes);
    assert_eq!(deserialized.downloaded_bytes, progress.downloaded_bytes);
    assert_eq!(deserialized.current_file, progress.current_file);
}

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
fn test_patch_progress_methods() {
    let progress = PatchProgress {
        total_files: 10,
        completed_files: 5,
        total_bytes: 1_000_000,
        downloaded_bytes: 500_000,
        current_file: Some("file.zip".to_string()),
    };

    // Percentage calculation
    assert_eq!(progress.percentage(), 50.0);
    assert_eq!(progress.file_percentage(), 50.0);

    // Is complete
    assert!(!progress.is_complete());

    // Remaining bytes
    assert_eq!(progress.remaining_bytes(), 500_000);

    // Estimated time
    assert_eq!(progress.estimated_time_remaining(100_000.0), Some(5));
    assert_eq!(progress.estimated_time_remaining(0.0), None);
}

#[test]
fn test_patch_progress_edge_cases() {
    // Zero values
    let empty = PatchProgress::default();
    assert_eq!(empty.percentage(), 0.0);
    assert_eq!(empty.file_percentage(), 0.0);
    assert!(!empty.is_complete());

    // Complete
    let complete = PatchProgress {
        total_files: 10,
        completed_files: 10,
        total_bytes: 1000,
        downloaded_bytes: 1000,
        current_file: None,
    };
    assert!(complete.is_complete());
    assert_eq!(complete.percentage(), 100.0);

    // Over-downloaded (handles gracefully)
    let over = PatchProgress {
        total_files: 10,
        completed_files: 12,
        total_bytes: 1000,
        downloaded_bytes: 1500,
        current_file: None,
    };
    assert_eq!(over.remaining_bytes(), 0);
}

#[test]
fn test_patch_state_serialization() {
    // Test all patch states
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
        let deserialized: PatchState = serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized as i32, state as i32);

        // Verify camelCase naming
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
        game_id: "status-test-game".to_string(),
        current_version: "1.0.0".to_string(),
        target_version: "1.5.0".to_string(),
        status: PatchState::Downloading,
        progress: PatchProgress {
            total_files: 50,
            completed_files: 25,
            total_bytes: 5_000_000_000,
            downloaded_bytes: 2_500_000_000,
            current_file: Some("update.zip".to_string()),
        },
    };

    let json = serde_json::to_string_pretty(&status).expect("Failed to serialize");
    let deserialized: PatchStatus = serde_json::from_str(&json).expect("Failed to deserialize");

    assert_eq!(deserialized.game_id, status.game_id);
    assert_eq!(deserialized.current_version, status.current_version);
    assert_eq!(deserialized.target_version, status.target_version);
    assert!(matches!(deserialized.status, PatchState::Downloading));
    assert_eq!(deserialized.progress.total_files, 50);
}

// ============================================================================
// LauncherSettings Tests
// ============================================================================

#[test]
fn test_launcher_settings_default() {
    let settings = LauncherSettings::default();

    assert!(settings.games_install_path.is_none());
    assert!(settings.max_download_speed.is_none());
    assert_eq!(settings.max_concurrent_downloads, 4);
    assert!(settings.auto_update_games);
    assert!(settings.auto_update_launcher);
    assert!(settings.minimize_to_tray);
    assert!(!settings.close_to_tray);
    assert_eq!(settings.language, "en");
    assert!(settings.notify_game_updates);
    assert!(settings.notify_download_complete);
}

#[test]
fn test_launcher_settings_ignores_removed_notification_fields() {
    // `notifyFriendActivity` / `notifyNewsEvents` were removed from the schema
    // because nothing read them. Settings files written by older builds still
    // contain those keys, so deserialization must ignore them rather than fail
    // and reset the player's configuration.
    let json = r#"{
        "maxConcurrentDownloads": 4,
        "autoUpdateGames": true,
        "autoUpdateLauncher": true,
        "minimizeToTray": true,
        "closeToTray": false,
        "language": "en",
        "theme": "adaptive",
        "notifyGameUpdates": true,
        "notifyDownloadComplete": true,
        "notifyFriendActivity": true,
        "notifyNewsEvents": false
    }"#;

    let settings: LauncherSettings =
        serde_json::from_str(json).expect("legacy settings should still load");
    assert_eq!(settings.language, "en");
    assert!(settings.notify_game_updates);
    assert!(settings.notify_download_complete);
}

#[test]
fn test_launcher_settings_serialization() {
    let settings = LauncherSettings {
        games_install_path: Some(PathBuf::from("D:/Games")),
        max_download_speed: Some(5_000_000), // 5 MB/s
        max_concurrent_downloads: 8,
        auto_update_games: false,
        auto_update_launcher: false,
        minimize_to_tray: false,
        close_to_tray: true,
        language: "fr".to_string(),
        theme: "dark".to_string(),
        ..Default::default()
    };

    let json = serde_json::to_string_pretty(&settings).expect("Failed to serialize");
    let deserialized: LauncherSettings =
        serde_json::from_str(&json).expect("Failed to deserialize");

    assert_eq!(deserialized.max_concurrent_downloads, 8);
    assert_eq!(deserialized.language, "fr");
    assert!(!deserialized.auto_update_games);
    assert_eq!(
        deserialized.games_install_path,
        Some(PathBuf::from("D:/Games"))
    );
}

#[test]
fn test_launcher_settings_validation() {
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

// ============================================================================
// LaunchResult Tests
// ============================================================================

#[test]
fn test_launch_result_serialization() {
    // Success case
    let success = LaunchResult {
        success: true,
        message: "Game launched successfully".to_string(),
        process_id: Some(12345),
    };

    let json = serde_json::to_string(&success).unwrap();
    assert!(json.contains("true"));
    assert!(json.contains("12345"));
    assert!(json.contains("successfully"));

    let deserialized: LaunchResult = serde_json::from_str(&json).unwrap();
    assert!(deserialized.success);
    assert_eq!(deserialized.process_id, Some(12345));

    // Failure case
    let failure = LaunchResult {
        success: false,
        message: "Game not found".to_string(),
        process_id: None,
    };

    let json = serde_json::to_string(&failure).unwrap();
    assert!(json.contains("false"));
    assert!(json.contains("not found"));

    let deserialized: LaunchResult = serde_json::from_str(&json).unwrap();
    assert!(!deserialized.success);
    assert!(deserialized.process_id.is_none());
}

// ============================================================================
// Complex Integration Tests
// ============================================================================

#[test]
fn test_full_data_flow() {
    // Simulate a complete data flow from manifest to installation

    // 1. Start with a manifest
    let manifest = GameManifest {
        game_id: "flow-test".to_string(),
        name: "Flow Test".to_string(),
        version: "1.0.0".to_string(),
        build_number: 100,
        description: None,
        icon_url: None,
        banner_url: None,
        executable: "game.exe".to_string(),
        files: vec![FileEntry {
            path: "game.exe".to_string(),
            hash: "abc".repeat(16),
            size: 10_000_000,
            url: "game.exe".to_string(),
            compress: None,
        }],
        launch_args: None,
        channel: "stable".to_string(),

        platforms: None,
        size_bytes: None,
    };

    // 2. Create installation from manifest
    let mut installed_files = HashMap::new();
    for file in &manifest.files {
        installed_files.insert(file.path.clone(), file.hash.clone());
    }

    let installation = GameInstallation {
        game_id: manifest.game_id.clone(),
        installed_version: manifest.version.clone(),
        installed_build: manifest.build_number,
        install_path: PathBuf::from(format!("/games/{}", manifest.game_id)),
        installed_files,
        installed_at: chrono::Utc::now(),
        last_played: None,
        total_playtime_seconds: 0,
        executable: manifest.executable.clone(),
        channel: "stable".to_string(),
    };

    // 3. Serialize installation
    let json = serde_json::to_string(&installation).unwrap();

    // 4. Deserialize
    let loaded: GameInstallation = serde_json::from_str(&json).unwrap();

    // 5. Verify
    assert_eq!(loaded.game_id, manifest.game_id);
    assert_eq!(loaded.installed_files.len(), manifest.files.len());
}

#[test]
fn test_serialization_with_special_characters() {
    // Test handling of special characters in strings
    let manifest = GameManifest {
        game_id: "special-charset-test".to_string(),
        name: "Game with \"quotes\" and 'apostrophes'".to_string(),
        version: "1.0.0-alpha.1+beta".to_string(),
        build_number: 1,
        description: Some("Line 1\nLine 2\tTabbed".to_string()),
        icon_url: None,
        banner_url: None,
        executable: "game.exe".to_string(),
        files: vec![],
        launch_args: Some(vec![
            "--path=C:\\Program Files\\Game".to_string(),
            "--name=Test User".to_string(),
        ]),
        channel: "stable".to_string(),

        platforms: None,
        size_bytes: None,
    };

    let json = serde_json::to_string_pretty(&manifest).unwrap();
    let deserialized: GameManifest = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.name, manifest.name);
    assert_eq!(deserialized.version, manifest.version);
    assert_eq!(deserialized.description, manifest.description);
    assert_eq!(deserialized.launch_args, manifest.launch_args);
}

#[test]
fn test_unicode_handling() {
    let manifest = GameManifest {
        game_id: "unicode-test".to_string(),
        name: "日本語ゲーム 🎮".to_string(),
        description: Some("Описание на русском".to_string()),
        version: "1.0.0".to_string(),
        build_number: 1,
        icon_url: None,
        banner_url: None,
        executable: "game.exe".to_string(),
        files: vec![],
        launch_args: Some(vec!["--path=C:\\Program Files\\Game".to_string()]),
        channel: "stable".to_string(),

        platforms: None,
        size_bytes: None,
    };

    let json = serde_json::to_string(&manifest).unwrap();
    let deserialized: GameManifest = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.name, manifest.name);
    assert_eq!(deserialized.description, manifest.description);
    assert_eq!(deserialized.game_id, manifest.game_id);
}
