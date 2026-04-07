use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex;

mod types;
mod download;
mod patch;

use types::*;
use download::DownloadManager;
use patch::{PatchManager, save_installation, load_installation, list_installations};

// Global state for the launcher
struct LauncherState {
    patch_manager: Arc<PatchManager>,
    settings: Arc<Mutex<LauncherSettings>>,
    running_games: Arc<Mutex<HashMap<String, tokio::process::Child>>>,
}

impl LauncherState {
    async fn new(app_handle: &AppHandle) -> Self {
        let app_data_dir = app_handle.path().app_data_dir().unwrap_or_else(|_| {
            dirs::data_local_dir().unwrap_or_default().join("pandawan-launcher")
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
    let install_dir = settings.games_install_path.clone()
        .unwrap_or_else(get_default_games_path)
        .join(&manifest.game_id);
    drop(settings);
    
    let patch_manager = Arc::clone(&state.patch_manager);
    
    let installation = patch_manager
        .patch_game(manifest, install_dir, base_url, on_event)
        .await
        .map_err(|e| e.to_string())?;
    
    // Save installation
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
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
        Some(installation) => {
            Ok(installation.installed_build < manifest.build_number)
        }
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
    state.patch_manager
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
    let installation = match load_installation(&app_data_dir, &game_id).map_err(|e| e.to_string())? {
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
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    
    match command.spawn() {
        Ok(mut child) => {
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
    
    // Get installation info
    if let Some(installation) = load_installation(&app_data_dir, &game_id).map_err(|e| e.to_string())? {
        // Remove game files
        if installation.install_path.exists() {
            let _ = std::fs::remove_dir_all(&installation.install_path);
        }
        
        // Remove installation record
        let install_file = app_data_dir.join("installations").join(format!("{}.json", game_id));
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
    let mut settings = state.settings.lock().await;
    *settings = new_settings;
    
    // Save to disk
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let settings_path = app_data_dir.join("settings.json");
    let json = serde_json::to_string_pretty(&*settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_path, json).map_err(|e| e.to_string())?;
    
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
async fn load_settings(app_data_dir: &PathBuf) -> Result<LauncherSettings, Box<dyn std::error::Error>> {
    let settings_path = app_data_dir.join("settings.json");
    
    if !settings_path.exists() {
        return Ok(LauncherSettings::default());
    }
    
    let json = std::fs::read_to_string(settings_path)?;
    let settings = serde_json::from_str(&json)?;
    
    Ok(settings)
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
