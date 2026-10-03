//! Integration tests for the download system
//!
//! These tests verify:
//! - Download progress calculations
//! - Resume logic
//! - Hash verification during downloads
//! - Error handling

use std::fs;
use std::io::Write;
use std::time::Duration;

use pandawan_launcher_lib::download::progress;
use pandawan_launcher_lib::download::{resume_range, DownloadError, DownloadManager, RateLimiter};
use reqwest::StatusCode;

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
    assert_eq!(
        progress::estimated_time_remaining(500, 1000, 100.0),
        Some(5)
    );
    assert_eq!(progress::estimated_time_remaining(0, 1000, 100.0), Some(10));
    assert_eq!(
        progress::estimated_time_remaining(900, 1000, 100.0),
        Some(1)
    );

    // Complete download
    assert_eq!(
        progress::estimated_time_remaining(1000, 1000, 100.0),
        Some(0)
    );

    // No speed
    assert_eq!(progress::estimated_time_remaining(500, 1000, 0.0), None);
    assert_eq!(progress::estimated_time_remaining(500, 1000, -1.0), None);

    // Over-downloaded
    assert_eq!(
        progress::estimated_time_remaining(1500, 1000, 100.0),
        Some(0)
    );
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
    // A partial file resumes with a Range at its current length and reports
    // progress against the total.
    let existing_size = 500u64;
    let total_size = 1000u64;

    assert_eq!(resume_range(existing_size).as_deref(), Some("bytes=500-"));
    assert_eq!(total_size - existing_size, 500);
    assert_eq!(progress::percentage(existing_size, total_size), 50.0);
}

#[test]
fn test_resume_with_no_existing_file() {
    // No Range at zero: the server answers 200 with the whole file, and a
    // bytes=0- header would make a fresh download look like a resume.
    assert_eq!(resume_range(0), None);
    assert_eq!(progress::percentage(0, 1000), 0.0);
}

#[test]
fn test_resume_completed_file() {
    let existing_size = 1000u64;
    let total_size = 1000u64;

    assert_eq!(progress::percentage(existing_size, total_size), 100.0);
    assert_eq!(total_size.saturating_sub(existing_size), 0);
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

    let error = DownloadError::HttpError(StatusCode::NOT_FOUND);
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
    assert!(DownloadError::HttpError(StatusCode::INTERNAL_SERVER_ERROR).is_retryable());
    assert!(DownloadError::Task("failed".to_string()).is_retryable());

    // Non-retryable errors
    assert!(!DownloadError::Cancelled.is_retryable());
    assert!(!DownloadError::HashMismatch {
        expected: "a".to_string(),
        actual: "b".to_string(),
    }
    .is_retryable());
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

    let error = DownloadError::HttpError(StatusCode::NOT_FOUND);
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

// ============================================================================
// Rate Limiting Calculation Tests
// ============================================================================

#[test]
fn test_rate_limiting_various_speeds() {
    // Estimated time is a pure function of the configured limit, so it is
    // asserted against the manager rather than recomputed here.
    for (size, limit, expected_seconds) in [(1000u64, 500u64, 2.0), (5000, 1000, 5.0)] {
        let manager = DownloadManager::new(4, Some(limit));
        let time = manager.estimated_download_time(size).as_secs_f64();
        assert!(
            (time - expected_seconds).abs() < 0.01,
            "Time mismatch for {} bytes at {} B/s: expected {}, got {}",
            size,
            limit,
            expected_seconds,
            time
        );
    }
}

// ============================================================================
// File Path Resolution Tests
// ============================================================================

#[test]
fn test_parent_directory_creation() {
    let temp_dir = temp_dir();
    let base_path = temp_dir.path();

    // Test creating nested directories
    let deep_path = base_path
        .join("level1")
        .join("level2")
        .join("level3")
        .join("file.txt");

    if let Some(parent) = deep_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }

    assert!(base_path.join("level1").exists());
    assert!(base_path.join("level1").join("level2").exists());
    assert!(base_path
        .join("level1")
        .join("level2")
        .join("level3")
        .exists());

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
    assert_ne!(
        partial_hash, expected_hash,
        "Partial file should have different hash"
    );

    // Simulate resume - append remaining 40%
    let mut file = fs::OpenOptions::new()
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
    let files = [
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
        (
            DownloadError::HttpError(StatusCode::INTERNAL_SERVER_ERROR),
            true,
        ),
        (
            DownloadError::HttpError(StatusCode::SERVICE_UNAVAILABLE),
            true,
        ),
        (
            DownloadError::HttpError(StatusCode::TOO_MANY_REQUESTS),
            true,
        ),
        (DownloadError::HttpError(StatusCode::NOT_FOUND), false),
        (DownloadError::HttpError(StatusCode::FORBIDDEN), false),
        (DownloadError::Cancelled, false),
        (
            DownloadError::HashMismatch {
                expected: "a".to_string(),
                actual: "b".to_string(),
            },
            false,
        ),
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

#[test]
fn test_io_error_retry_classification() {
    use std::io::ErrorKind;

    let retryable_kinds = [
        ErrorKind::WouldBlock,
        ErrorKind::Interrupted,
        ErrorKind::TimedOut,
        ErrorKind::ConnectionReset,
    ];
    for kind in retryable_kinds {
        let error = DownloadError::Io(std::io::Error::new(kind, "transient"));
        assert!(
            error.is_retryable(),
            "IO error {:?} should be retryable",
            kind
        );
    }

    let fatal_kinds = [
        ErrorKind::NotFound,
        ErrorKind::PermissionDenied,
        ErrorKind::StorageFull,
        ErrorKind::OutOfMemory,
    ];
    for kind in fatal_kinds {
        let error = DownloadError::Io(std::io::Error::new(kind, "fatal"));
        assert!(
            !error.is_retryable(),
            "IO error {:?} should not be retryable",
            kind
        );
    }
}

// ============================================================================
// Rate Limiter Tests
// ============================================================================

#[test]
fn test_rate_limiter_enforces_global_speed_limit() {
    let limiter = RateLimiter::new(10_000); // 10 KB/s
    let start = std::time::Instant::now();
    // Consume 20 KB sequentially; should take at least 2 seconds total.
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        limiter.consume(10_000).await;
        limiter.consume(10_000).await;
    });
    assert!(
        start.elapsed() >= std::time::Duration::from_millis(1800),
        "Rate limiter allowed traffic faster than configured limit"
    );
}

#[test]
fn test_rate_limiter_shared_across_consumers() {
    let limiter = std::sync::Arc::new(RateLimiter::new(10_000)); // 10 KB/s
    let start = std::time::Instant::now();
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let a = limiter.clone();
        let b = limiter.clone();
        let handle_a = tokio::spawn(async move { a.consume(10_000).await });
        let handle_b = tokio::spawn(async move { b.consume(10_000).await });
        let _ = tokio::join!(handle_a, handle_b);
    });
    // Two consumers of 10 KB each under a single 10 KB/s limit should take
    // at least 2 seconds in aggregate.
    assert!(
        start.elapsed() >= std::time::Duration::from_millis(1800),
        "Shared rate limiter did not throttle aggregate traffic"
    );
}

#[tokio::test]
async fn test_global_speed_limit_across_concurrent_downloads() {
    use pandawan_launcher_lib::download::FileDownloadTask;
    use pandawan_launcher_lib::types::DownloadEvent;
    use tauri::ipc::Channel;

    let mut server = mockito::Server::new_async().await;
    let body_a = vec![0xAAu8; 10_000];
    let body_b = vec![0xBBu8; 10_000];

    let mock_a = server
        .mock("GET", "/a")
        .with_status(200)
        .with_header("content-type", "application/octet-stream")
        .with_body(body_a.as_slice())
        .create_async()
        .await;
    let mock_b = server
        .mock("GET", "/b")
        .with_status(200)
        .with_header("content-type", "application/octet-stream")
        .with_body(body_b.as_slice())
        .create_async()
        .await;

    let temp_dir = temp_dir();
    let dest_a = temp_dir.path().join("a.bin");
    let dest_b = temp_dir.path().join("b.bin");

    let tasks = vec![
        FileDownloadTask {
            url: format!("{}/a", server.url()),
            dest_path: dest_a.clone(),
            expected_hash: None,
            size: 10_000,
        },
        FileDownloadTask {
            url: format!("{}/b", server.url()),
            dest_path: dest_b.clone(),
            expected_hash: None,
            size: 10_000,
        },
    ];

    // 20 KB at 10 KB/s should take at least ~2 seconds if the limit is global.
    let dm = DownloadManager::new(2, Some(10_000));
    let channel: Channel<DownloadEvent> = Channel::new(|_| Ok(()));

    let start = std::time::Instant::now();
    dm.download_files(tasks, channel).await.unwrap();
    let elapsed = start.elapsed();

    assert!(
        elapsed >= std::time::Duration::from_millis(1800),
        "Concurrent downloads exceeded global speed limit: elapsed {:?}",
        elapsed
    );
    assert_eq!(fs::metadata(&dest_a).unwrap().len(), 10_000);
    assert_eq!(fs::metadata(&dest_b).unwrap().len(), 10_000);

    mock_a.assert_async().await;
    mock_b.assert_async().await;
}

#[tokio::test]
async fn test_hash_mismatch_removes_corrupt_file() {
    use pandawan_launcher_lib::types::DownloadEvent;
    use tauri::ipc::Channel;

    let mut server = mockito::Server::new_async().await;
    let body = b"downloaded content";
    let mock = server
        .mock("GET", "/file")
        .with_status(200)
        .with_header("content-type", "application/octet-stream")
        .with_body(body.as_slice())
        .create_async()
        .await;

    let temp_dir = temp_dir();
    let dest_path = temp_dir.path().join("corrupt.bin");

    let dm = DownloadManager::new(4, None);
    let channel: Channel<DownloadEvent> = Channel::new(|_| Ok(()));
    let wrong_hash = "0".repeat(64);
    let result = dm
        .download_file(
            &format!("{}/file", server.url()),
            &dest_path,
            Some(&wrong_hash),
            &channel,
        )
        .await;

    assert!(result.is_err(), "Expected hash mismatch error");
    assert!(
        !dest_path.exists(),
        "Corrupt file should be removed after hash mismatch"
    );
    mock.assert_async().await;
}

// ============================================================================
// Resume behavior against a real HTTP server
// ============================================================================

#[tokio::test]
async fn test_download_resume_with_200_ok_truncates_existing_partial() {
    use pandawan_launcher_lib::download::DownloadManager;
    use pandawan_launcher_lib::types::DownloadEvent;
    use tauri::ipc::Channel;

    let mut server = mockito::Server::new_async().await;
    let full_content = b"full content from server";
    let mock = server
        .mock("GET", "/file")
        .with_status(200)
        .with_header("content-type", "application/octet-stream")
        .with_body(full_content.as_slice())
        .create_async()
        .await;

    let temp_dir = temp_dir();
    let dest_path = temp_dir.path().join("file.bin");
    fs::write(&dest_path, b"partial ").unwrap();

    let dm = DownloadManager::new(4, None);
    let channel: Channel<DownloadEvent> = Channel::new(|_| Ok(()));
    dm.download_file(
        &format!("{}/file", server.url()),
        &dest_path,
        None,
        &channel,
    )
    .await
    .unwrap();

    let result = fs::read_to_string(&dest_path).unwrap();
    assert_eq!(result, "full content from server");
    mock.assert_async().await;
}

#[tokio::test]
async fn test_download_resume_with_206_partial_appends_existing_partial() {
    use pandawan_launcher_lib::download::DownloadManager;
    use pandawan_launcher_lib::types::DownloadEvent;
    use tauri::ipc::Channel;

    let mut server = mockito::Server::new_async().await;
    let full_content = b"full content from server";
    let partial = &full_content[..7]; // "full co"
    let remainder = &full_content[7..]; // "ntent from server"

    let mock = server
        .mock("GET", "/file")
        .with_status(206)
        .with_header("content-type", "application/octet-stream")
        .match_header("Range", "bytes=7-")
        .with_body(remainder)
        .create_async()
        .await;

    let temp_dir = temp_dir();
    let dest_path = temp_dir.path().join("file.bin");
    fs::write(&dest_path, partial).unwrap();

    let dm = DownloadManager::new(4, None);
    let channel: Channel<DownloadEvent> = Channel::new(|_| Ok(()));
    dm.download_file(
        &format!("{}/file", server.url()),
        &dest_path,
        None,
        &channel,
    )
    .await
    .unwrap();

    let result = fs::read_to_string(&dest_path).unwrap();
    assert_eq!(result, "full content from server");
    mock.assert_async().await;
}
