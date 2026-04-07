//! Integration tests for the download system
//!
//! These tests verify:
//! - Download progress calculations
//! - Resume logic
//! - Hash verification during downloads
//! - Error handling

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::Duration;

use pandawan_launcher_lib::download::progress;
use pandawan_launcher_lib::download::{DownloadError, DownloadManager};

/// Helper to create a temporary directory
fn temp_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("Failed to create temp directory")
}

// ============================================================================
// Progress Calculation Integration Tests
// ============================================================================

#[test]
fn test_progress_percentage_calculation() {
    // Normal progress
    assert_eq!(progress::percentage(0, 100), 0.0);
    assert_eq!(progress::percentage(25, 100), 25.0);
    assert_eq!(progress::percentage(50, 100), 50.0);
    assert_eq!(progress::percentage(75, 100), 75.0);
    assert_eq!(progress::percentage(100, 100), 100.0);

    // Zero total should return 0.0 (avoid division by zero)
    assert_eq!(progress::percentage(50, 0), 0.0);

    // Over-downloaded (possible with resume)
    assert_eq!(progress::percentage(150, 100), 150.0);

    // Large numbers
    assert_eq!(progress::percentage(500_000_000, 1_000_000_000), 50.0);
}

#[test]
fn test_speed_bps_calculation() {
    // Normal case
    assert_eq!(progress::speed_bps(1000, 1.0), 1000.0);
    assert_eq!(progress::speed_bps(5000, 5.0), 1000.0);
    assert_eq!(progress::speed_bps(10_000, 2.0), 5000.0);

    // Zero elapsed time
    assert_eq!(progress::speed_bps(1000, 0.0), 0.0);

    // Very small elapsed time
    assert!(progress::speed_bps(1000, 0.001) > 0.0);
}

#[test]
fn test_format_speed() {
    // Bytes per second
    assert_eq!(progress::format_speed(500.0), "500 B/s");
    assert_eq!(progress::format_speed(999.0), "999 B/s");

    // Kilobytes per second
    assert_eq!(progress::format_speed(1000.0), "1.0 KB/s");
    assert_eq!(progress::format_speed(50_000.0), "50.0 KB/s");
    assert_eq!(progress::format_speed(999_999.0), "1000.0 KB/s");

    // Megabytes per second
    assert_eq!(progress::format_speed(1_000_000.0), "1.00 MB/s");
    assert_eq!(progress::format_speed(5_500_000.0), "5.50 MB/s");
    assert_eq!(progress::format_speed(150_000_000.0), "150.00 MB/s");
}

#[test]
fn test_format_bytes() {
    // Bytes
    assert_eq!(progress::format_bytes(0), "0 B");
    assert_eq!(progress::format_bytes(500), "500 B");
    assert_eq!(progress::format_bytes(999), "999 B");

    // Kilobytes
    assert_eq!(progress::format_bytes(1000), "1.0 KB");
    assert_eq!(progress::format_bytes(500_000), "500.0 KB");

    // Megabytes
    assert_eq!(progress::format_bytes(1_000_000), "1.0 MB");
    assert_eq!(progress::format_bytes(500_000_000), "500.0 MB");

    // Gigabytes
    assert_eq!(progress::format_bytes(1_000_000_000), "1.00 GB");
    assert_eq!(progress::format_bytes(5_500_000_000), "5.50 GB");
    assert_eq!(progress::format_bytes(1_000_000_000_000), "1000.00 GB");
}

#[test]
fn test_estimated_time_remaining() {
    // Normal case
    assert_eq!(progress::estimated_time_remaining(500, 1000, 100.0), Some(5));
    assert_eq!(progress::estimated_time_remaining(0, 1000, 100.0), Some(10));
    assert_eq!(progress::estimated_time_remaining(900, 1000, 100.0), Some(1));

    // Complete download
    assert_eq!(progress::estimated_time_remaining(1000, 1000, 100.0), Some(0));

    // No speed
    assert_eq!(progress::estimated_time_remaining(500, 1000, 0.0), None);
    assert_eq!(progress::estimated_time_remaining(500, 1000, -1.0), None);

    // Over-downloaded
    assert_eq!(progress::estimated_time_remaining(1500, 1000, 100.0), Some(0));
}

// ============================================================================
// Download Manager Unit Tests (without HTTP)
// ============================================================================

#[test]
fn test_download_manager_creation() {
    let manager = DownloadManager::new(4, Some(1024));
    assert!(!manager.is_cancelled());

    let manager = DownloadManager::new(8, None);
    assert!(!manager.is_cancelled());
}

#[test]
fn test_download_manager_cancel_operations() {
    let manager = DownloadManager::new(4, None);

    // Initially not cancelled
    assert!(!manager.is_cancelled());

    // Cancel
    manager.cancel();
    assert!(manager.is_cancelled());

    // Reset cancel
    manager.reset_cancel();
    assert!(!manager.is_cancelled());

    // Multiple cancels
    manager.cancel();
    manager.cancel();
    assert!(manager.is_cancelled());

    // Reset after multiple cancels
    manager.reset_cancel();
    assert!(!manager.is_cancelled());
}

#[test]
fn test_download_manager_estimated_time() {
    // With speed limit
    let manager = DownloadManager::new(4, Some(1000));
    assert_eq!(
        manager.estimated_download_time(1000),
        Duration::from_secs(1)
    );
    assert_eq!(
        manager.estimated_download_time(5000),
        Duration::from_secs(5)
    );
    assert_eq!(
        manager.estimated_download_time(500),
        Duration::from_millis(500)
    );

    // Without speed limit (unlimited)
    let manager = DownloadManager::new(4, None);
    assert_eq!(
        manager.estimated_download_time(1_000_000_000),
        Duration::from_secs(0)
    );

    // With zero speed limit
    let manager = DownloadManager::new(4, Some(0));
    assert_eq!(
        manager.estimated_download_time(1000),
        Duration::from_secs(0)
    );
}

// ============================================================================
// Resume Logic Tests
// ============================================================================

#[test]
fn test_resume_calculation() {
    // File already has 500 bytes, total is 1000
    let existing_size = 500u64;
    let total_size = 1000u64;
    let remaining = total_size - existing_size;

    assert_eq!(remaining, 500);

    // Progress should be 50%
    let progress = progress::percentage(existing_size, total_size);
    assert_eq!(progress, 50.0);

    // Range header for resume
    let range_header = format!("bytes={}-", existing_size);
    assert_eq!(range_header, "bytes=500-");
}

#[test]
fn test_resume_with_no_existing_file() {
    let existing_size = 0u64;
    let total_size = 1000u64;

    assert_eq!(existing_size, 0);
    assert_eq!(progress::percentage(existing_size, total_size), 0.0);

    // No range header needed for new file
    let range_header = if existing_size > 0 {
        Some(format!("bytes={}-", existing_size))
    } else {
        None
    };
    assert!(range_header.is_none());
}

#[test]
fn test_resume_completed_file() {
    // File is already complete
    let existing_size = 1000u64;
    let total_size = 1000u64;

    assert_eq!(existing_size, total_size);
    assert_eq!(progress::percentage(existing_size, total_size), 100.0);

    // No bytes remaining
    let remaining = total_size.saturating_sub(existing_size);
    assert_eq!(remaining, 0);
}

#[test]
fn test_resume_with_partial_content() {
    let temp_dir = temp_dir();
    let file_path = temp_dir.path().join("partial_download.bin");

    // Simulate a partial download (500 bytes of 1000 total)
    let total_content = vec![0xABu8; 1000];
    let partial_content = &total_content[0..500];

    fs::write(&file_path, partial_content).unwrap();

    let existing_size = fs::metadata(&file_path).unwrap().len();
    assert_eq!(existing_size, 500);

    // Resume would start from byte 500
    let resume_from = existing_size;
    assert_eq!(resume_from, 500);

    // Simulate completing the download
    let mut file = fs::OpenOptions::new()
        .write(true)
        .append(true)
        .open(&file_path)
        .unwrap();
    file.write_all(&total_content[500..]).unwrap();
    drop(file);

    let final_size = fs::metadata(&file_path).unwrap().len();
    assert_eq!(final_size, 1000);
}

// ============================================================================
// Download Error Tests
// ============================================================================

#[test]
fn test_download_error_types() {
    // Test error display
    let error = DownloadError::Cancelled;
    assert!(error.to_string().contains("cancelled"));

    let error = DownloadError::HttpError("404 Not Found".to_string());
    assert!(error.to_string().contains("404"));

    let error = DownloadError::HashMismatch {
        expected: "abc".to_string(),
        actual: "def".to_string(),
    };
    let msg = error.to_string();
    assert!(msg.contains("Hash mismatch"));
    assert!(msg.contains("abc"));
    assert!(msg.contains("def"));
}

#[test]
fn test_download_error_is_retryable() {
    // Retryable errors
    assert!(DownloadError::HttpError("500".to_string()).is_retryable());
    assert!(DownloadError::Task("failed".to_string()).is_retryable());

    // Non-retryable errors
    assert!(!DownloadError::Cancelled.is_retryable());
    assert!(!DownloadError::HashMismatch {
        expected: "a".to_string(),
        actual: "b".to_string(),
    }.is_retryable());
}

#[test]
fn test_download_error_user_message() {
    let error = DownloadError::Cancelled;
    assert!(error.user_message().to_lowercase().contains("cancelled"));

    let error = DownloadError::HashMismatch {
        expected: "a".to_string(),
        actual: "b".to_string(),
    };
    assert!(error.user_message().to_lowercase().contains("corrupted"));

    let error = DownloadError::HttpError("404".to_string());
    assert!(error.user_message().contains("Server"));
}

#[test]
fn test_download_error_from_io() {
    let io_error = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
    let download_error: DownloadError = io_error.into();

    match download_error {
        DownloadError::Io(_) => (), // Expected
        _ => panic!("Expected Io error variant"),
    }
}

// ============================================================================
// Concurrent Download Calculation Tests
// ============================================================================

#[test]
fn test_concurrent_download_batch_calculation() {
    // Test batch calculation for different scenarios
    
    // 10 files, 4 concurrent
    let total_files = 10;
    let max_concurrent = 4;
    let full_batches = total_files / max_concurrent; // 2
    let remainder = total_files % max_concurrent; // 2
    let total_batches = full_batches + if remainder > 0 { 1 } else { 0 };
    assert_eq!(total_batches, 3);

    // 8 files, 4 concurrent (exact division)
    let total_files = 8;
    let full_batches = total_files / max_concurrent; // 2
    let remainder = total_files % max_concurrent; // 0
    let total_batches = full_batches + if remainder > 0 { 1 } else { 0 };
    assert_eq!(total_batches, 2);

    // 3 files, 4 concurrent (less than max)
    let total_files = 3;
    let full_batches = total_files / max_concurrent; // 0
    let remainder = total_files % max_concurrent; // 3
    let total_batches = full_batches + if remainder > 0 { 1 } else { 0 };
    assert_eq!(total_batches, 1);
}

// ============================================================================
// Rate Limiting Calculation Tests
// ============================================================================

#[test]
fn test_rate_limiting_sleep_calculation() {
    // Calculate sleep time needed to maintain speed limit
    let chunk_size = 1000u64; // bytes
    let speed_limit = 5000u64; // bytes per second

    let expected_time_per_chunk = chunk_size as f64 / speed_limit as f64;
    assert!((expected_time_per_chunk - 0.2).abs() < 0.0001); // 200ms per chunk with tolerance

    // If we processed in 50ms, we need to sleep 150ms
    let elapsed = 0.05; // 50ms
    let sleep_needed = expected_time_per_chunk - elapsed;
    assert!((sleep_needed - 0.15).abs() < 0.0001); // 150ms with tolerance

    // If we processed in 250ms (slower than limit), no sleep needed
    let elapsed = 0.25; // 250ms
    let sleep_needed = if elapsed < expected_time_per_chunk {
        expected_time_per_chunk - elapsed
    } else {
        0.0
    };
    assert_eq!(sleep_needed, 0.0);
}

#[test]
fn test_rate_limiting_various_speeds() {
    // Test various speed limits
    let test_cases = vec![
        (1000, 500, 2.0),    // 1000 bytes at 500 B/s = 2 seconds
        (5000, 1000, 5.0),   // 5KB at 1KB/s = 5 seconds
        (10000, 10000, 1.0), // 10KB at 10KB/s = 1 second
    ];

    for (size, limit, expected_seconds) in test_cases {
        let time = size as f64 / limit as f64;
        assert!((time - expected_seconds).abs() < 0.01, 
            "Time mismatch for {} bytes at {} B/s: expected {}, got {}", 
            size, limit, expected_seconds, time);
    }
}

// ============================================================================
// File Path Resolution Tests
// ============================================================================

#[test]
fn test_destination_path_resolution() {
    let base_dir = PathBuf::from("/games/mygame");

    // Various file paths
    let paths = vec![
        ("game.exe", "/games/mygame/game.exe"),
        ("data/config.json", "/games/mygame/data/config.json"),
        ("assets/textures/player.png", "/games/mygame/assets/textures/player.png"),
    ];

    for (relative_path, expected) in paths {
        let dest_path = base_dir.join(relative_path);
        // Normalize path separators for comparison
        let dest_str = dest_path.to_string_lossy().replace('\\', "/");
        assert_eq!(dest_str, expected);
    }
}

#[test]
fn test_parent_directory_creation() {
    let temp_dir = temp_dir();
    let base_path = temp_dir.path();

    // Test creating nested directories
    let deep_path = base_path.join("level1").join("level2").join("level3").join("file.txt");

    if let Some(parent) = deep_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }

    assert!(base_path.join("level1").exists());
    assert!(base_path.join("level1").join("level2").exists());
    assert!(base_path.join("level1").join("level2").join("level3").exists());

    // Can now create file
    fs::write(&deep_path, "test").unwrap();
    assert!(deep_path.exists());
}

// ============================================================================
// Hash Verification During Download Tests
// ============================================================================

#[test]
fn test_hash_verification_flow() {
    use pandawan_launcher_lib::patch::compute_file_hash_sync;

    let temp_dir = temp_dir();
    let file_path = temp_dir.path().join("downloaded_file.bin");

    // Simulate downloaded content
    let content = b"This is the expected content of the file";
    fs::write(&file_path, content).unwrap();

    // Compute expected hash
    let expected_hash = compute_file_hash_sync(&file_path).unwrap();

    // Verify the hash matches
    let actual_hash = compute_file_hash_sync(&file_path).unwrap();
    assert_eq!(expected_hash, actual_hash);

    // Simulate corrupted file
    fs::write(&file_path, b"This is corrupted content").unwrap();
    let corrupted_hash = compute_file_hash_sync(&file_path).unwrap();
    assert_ne!(expected_hash, corrupted_hash);
}

#[test]
fn test_hash_verification_after_resume() {
    use pandawan_launcher_lib::patch::compute_file_hash_sync;

    let temp_dir = temp_dir();
    let file_path = temp_dir.path().join("resumed_file.bin");

    // Simulate original complete file
    let complete_content: Vec<u8> = (0..1000).map(|i| (i % 256) as u8).collect();
    let expected_hash = {
        fs::write(&file_path, &complete_content).unwrap();
        compute_file_hash_sync(&file_path).unwrap()
    };

    // Clear and write partial
    let partial_content = &complete_content[0..500];
    fs::write(&file_path, partial_content).unwrap();

    // Simulate resume - append remaining content
    let mut file = fs::OpenOptions::new()
        .write(true)
        .append(true)
        .open(&file_path)
        .unwrap();
    file.write_all(&complete_content[500..]).unwrap();
    drop(file);

    // Verify hash matches expected
    let final_hash = compute_file_hash_sync(&file_path).unwrap();
    assert_eq!(final_hash, expected_hash);
}

// ============================================================================
// Edge Cases and Error Scenarios
// ============================================================================

#[test]
fn test_progress_with_maximum_values() {
    // Test with u64::MAX values
    let downloaded = u64::MAX / 2;
    let total = u64::MAX;

    // Should not panic
    let percentage = progress::percentage(downloaded, total);
    assert_eq!(percentage, 50.0);

    // Time calculation with large values
    let speed = 1_000_000.0; // 1 MB/s
    let time = progress::estimated_time_remaining(downloaded, total, speed);
    assert!(time.is_some());
}

#[test]
fn test_zero_and_edge_values() {
    // All zeros
    assert_eq!(progress::percentage(0, 0), 0.0);
    assert_eq!(progress::format_bytes(0), "0 B");
    assert_eq!(progress::format_speed(0.0), "0 B/s");
    assert_eq!(progress::estimated_time_remaining(0, 0, 100.0), Some(0));

    // Very small values
    assert_eq!(progress::format_bytes(1), "1 B");
    assert_eq!(progress::format_speed(1.0), "1 B/s");
}

#[test]
fn test_download_manager_multiple_cancels() {
    let manager = DownloadManager::new(4, None);

    // Multiple cancel/resets should be stable
    for _ in 0..10 {
        manager.cancel();
        assert!(manager.is_cancelled());
        manager.reset_cancel();
        assert!(!manager.is_cancelled());
    }
}

// ============================================================================
// Integration Scenario Tests
// ============================================================================

#[test]
fn test_complete_download_workflow_simulation() {
    // Simulate a complete download workflow
    let total_size = 10_000_000u64; // 10 MB
    let chunk_size = 100_000u64; // 100 KB chunks
    let speed_limit = 5_000_000u64; // 5 MB/s

    // Calculate expected time
    let expected_duration_secs = total_size as f64 / speed_limit as f64;
    assert_eq!(expected_duration_secs, 2.0); // 2 seconds

    // Calculate number of chunks
    let num_chunks = (total_size + chunk_size - 1) / chunk_size; // Ceiling division
    assert_eq!(num_chunks, 100);

    // Calculate time per chunk
    let time_per_chunk = chunk_size as f64 / speed_limit as f64;
    assert_eq!(time_per_chunk, 0.02); // 20ms per chunk

    // Simulate progress updates
    let progress_interval = Duration::from_millis(500);
    let updates_per_second = 1000.0 / progress_interval.as_millis() as f64;
    assert_eq!(updates_per_second, 2.0); // 2 updates per second

    // Total expected progress updates
    let total_expected_updates = (expected_duration_secs * updates_per_second).ceil() as u64;
    assert_eq!(total_expected_updates, 4);
}

#[test]
fn test_resume_scenario_with_hash_verification() {
    use pandawan_launcher_lib::patch::compute_file_hash_sync;

    let temp_dir = temp_dir();
    let file_path = temp_dir.path().join("large_file.bin");

    // Create a "complete" file
    let total_content = vec![0x42u8; 1_000_000]; // 1MB of data
    let expected_hash = {
        fs::write(&file_path, &total_content).unwrap();
        compute_file_hash_sync(&file_path).unwrap()
    };

    // Simulate partial download (interrupted at 60%)
    let partial_size = 600_000usize;
    fs::write(&file_path, &total_content[0..partial_size]).unwrap();

    let partial_hash = compute_file_hash_sync(&file_path).unwrap();
    assert_ne!(partial_hash, expected_hash, "Partial file should have different hash");

    // Simulate resume - append remaining 40%
    let mut file = fs::OpenOptions::new()
        .write(true)
        .append(true)
        .open(&file_path)
        .unwrap();
    file.write_all(&total_content[partial_size..]).unwrap();
    drop(file);

    // Verify complete file hash matches
    let final_hash = compute_file_hash_sync(&file_path).unwrap();
    assert_eq!(final_hash, expected_hash);

    // Verify file size
    let final_size = fs::metadata(&file_path).unwrap().len();
    assert_eq!(final_size, 1_000_000);
}

#[test]
fn test_concurrent_download_planning() {
    // Plan a concurrent download of multiple files
    let files = vec![
        ("file1.bin", 1_000_000u64),
        ("file2.bin", 2_000_000u64),
        ("file3.bin", 500_000u64),
        ("file4.bin", 1_500_000u64),
        ("file5.bin", 3_000_000u64),
    ];

    let max_concurrent = 2;
    let total_size: u64 = files.iter().map(|(_, size)| size).sum();

    assert_eq!(total_size, 8_000_000); // 8MB total

    // Calculate batches
    let num_files = files.len();
    let full_batches = num_files / max_concurrent;
    let remainder = num_files % max_concurrent;
    let total_batches = full_batches + if remainder > 0 { 1 } else { 0 };

    assert_eq!(total_batches, 3);

    // First two files go in batch 1
    // Next two files go in batch 2
    // Last file goes in batch 3
}

#[test]
fn test_error_recovery_strategy() {
    // Test the error classification for retry logic
    let errors = vec![
        (DownloadError::HttpError("500".to_string()), true),
        (DownloadError::HttpError("404".to_string()), true),
        (DownloadError::Cancelled, false),
        (DownloadError::HashMismatch { expected: "a".to_string(), actual: "b".to_string() }, false),
        (DownloadError::Task("failed".to_string()), true),
    ];

    for (error, expected_retryable) in errors {
        assert_eq!(
            error.is_retryable(),
            expected_retryable,
            "Error {:?} retryable mismatch",
            error
        );
    }
}
