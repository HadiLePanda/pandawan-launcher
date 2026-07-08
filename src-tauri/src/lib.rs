use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex;

pub mod download;
pub mod patch;
pub mod types;

#[cfg(test)]
pub mod test_utils;

use patch::{list_installations, load_installation, save_installation, PatchManager};
use types::*;

// Global state for the launcher
struct LauncherState {
    patch_manager: Arc<PatchManager>,
    settings: Arc<Mutex<LauncherSettings>>,
    running_games: Arc<Mutex<HashMap<String, tokio::process::Child>>>,
}

impl LauncherState {
    async fn new(app_handle: &AppHandle) -> Self {
        let app_data_dir = app_handle.path().app_data_dir().unwrap_or_else(|_| {
            dirs::data_local_dir()
                .unwrap_or_default()
                .join("pandawan-launcher")
        });

        let _ = std::fs::create_dir_all(&app_data_dir);

        // Load settings
        let settings = load_settings(&app_data_dir).await.unwrap_or_default();

        Self {
            patch_manager: Arc::new(PatchManager::new(
                settings.max_concurrent_downloads,
                settings.max_download_speed,
            )),
            settings: Arc::new(Mutex::new(settings)),
            running_games: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Get the default games install path
fn get_default_games_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_default()
        .join("PandawanGames")
}

/// Verify an install path is inside the allowed games root.
fn assert_install_path_safe(
    install_path: &std::path::Path,
    allowed_root: &std::path::Path,
) -> Result<(), String> {
    let canonical_install = install_path
        .canonicalize()
        .map_err(|e| format!("Invalid install path {}: {}", install_path.display(), e))?;
    let canonical_root = allowed_root
        .canonicalize()
        .map_err(|e| format!("Invalid install root {}: {}", allowed_root.display(), e))?;

    if !canonical_install.starts_with(&canonical_root) {
        return Err(format!(
            "Install path {} is outside allowed root {}",
            canonical_install.display(),
            canonical_root.display()
        ));
    }

    Ok(())
}

/// Fetch game manifest from URL
#[tauri::command]
async fn fetch_game_manifest(url: String) -> Result<GameManifest, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch manifest: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    let manifest = response
        .json::<GameManifest>()
        .await
        .map_err(|e| format!("Failed to parse manifest: {}", e))?;

    Ok(manifest)
}

/// Install or update a game
#[tauri::command]
async fn install_game(
    app: AppHandle,
    state: State<'_, LauncherState>,
    manifest: GameManifest,
    base_url: String,
    on_event: Channel<DownloadEvent>,
) -> Result<GameInstallation, String> {
    let settings = state.settings.lock().await;
    let install_dir = settings
        .games_install_path
        .clone()
        .unwrap_or_else(get_default_games_path)
        .join(&manifest.game_id);
    drop(settings);

    let patch_manager = Arc::clone(&state.patch_manager);
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    let installation = patch_manager
        .patch_game(manifest, install_dir, &app_data_dir, base_url, on_event)
        .await
        .map_err(|e| e.to_string())?;

    // Save installation
    save_installation(&app_data_dir, &installation).map_err(|e| e.to_string())?;

    Ok(installation)
}

/// Check if game needs update
#[tauri::command]
async fn check_game_update(
    app: AppHandle,
    game_id: String,
    manifest: GameManifest,
) -> Result<bool, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    match load_installation(&app_data_dir, &game_id).map_err(|e| e.to_string())? {
        Some(installation) => Ok(installation.installed_build < manifest.build_number),
        None => Ok(true), // Not installed
    }
}

/// Verify game installation
#[tauri::command]
async fn verify_game(
    state: State<'_, LauncherState>,
    manifest: GameManifest,
    install_path: PathBuf,
) -> Result<patch::VerificationResult, String> {
    state
        .patch_manager
        .verify_installation(&manifest, &install_path)
        .await
        .map_err(|e| e.to_string())
}

/// Launch a game
#[tauri::command]
async fn launch_game(
    app: AppHandle,
    state: State<'_, LauncherState>,
    game_id: String,
) -> Result<LaunchResult, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // Load installation
    let installation =
        match load_installation(&app_data_dir, &game_id).map_err(|e| e.to_string())? {
            Some(inst) => inst,
            None => {
                return Ok(LaunchResult {
                    success: false,
                    message: "Game not installed".to_string(),
                    process_id: None,
                });
            }
        };

    // Check if already running
    {
        let running = state.running_games.lock().await;
        if running.contains_key(&game_id) {
            return Ok(LaunchResult {
                success: false,
                message: "Game is already running".to_string(),
                process_id: None,
            });
        }
    }

    // Build executable path
    let exe_path = installation.install_path.join(&installation.executable);

    if !exe_path.exists() {
        return Ok(LaunchResult {
            success: false,
            message: format!("Executable not found: {}", exe_path.display()),
            process_id: None,
        });
    }

    // Launch game
    let mut command = TokioCommand::new(&exe_path);
    command
        .current_dir(&installation.install_path)
        .arg("-launcher")
        .arg(&game_id)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    match command.spawn() {
        Ok(child) => {
            let pid = child.id();

            // Store process handle
            {
                let mut running = state.running_games.lock().await;
                running.insert(game_id.clone(), child);
            }

            // Spawn a task to wait for process exit
            let running_games = Arc::clone(&state.running_games);
            let game_id_clone = game_id.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(mut child) = {
                    let mut running = running_games.lock().await;
                    running.remove(&game_id_clone)
                } {
                    let _ = child.wait().await;
                }
            });

            Ok(LaunchResult {
                success: true,
                message: "Game launched successfully".to_string(),
                process_id: pid,
            })
        }
        Err(e) => Ok(LaunchResult {
            success: false,
            message: format!("Failed to launch game: {}", e),
            process_id: None,
        }),
    }
}

/// Get list of installed games
#[tauri::command]
async fn get_installed_games(app: AppHandle) -> Result<Vec<GameInstallation>, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    list_installations(&app_data_dir).map_err(|e| e.to_string())
}

/// Get game installation info
#[tauri::command]
async fn get_game_installation(
    app: AppHandle,
    game_id: String,
) -> Result<Option<GameInstallation>, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    load_installation(&app_data_dir, &game_id).map_err(|e| e.to_string())
}

/// Uninstall a game
#[tauri::command]
async fn uninstall_game(
    app: AppHandle,
    state: State<'_, LauncherState>,
    game_id: String,
) -> Result<(), String> {
    // Check if running
    {
        let running = state.running_games.lock().await;
        if running.contains_key(&game_id) {
            return Err("Cannot uninstall while game is running".to_string());
        }
    }

    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // Determine the allowed install root from settings
    let allowed_root = {
        let settings = state.settings.lock().await;
        settings
            .games_install_path
            .clone()
            .unwrap_or_else(get_default_games_path)
    };

    // Get installation info
    if let Some(installation) =
        load_installation(&app_data_dir, &game_id).map_err(|e| e.to_string())?
    {
        // Safety check: refuse to delete paths outside the configured games root
        assert_install_path_safe(&installation.install_path, &allowed_root)
            .map_err(|e| e.to_string())?;

        // Remove game files
        if installation.install_path.exists() {
            let _ = std::fs::remove_dir_all(&installation.install_path);
        }

        // Remove installation record
        let install_file = app_data_dir
            .join("installations")
            .join(format!("{}.json", game_id));
        let _ = std::fs::remove_file(install_file);
    }

    Ok(())
}

/// Get launcher settings
#[tauri::command]
async fn get_settings(state: State<'_, LauncherState>) -> Result<LauncherSettings, String> {
    let settings = state.settings.lock().await;
    Ok(settings.clone())
}

/// Save launcher settings
#[tauri::command]
async fn save_settings(
    app: AppHandle,
    state: State<'_, LauncherState>,
    new_settings: LauncherSettings,
) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    save_settings_to_disk(&app_data_dir, &new_settings).map_err(|e| e.to_string())?;

    let mut settings = state.settings.lock().await;
    *settings = new_settings;

    Ok(())
}

/// Select folder using dialog
#[tauri::command]
async fn select_install_folder(app: AppHandle) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::{DialogExt, FilePath};

    let (tx, rx) = tokio::sync::oneshot::channel();

    app.dialog()
        .file()
        .set_title("Select Installation Folder")
        .pick_folder(move |path| {
            let _ = tx.send(path);
        });

    match rx.await {
        Ok(Some(FilePath::Path(p))) => Ok(Some(p)),
        Ok(_) => Ok(None),
        Err(_) => Ok(None),
    }
}

/// Cancel current download/patch operation
#[tauri::command]
async fn cancel_operation(state: State<'_, LauncherState>) -> Result<(), String> {
    state.patch_manager.cancel();
    Ok(())
}

/// Get app data directory path
#[tauri::command]
async fn get_app_data_dir(app: AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Load settings from disk
async fn load_settings(
    app_data_dir: &std::path::Path,
) -> Result<LauncherSettings, Box<dyn std::error::Error>> {
    let settings_path = app_data_dir.join("settings.json");

    if !settings_path.exists() {
        return Ok(LauncherSettings::default());
    }

    let json = std::fs::read_to_string(settings_path)?;
    let settings: LauncherSettings = serde_json::from_str(&json)?;

    Ok(settings)
}

/// Save settings to disk after validation
fn save_settings_to_disk(
    app_data_dir: &std::path::Path,
    settings: &LauncherSettings,
) -> Result<(), Box<dyn std::error::Error>> {
    settings
        .validate()
        .map_err(|errors| errors.join(", "))?;

    let settings_path = app_data_dir.join("settings.json");
    let json = serde_json::to_string_pretty(settings)?;
    std::fs::write(settings_path, json)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();

            tauri::async_runtime::block_on(async move {
                let state = LauncherState::new(&handle).await;
                handle.manage(state);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_game_manifest,
            install_game,
            check_game_update,
            verify_game,
            launch_game,
            get_installed_games,
            get_game_installation,
            uninstall_game,
            get_settings,
            save_settings,
            select_install_folder,
            cancel_operation,
            get_app_data_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    // =========================================================================
    // get_default_games_path Tests
    // =========================================================================

    #[test]
    fn test_get_default_games_path() {
        let path = get_default_games_path();

        // Path should contain "PandawanGames"
        assert!(path.to_string_lossy().contains("PandawanGames"));
    }

    // =========================================================================
    // load_settings Tests
    // =========================================================================

    #[tokio::test]
    async fn test_load_settings_default_when_missing() {
        let temp_dir = tempfile::tempdir().unwrap();

        let settings = load_settings(temp_dir.path()).await.unwrap();

        assert_eq!(settings, LauncherSettings::default());
    }

    #[tokio::test]
    async fn test_load_settings_from_file() {
        let temp_dir = tempfile::tempdir().unwrap();
        let settings_path = temp_dir.path().join("settings.json");

        let settings = LauncherSettings {
            language: "fr".to_string(),
            max_concurrent_downloads: 8,
            ..Default::default()
        };

        let json = serde_json::to_string_pretty(&settings).unwrap();
        std::fs::write(&settings_path, json).unwrap();

        let loaded = load_settings(temp_dir.path()).await.unwrap();

        assert_eq!(loaded.language, "fr");
        assert_eq!(loaded.max_concurrent_downloads, 8);
    }

    #[tokio::test]
    async fn test_load_settings_invalid_json() {
        let temp_dir = tempfile::tempdir().unwrap();
        let settings_path = temp_dir.path().join("settings.json");

        // Write invalid JSON
        std::fs::write(&settings_path, "not valid json").unwrap();

        let result = load_settings(temp_dir.path()).await;
        assert!(result.is_err());
    }

    // =========================================================================
    // Integration Tests for Command Functions
    // =========================================================================

    #[tokio::test]
    async fn test_check_game_update_not_installed() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();

        let manifest = GameManifest {
            game_id: "new-game".to_string(),
            name: "New Game".to_string(),
            version: "1.0.0".to_string(),
            build_number: 100,
            description: None,
            icon_url: None,
            banner_url: None,
            executable: "game.exe".to_string(),
            files: vec![],
            launch_args: None,
        };

        // Game is not installed, should return true (needs update/install)
        let needs_update = check_game_update_logic(app_data_dir, &manifest).await;
        assert!(needs_update);
    }

    #[tokio::test]
    async fn test_check_game_update_outdated() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();

        // Create an older installation
        let installation = GameInstallation {
            game_id: "test-game".to_string(),
            installed_version: "1.0.0".to_string(),
            installed_build: 100,
            install_path: PathBuf::from("/test"),
            installed_files: HashMap::new(),
            installed_at: chrono::Utc::now(),
            last_played: None,
            total_playtime_seconds: 0,
            executable: "game.exe".to_string(),
        };
        save_installation(app_data_dir, &installation).unwrap();

        // Newer manifest
        let manifest = GameManifest {
            game_id: "test-game".to_string(),
            name: "Test Game".to_string(),
            version: "1.1.0".to_string(),
            build_number: 200,
            description: None,
            icon_url: None,
            banner_url: None,
            executable: "game.exe".to_string(),
            files: vec![],
            launch_args: None,
        };

        let needs_update = check_game_update_logic(app_data_dir, &manifest).await;
        assert!(needs_update);
    }

    #[tokio::test]
    async fn test_check_game_update_up_to_date() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();

        // Create current installation
        let installation = GameInstallation {
            game_id: "test-game".to_string(),
            installed_version: "1.0.0".to_string(),
            installed_build: 100,
            install_path: PathBuf::from("/test"),
            installed_files: HashMap::new(),
            installed_at: chrono::Utc::now(),
            last_played: None,
            total_playtime_seconds: 0,
            executable: "game.exe".to_string(),
        };
        save_installation(app_data_dir, &installation).unwrap();

        // Same manifest
        let manifest = GameManifest {
            game_id: "test-game".to_string(),
            name: "Test Game".to_string(),
            version: "1.0.0".to_string(),
            build_number: 100,
            description: None,
            icon_url: None,
            banner_url: None,
            executable: "game.exe".to_string(),
            files: vec![],
            launch_args: None,
        };

        let needs_update = check_game_update_logic(app_data_dir, &manifest).await;
        assert!(!needs_update);
    }

    #[tokio::test]
    async fn test_check_game_update_newer_than_manifest() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();

        // Create newer installation (shouldn't happen in practice)
        let installation = GameInstallation {
            game_id: "test-game".to_string(),
            installed_version: "2.0.0".to_string(),
            installed_build: 200,
            install_path: PathBuf::from("/test"),
            installed_files: HashMap::new(),
            installed_at: chrono::Utc::now(),
            last_played: None,
            total_playtime_seconds: 0,
            executable: "game.exe".to_string(),
        };
        save_installation(app_data_dir, &installation).unwrap();

        // Older manifest
        let manifest = GameManifest {
            game_id: "test-game".to_string(),
            name: "Test Game".to_string(),
            version: "1.0.0".to_string(),
            build_number: 100,
            description: None,
            icon_url: None,
            banner_url: None,
            executable: "game.exe".to_string(),
            files: vec![],
            launch_args: None,
        };

        let needs_update = check_game_update_logic(app_data_dir, &manifest).await;
        assert!(!needs_update); // Already newer
    }

    // Helper function for check_game_update logic (extracted for testing)
    async fn check_game_update_logic(
        app_data_dir: &std::path::Path,
        manifest: &GameManifest,
    ) -> bool {
        match load_installation(app_data_dir, &manifest.game_id).unwrap() {
            Some(installation) => installation.installed_build < manifest.build_number,
            None => true, // Not installed
        }
    }

    // =========================================================================
    // LauncherState Tests (without Tauri context)
    // =========================================================================

    #[test]
    fn test_launcher_settings_default_values() {
        let settings = LauncherSettings::default();

        assert_eq!(settings.max_concurrent_downloads, 4);
        assert_eq!(settings.language, "en");
        assert!(settings.auto_update_games);
        assert!(!settings.close_to_tray);
    }

    // =========================================================================
    // End-to-End Workflow Tests
    // =========================================================================

    #[tokio::test]
    async fn test_full_installation_workflow() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();
        let install_dir = temp_dir.path().join("games");

        // Create a manifest
        let manifest = GameManifest {
            game_id: "workflow-test".to_string(),
            name: "Workflow Test".to_string(),
            version: "1.0.0".to_string(),
            build_number: 1,
            description: None,
            icon_url: None,
            banner_url: None,
            executable: "game.exe".to_string(),
            files: vec![],
            launch_args: None,
        };

        // Simulate installation by creating the installation record
        let installation = GameInstallation {
            game_id: manifest.game_id.clone(),
            installed_version: manifest.version.clone(),
            installed_build: manifest.build_number,
            install_path: install_dir.clone(),
            installed_files: HashMap::new(),
            installed_at: chrono::Utc::now(),
            last_played: None,
            total_playtime_seconds: 0,
            executable: manifest.executable.clone(),
        };

        // Save installation
        save_installation(app_data_dir, &installation).unwrap();

        // Verify installation was saved
        let loaded = load_installation(app_data_dir, &manifest.game_id).unwrap();
        assert!(loaded.is_some());
        let loaded = loaded.unwrap();
        assert_eq!(loaded.game_id, manifest.game_id);
        assert_eq!(loaded.installed_version, manifest.version);

        // Check if update needed
        let needs_update = check_game_update_logic(app_data_dir, &manifest).await;
        assert!(!needs_update); // Same version

        // Create newer manifest
        let newer_manifest = GameManifest {
            game_id: "workflow-test".to_string(),
            name: "Workflow Test".to_string(),
            version: "1.1.0".to_string(),
            build_number: 2,
            description: None,
            icon_url: None,
            banner_url: None,
            executable: "game.exe".to_string(),
            files: vec![],
            launch_args: None,
        };

        // Now should need update
        let needs_update = check_game_update_logic(app_data_dir, &newer_manifest).await;
        assert!(needs_update);
    }

    #[test]
    fn test_uninstall_game_logic() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();
        let install_dir = temp_dir.path().join("games").join("uninstall-test");

        // Create installation
        std::fs::create_dir_all(&install_dir).unwrap();
        let game_file = install_dir.join("game.exe");
        std::fs::write(&game_file, "game content").unwrap();

        let installation = GameInstallation {
            game_id: "uninstall-test".to_string(),
            installed_version: "1.0.0".to_string(),
            installed_build: 1,
            install_path: install_dir.clone(),
            installed_files: HashMap::new(),
            installed_at: chrono::Utc::now(),
            last_played: None,
            total_playtime_seconds: 0,
            executable: "game.exe".to_string(),
        };

        save_installation(app_data_dir, &installation).unwrap();

        // Verify files exist
        assert!(install_dir.exists());
        assert!(game_file.exists());

        // Simulate uninstall
        if installation.install_path.exists() {
            let _ = std::fs::remove_dir_all(&installation.install_path);
        }
        let install_file = app_data_dir
            .join("installations")
            .join("uninstall-test.json");
        let _ = std::fs::remove_file(&install_file);

        // Verify files are gone
        assert!(!install_dir.exists());
        assert!(!install_file.exists());
    }

    // =========================================================================
    // Edge Cases and Error Handling
    // =========================================================================

    #[tokio::test]
    async fn test_load_settings_with_partial_data() {
        let temp_dir = tempfile::tempdir().unwrap();
        let settings_path = temp_dir.path().join("settings.json");

        // Partial JSON - missing some fields (camelCase because struct uses rename_all = "camelCase")
        let partial_json = r#"{
            "language": "de",
            "autoUpdateGames": false
        }"#;

        std::fs::write(&settings_path, partial_json).unwrap();

        let settings = load_settings(temp_dir.path()).await.unwrap();

        // Specified values should be loaded
        assert_eq!(settings.language, "de");
        assert!(!settings.auto_update_games);

        // Unspecified values should use defaults
        assert_eq!(settings.max_concurrent_downloads, 4); // Default
        assert!(settings.auto_update_launcher); // Default
    }

    #[test]
    fn test_list_installations_corrupted_file() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();
        let installs_dir = app_data_dir.join("installations");
        std::fs::create_dir_all(&installs_dir).unwrap();

        // Create a valid installation
        let valid_install = GameInstallation {
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
        save_installation(app_data_dir, &valid_install).unwrap();

        // Create a corrupted installation file
        std::fs::write(installs_dir.join("corrupted.json"), "{invalid").unwrap();

        // Create a non-JSON file
        std::fs::write(installs_dir.join("not-json.txt"), "hello").unwrap();

        let installations = list_installations(app_data_dir).unwrap();

        // Should only return the valid one
        assert_eq!(installations.len(), 1);
        assert_eq!(installations[0].game_id, "valid-game");
    }

    #[test]
    fn test_save_installation_overwrites_existing() {
        let temp_dir = tempfile::tempdir().unwrap();
        let app_data_dir = temp_dir.path();

        // Create initial installation
        let installation1 = GameInstallation {
            game_id: "update-test".to_string(),
            installed_version: "1.0.0".to_string(),
            installed_build: 1,
            install_path: PathBuf::from("/path1"),
            installed_files: HashMap::new(),
            installed_at: chrono::Utc::now(),
            last_played: None,
            total_playtime_seconds: 0,
            executable: "game.exe".to_string(),
        };
        save_installation(app_data_dir, &installation1).unwrap();

        // Update and save again
        let installation2 = GameInstallation {
            game_id: "update-test".to_string(),
            installed_version: "2.0.0".to_string(),
            installed_build: 2,
            install_path: PathBuf::from("/path2"),
            installed_files: HashMap::new(),
            installed_at: chrono::Utc::now(),
            last_played: Some(chrono::Utc::now()),
            total_playtime_seconds: 3600,
            executable: "game.exe".to_string(),
        };
        save_installation(app_data_dir, &installation2).unwrap();

        // Load and verify it's the updated version
        let loaded = load_installation(app_data_dir, "update-test")
            .unwrap()
            .unwrap();
        assert_eq!(loaded.installed_version, "2.0.0");
        assert_eq!(loaded.installed_build, 2);
        assert_eq!(loaded.total_playtime_seconds, 3600);
    }

    // =====================================================================
    // Install path safety tests
    // =====================================================================

    #[test]
    fn test_assert_install_path_safe_accepts_inside_root() {
        let temp_dir = tempfile::tempdir().unwrap();
        let allowed_root = temp_dir.path().join("games");
        let install_path = allowed_root.join("my-game");
        std::fs::create_dir_all(&install_path).unwrap();

        assert!(assert_install_path_safe(&install_path, &allowed_root).is_ok());
    }

    #[tokio::test]
    async fn test_save_settings_to_disk_valid() {
        let temp_dir = tempfile::tempdir().unwrap();
        let settings = LauncherSettings {
            language: "en".to_string(),
            max_concurrent_downloads: 4,
            ..Default::default()
        };

        save_settings_to_disk(temp_dir.path(), &settings).unwrap();

        let saved = load_settings(temp_dir.path()).await.unwrap();
        assert_eq!(saved.language, "en");
        assert_eq!(saved.max_concurrent_downloads, 4);
    }

    #[tokio::test]
    async fn test_save_settings_to_disk_invalid() {
        let temp_dir = tempfile::tempdir().unwrap();
        let settings = LauncherSettings {
            max_concurrent_downloads: 0,
            ..Default::default()
        };

        let result = save_settings_to_disk(temp_dir.path(), &settings);
        assert!(result.is_err());
        assert!(!temp_dir.path().join("settings.json").exists());
    }
}
