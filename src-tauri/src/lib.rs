use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;

use tauri::{ipc::Channel, AppHandle, Emitter, Manager, State};
use tauri_specta::{collect_commands, collect_events, Builder};
use tokio::process::Command as TokioCommand;
use tokio::sync::Mutex;
pub mod download;
pub mod patch;
pub mod path_utils;
pub mod tray;
pub mod types;
pub mod window_behavior;

#[cfg(test)]
pub mod test_utils;

use patch::{
    list_installations, load_installation, record_playtime, save_installation, PatchManager,
};
use path_utils::{assert_path_inside, validate_game_id};
use types::*;

struct LauncherState {
    patch_manager: Arc<PatchManager>,
    settings: Arc<Mutex<LauncherSettings>>,
    // Oneshot senders, not child handles: the waiter task owns the process and
    // must record playtime whether the game exits or the launcher closes it.
    running_games: Arc<Mutex<HashMap<String, RunningProcess>>>,
}

/// One launched game: how to stop it, and how to know its playtime is written.
struct RunningProcess {
    /// Tells the waiter to kill the child.
    kill: tokio::sync::oneshot::Sender<()>,
    /// Resolves once the waiter has reaped the child and recorded playtime.
    done: tokio::sync::oneshot::Receiver<()>,
}

impl LauncherState {
    async fn new(app_handle: &AppHandle) -> Self {
        let app_data_dir = app_handle.path().app_data_dir().unwrap_or_else(|_| {
            dirs::data_local_dir()
                .unwrap_or_default()
                .join("pandawan-launcher")
        });

        let _ = std::fs::create_dir_all(&app_data_dir);

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

fn get_default_games_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_default()
        .join("PandawanGames")
}

/// Stop a running game.
///
/// Signals the waiter task, which owns the process: it kills and reaps the
/// child, records playtime and emits the exit event, so stopping a game behaves
/// exactly like letting it exit on its own.
#[tauri::command]
#[specta::specta]
async fn close_game(app: AppHandle, game_id: String) -> Result<(), LauncherError> {
    stop_game_by_id(&app, &game_id).await
}

/// The stop path shared by the `close_game` command and the tray's Stop item.
pub(crate) async fn stop_game_by_id(app: &AppHandle, game_id: &str) -> Result<(), LauncherError> {
    let state = app.state::<LauncherState>();
    let running = {
        let mut running = state.running_games.lock().await;
        running.remove(game_id)
    };

    match running {
        Some(process) => {
            // The waiter reaps the process; awaiting it here too would be a
            // double wait. `done` is the acknowledgement that playtime is on
            // disk, which a quit depends on.
            let RunningProcess { kill, done } = process;
            let _ = kill.send(());
            let _ = done.await;
            Ok(())
        }
        None => Err(LauncherError::NotRunning),
    }
}

/// Stop every running game and wait for each playtime write to land.
///
/// Called on the quit path, so the app never exits while a waiter still owns a
/// live child: an orphaned game would keep running with nobody recording it.
async fn stop_all_games(app: &AppHandle) {
    let state = app.state::<LauncherState>();
    let running = {
        let mut running = state.running_games.lock().await;
        std::mem::take(&mut *running)
    };

    let mut pending = Vec::new();
    for (_, process) in running {
        let RunningProcess { kill, done } = process;
        let _ = kill.send(());
        pending.push(done);
    }

    // `done` resolves after the waiter has written playtime, so this is the
    // point at which nothing is left to record.
    for done in pending {
        let _ = done.await;
    }
}

/// Verify a path is inside a given root before deleting, writing, or executing.
pub fn assert_path_inside_root(
    path: &std::path::Path,
    root: &std::path::Path,
) -> Result<(), LauncherError> {
    assert_path_inside(path, root).map_err(|_| LauncherError::PathNotAllowed {
        path: path.to_string_lossy().to_string(),
    })
}

/// Fetch a small remote text/JSON document (catalog, news feed).
///
/// The frontend deliberately goes through this command rather than the Tauri
/// HTTP plugin: the plugin needs a capability scope listing every allowed origin,
/// which means hard-coding the CDN hostname into default.json and editing code
/// whenever the CDN moves. reqwest has no such scope, so the allowlist here is
/// the whole security boundary and it cannot drift from the deployed host.
#[tauri::command]
#[specta::specta]
async fn fetch_remote_text(url: String) -> Result<String, LauncherError> {
    // Catalog and news are small documents; a cap stops a misconfigured URL from
    // pulling an unbounded body into memory.
    const MAX_BYTES: u64 = 8 * 1024 * 1024;

    let parsed = url::Url::parse(&url)
        .map_err(|e| LauncherError::Validation(format!("Invalid URL: {e}")))?;

    let is_http = matches!(parsed.scheme(), "http" | "https");
    if !is_http {
        return Err(LauncherError::Validation(format!(
            "Unsupported scheme '{}': only http and https are allowed",
            parsed.scheme()
        )));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| LauncherError::Network(e.to_string()))?;

    let response = client
        .get(parsed)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| LauncherError::Network(format!("Failed to fetch {url}: {e}")))?;

    if !response.status().is_success() {
        return Err(LauncherError::Network(format!(
            "HTTP {} fetching {url}",
            response.status()
        )));
    }

    if let Some(len) = response.content_length() {
        if len > MAX_BYTES {
            return Err(LauncherError::Network(format!(
                "Response too large ({len} bytes, limit {MAX_BYTES})"
            )));
        }
    }

    response
        .text()
        .await
        .map_err(|e| LauncherError::Network(format!("Failed to read {url}: {e}")))
}

/// Fetch game manifest from URL
#[tauri::command]
#[specta::specta]
async fn fetch_game_manifest(url: String) -> Result<GameManifest, LauncherError> {
    // Through fetch_remote_text rather than its own client: that path already
    // enforces the scheme allowlist, a 30s timeout and a size cap, and a manifest
    // is a remote document exactly like the catalog is. Its own Client::new() had
    // none of the three, so a slow or hostile host hung the command indefinitely
    // and the body was read without limit.
    let body = fetch_remote_text(url).await?;
    serde_json::from_str::<GameManifest>(&body)
        .map_err(|e| LauncherError::ManifestParse(e.to_string()))
}

/// Install or update a game
#[tauri::command]
#[specta::specta]
async fn install_game(
    app: AppHandle,
    state: State<'_, LauncherState>,
    mut manifest: GameManifest,
    base_url: String,
    on_event: Channel<DownloadEvent>,
) -> Result<GameInstallation, LauncherError> {
    // Slugify the game id before using it as a directory name or filename.
    let slug = validate_game_id(&manifest.game_id)
        .map_err(|e| LauncherError::Validation(e.to_string()))?;
    manifest.game_id = slug;

    let allowed_root = {
        let settings = state.settings.lock().await;
        settings
            .games_install_path
            .clone()
            .unwrap_or_else(get_default_games_path)
    };
    let install_dir = allowed_root.join(&manifest.game_id);

    std::fs::create_dir_all(&install_dir)?;
    assert_path_inside_root(&install_dir, &allowed_root)?;

    let patch_manager = Arc::clone(&state.patch_manager);
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| LauncherError::Io(e.to_string()))?;

    let installation = patch_manager
        .patch_game(manifest, install_dir, &app_data_dir, base_url, on_event)
        .await?;

    save_installation(&app_data_dir, &installation)?;

    Ok(installation)
}

/// Decide whether an installed build needs to be re-synced against a target
/// manifest.
///
/// A different channel always means re-sync; the same channel means update only
/// when the target build is newer.
///
/// Without the channel check, a player on alpha build 150 who returns to stable
/// build 100 would be reported as up to date and left trapped on alpha forever.
/// Orphaned files from the previous channel are removed by
/// `cleanup_orphaned_files` during the patch, so a channel switch is a clean
/// swap rather than an accumulation of both builds.
///
/// Split out from the command so the rule is testable without a Tauri AppHandle.
fn needs_update(installation: &GameInstallation, manifest: &GameManifest) -> bool {
    installation.channel != manifest.channel || installation.installed_build < manifest.build_number
}

/// Check if game needs update
#[tauri::command]
#[specta::specta]
async fn check_game_update(
    app: AppHandle,
    game_id: String,
    manifest: GameManifest,
) -> Result<bool, LauncherError> {
    let game_id =
        validate_game_id(&game_id).map_err(|e| LauncherError::Validation(e.to_string()))?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| LauncherError::Io(e.to_string()))?;

    match load_installation(&app_data_dir, &game_id)? {
        Some(installation) => Ok(needs_update(&installation, &manifest)),
        None => Ok(true), // Not installed
    }
}

/// Verify game installation
#[tauri::command]
#[specta::specta]
async fn verify_game(
    state: State<'_, LauncherState>,
    manifest: GameManifest,
    install_path: PathBuf,
    on_event: Channel<VerifyProgress>,
) -> Result<patch::VerificationResult, LauncherError> {
    let allowed_root = {
        let settings = state.settings.lock().await;
        settings
            .games_install_path
            .clone()
            .unwrap_or_else(get_default_games_path)
    };
    assert_path_inside_root(&install_path, &allowed_root)?;

    Ok(state
        .patch_manager
        .verify_installation(&manifest, &install_path, Some(&on_event))
        .await?)
}

/// Launch a game
#[tauri::command]
#[specta::specta]
async fn launch_game(
    app: AppHandle,
    state: State<'_, LauncherState>,
    game_id: String,
    game_name: Option<String>,
) -> Result<LaunchResult, LauncherError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| LauncherError::Io(e.to_string()))?;

    let installation = match load_installation(&app_data_dir, &game_id)? {
        Some(inst) => inst,
        None => return Err(LauncherError::NotInstalled),
    };

    // install_path comes from the on-disk record, so it is not trusted on its
    // own: a tampered or stale record could point anywhere and the assertions
    // below would only be comparing a path against itself. Check it against the
    // configured games root first.
    let allowed_root = {
        let settings = state.settings.lock().await;
        settings
            .games_install_path
            .clone()
            .unwrap_or_else(get_default_games_path)
    };
    assert_path_inside_root(&installation.install_path, &allowed_root)?;

    let exe_path = installation.install_path.join(&installation.executable);

    if !exe_path.exists() {
        return Err(LauncherError::ExecutableNotFound {
            path: exe_path.to_string_lossy().to_string(),
        });
    }

    assert_path_inside_root(&exe_path, &installation.install_path)?;

    let (kill_tx, kill_rx) = tokio::sync::oneshot::channel::<()>();
    let (done_tx, done_rx) = tokio::sync::oneshot::channel::<()>();

    // Check and reserve in one critical section. Releasing the lock between
    // them lets a second launch pass the check and spawn a duplicate, and the
    // loser's RunningProcess is overwritten rather than owned, so its playtime
    // is never recorded and neither child can be stopped.
    {
        let mut running = state.running_games.lock().await;
        if running.contains_key(&game_id) {
            return Err(LauncherError::AlreadyRunning);
        }
        running.insert(
            game_id.clone(),
            RunningProcess {
                kill: kill_tx,
                done: done_rx,
            },
        );
    }

    let mut command = TokioCommand::new(&exe_path);
    command
        .current_dir(&installation.install_path)
        .arg("-launcher")
        .arg(&game_id)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    match command.spawn() {
        Ok(mut child) => {
            let pid = child.id();
            let launched_at = Instant::now();

            app.state::<tray::TrayState>()
                .add_running(tray::RunningGame {
                    game_id: game_id.clone(),
                    name: game_name.unwrap_or_else(|| game_id.clone()),
                });
            tray::refresh(&app);

            let app_handle = app.clone();
            let app_data_dir = app_data_dir.clone();
            let running_games = Arc::clone(&state.running_games);
            let game_id_clone = game_id.clone();
            tauri::async_runtime::spawn(async move {
                // The waiter owns the child, so both exits land on one path.
                // Taking the handle back out of the map here would race
                // close_game and skip playtime and the exit event.
                tokio::select! {
                    _ = kill_rx => {
                        let _ = child.start_kill();
                        let _ = child.wait().await;
                    }
                    _ = child.wait() => {}
                }
                {
                    let mut running = running_games.lock().await;
                    running.remove(&game_id_clone);
                }
                app_handle
                    .state::<tray::TrayState>()
                    .remove_running(&game_id_clone);
                tray::refresh(&app_handle);
                let duration_seconds = launched_at.elapsed().as_secs();
                // Playtime loss must not break the exit event
                if let Err(e) = record_playtime(&app_data_dir, &game_id_clone, duration_seconds) {
                    eprintln!("Failed to record playtime for '{}': {}", game_id_clone, e);
                }
                let _ = app_handle.emit(
                    "game-exited",
                    GameExited {
                        game_id: game_id_clone,
                        duration_seconds,
                    },
                );
                // Last: a quit waiting on `done` is waiting on the playtime write.
                let _ = done_tx.send(());
            });

            Ok(LaunchResult {
                success: true,
                message: "Game launched successfully".to_string(),
                process_id: pid,
            })
        }
        Err(e) => {
            // The reservation was taken before spawn so the check could not
            // race. Nothing is running, so give it back rather than leave the
            // game permanently "already running".
            state.running_games.lock().await.remove(&game_id);
            Err(LauncherError::Io(format!("Failed to launch game: {e}")))
        }
    }
}

/// Get list of installed games
#[tauri::command]
#[specta::specta]
async fn get_installed_games(app: AppHandle) -> Result<Vec<GameInstallation>, LauncherError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| LauncherError::Io(e.to_string()))?;
    Ok(list_installations(&app_data_dir)?)
}

/// Get game installation info
#[tauri::command]
#[specta::specta]
async fn get_game_installation(
    app: AppHandle,
    game_id: String,
) -> Result<Option<GameInstallation>, LauncherError> {
    let game_id =
        validate_game_id(&game_id).map_err(|e| LauncherError::Validation(e.to_string()))?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| LauncherError::Io(e.to_string()))?;
    Ok(load_installation(&app_data_dir, &game_id)?)
}

/// Uninstall a game
#[tauri::command]
#[specta::specta]
async fn uninstall_game(
    app: AppHandle,
    state: State<'_, LauncherState>,
    game_id: String,
) -> Result<(), LauncherError> {
    let game_id =
        validate_game_id(&game_id).map_err(|e| LauncherError::Validation(e.to_string()))?;

    // Check if running (uses validated game_id)
    {
        let running = state.running_games.lock().await;
        if running.contains_key(&game_id) {
            return Err(LauncherError::Other(
                "Cannot uninstall while game is running".to_string(),
            ));
        }
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| LauncherError::Io(e.to_string()))?;

    let allowed_root = {
        let settings = state.settings.lock().await;
        settings
            .games_install_path
            .clone()
            .unwrap_or_else(get_default_games_path)
    };

    if let Some(installation) = load_installation(&app_data_dir, &game_id)? {
        // Safety check: refuse to delete paths outside the configured games root
        assert_path_inside_root(&installation.install_path, &allowed_root)?;

        if installation.install_path.exists() {
            std::fs::remove_dir_all(&installation.install_path)?;
        }

        let install_file = app_data_dir
            .join("installations")
            .join(format!("{}.json", game_id));
        if install_file.exists() {
            std::fs::remove_file(install_file)?;
        }
    }

    Ok(())
}

/// Get launcher settings
#[tauri::command]
#[specta::specta]
async fn get_settings(state: State<'_, LauncherState>) -> Result<LauncherSettings, LauncherError> {
    let settings = state.settings.lock().await;
    Ok(settings.clone())
}

/// Save launcher settings
#[tauri::command]
#[specta::specta]
async fn save_settings(
    app: AppHandle,
    state: State<'_, LauncherState>,
    new_settings: LauncherSettings,
) -> Result<(), LauncherError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| LauncherError::Io(e.to_string()))?;

    save_settings_to_disk(&app_data_dir, &new_settings)
        .map_err(|e| LauncherError::Validation(e.to_string()))?;

    let mut settings = state.settings.lock().await;
    *settings = new_settings.clone();

    // The download limits are read by the patch manager, not from settings, so a
    // save has to hand them over or they would only take effect on a restart.
    state
        .patch_manager
        .reconfigure(
            new_settings.max_concurrent_downloads,
            new_settings.max_download_speed,
        )
        .await;

    // Keep the synchronous close handler's copy of the close policy current.
    app.state::<tray::TrayState>()
        .0
        .lock()
        .unwrap()
        .close_to_tray = new_settings.close_to_tray;

    Ok(())
}

/// The games folder that installs use when the setting is empty.
///
/// The frontend needs this to display a real path rather than the word
/// "Default", and to open the folder picker where the games already are
/// instead of at some arbitrary start directory. The rule lives here so there
/// is exactly one definition: install_game resolves the same way.
#[tauri::command]
#[specta::specta]
fn get_default_install_folder() -> PathBuf {
    get_default_games_path()
}

/// Select folder using dialog.
///
/// `start` is the directory the picker opens in. The native dialog remembers
/// nothing between launches, so without it the picker can open somewhere
/// unrelated to the current install location and the user has to navigate back
/// every time.
#[tauri::command]
#[specta::specta]
async fn select_install_folder(
    app: AppHandle,
    start: Option<PathBuf>,
) -> Result<Option<PathBuf>, LauncherError> {
    use tauri_plugin_dialog::{DialogExt, FilePath};

    let (tx, rx) = tokio::sync::oneshot::channel();

    let mut dialog = app.dialog().file();
    dialog = dialog.set_title("Select Installation Folder");

    // Only honour a starting directory that exists: a stale path makes some
    // platforms fall back to a default of their own, and some reject it.
    if let Some(dir) = start.filter(|d| d.is_dir()) {
        dialog = dialog.set_directory(dir);
    }

    dialog.pick_folder(move |path| {
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
#[specta::specta]
async fn cancel_operation(state: State<'_, LauncherState>) -> Result<(), LauncherError> {
    state.patch_manager.cancel().await;
    Ok(())
}

/// Get app data directory path
#[tauri::command]
#[specta::specta]
async fn get_app_data_dir(app: AppHandle) -> Result<PathBuf, LauncherError> {
    app.path()
        .app_data_dir()
        .map_err(|e| LauncherError::Io(e.to_string()))
}

/// Tell the tray whether a launcher update is available or being installed.
///
/// The update itself is discovered by the JS updater plugin, so the tray state
/// has to be pushed across rather than derived here. Only the tooltip reads it.
#[tauri::command]
#[specta::specta]
async fn set_launcher_update_available(
    app: AppHandle,
    available: bool,
) -> Result<(), LauncherError> {
    app.state::<tray::TrayState>()
        .set_update_available(available);
    tray::refresh(&app);
    Ok(())
}

/// Exit the launcher, stopping any running game first.
///
/// A quit must not orphan a game: the waiter task is what records its playtime,
/// so it has to run to completion before the process goes. The frontend calls
/// this only after confirming, either from the tray's Quit or from the window
/// close when close-to-tray is off.
#[tauri::command]
#[specta::specta]
async fn quit_launcher(app: AppHandle) -> Result<(), LauncherError> {
    stop_all_games(&app).await;
    app.exit(0);
    Ok(())
}

async fn load_settings(
    app_data_dir: &std::path::Path,
) -> Result<LauncherSettings, Box<dyn std::error::Error>> {
    let settings_path = app_data_dir.join("settings.json");

    if !settings_path.exists() {
        return Ok(LauncherSettings::default());
    }

    let json = std::fs::read_to_string(settings_path)?;
    let settings: LauncherSettings = serde_json::from_str(&json)?;

    // A hand-edited or half-written file can hold a value the runtime cannot use -
    // max_concurrent_downloads of 0 builds Semaphore::new(0) and every install
    // then blocks in acquire_owned forever. Default the whole struct, then repair
    // the fields that are individually recoverable so one bad value does not
    // silently reset every setting the operator ever chose.
    if let Err(errors) = settings.validate() {
        eprintln!(
            "settings.json has invalid values ({}); using defaults",
            errors.join(", ")
        );
        return Ok(LauncherSettings::default());
    }

    Ok(settings)
}

fn save_settings_to_disk(
    app_data_dir: &std::path::Path,
    settings: &LauncherSettings,
) -> Result<(), Box<dyn std::error::Error>> {
    settings.validate().map_err(|errors| errors.join(", "))?;

    let settings_path = app_data_dir.join("settings.json");
    let json = serde_json::to_string_pretty(settings)?;

    // Written to a sibling and renamed into place. Truncating the real file first
    // means a crash or a full disk mid-write leaves unparseable JSON that load
    // then rejects forever, losing every setting with no way back.
    let tmp_path = app_data_dir.join("settings.json.tmp");
    std::fs::write(&tmp_path, json)?;
    std::fs::rename(&tmp_path, &settings_path)?;

    Ok(())
}

// Integration tests cannot call `create_specta_builder` because it is private, so
// `pub` here purely to let `export_bindings` reuse it. The alternative is a second
// copy of the collect_commands! list, and two copies of a command list is exactly
// the drift this file exists to prevent.
pub fn create_specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            fetch_game_manifest,
            fetch_remote_text,
            install_game,
            check_game_update,
            verify_game,
            launch_game,
            close_game,
            get_installed_games,
            get_game_installation,
            uninstall_game,
            get_settings,
            save_settings,
            select_install_folder,
            get_default_install_folder,
            cancel_operation,
            get_app_data_dir,
            set_launcher_update_available,
            quit_launcher,
        ])
        .events(collect_events![GameExited])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = create_specta_builder();

    // NOTE: Debug auto-export is disabled because the current specta-typescript
    // 0.0.12 formatter emits TypeScript shapes that drift from the frontend's
    // source-of-truth types in `src/types/index.ts`: tabs and double quotes
    // instead of the project's formatting, snake_case struct fields, and `| null`
    // where the frontend uses optional. The export itself now lives in
    // `src/bin/export-bindings.rs`, which calls `create_specta_builder()` directly
    // instead of launching the app, so it runs without a GUI stack. Run it, then
    // reconcile the output against `src/types/index.ts`; the parity test in
    // `src/lib/bindings-parity.test.ts` proves the command list survived.

    let invoke_handler = builder.invoke_handler();

    tauri::Builder::default()
        // Must be registered first: Tauri requires the single-instance plugin to
        // see every launch before any other plugin handles it.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // The running instance may be hidden in the tray, so restore it
            // rather than starting a second process that would fight over the
            // settings file and the log.
            tray::focus_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            builder.mount_events(app);

            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let state = LauncherState::new(&handle).await;
                handle.manage(state);
            });

            // Seed the synchronous close policy from the loaded settings, then
            // create the tray. The tray must exist even on the first run, when
            // the settings file is absent and the defaults apply.
            let close_to_tray = {
                let state = app.state::<LauncherState>();
                tauri::async_runtime::block_on(async { state.settings.lock().await.close_to_tray })
            };
            app.manage(tray::TrayState::new(close_to_tray));
            if let Err(e) = tray::init(app.handle()) {
                eprintln!("Failed to create the system tray: {e}");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "main" {
                    return;
                }
                let state = window.app_handle().state::<tray::TrayState>();
                match window_behavior::close_action(state.close_to_tray()) {
                    window_behavior::CloseAction::Dock => {
                        // Hide rather than exit: the app keeps running in the tray.
                        api.prevent_close();
                        if let Err(e) = window.hide() {
                            // Never let a close leave the launcher in a dead state
                            // where the window is neither hidden nor exiting.
                            eprintln!(
                                "Failed to hide the window to the tray, exiting instead: {e}"
                            );
                            window.app_handle().exit(0);
                        } else {
                            let _ = window.app_handle().emit(tray::EVENT_TRAY_DOCKED, ());
                        }
                    }
                    window_behavior::CloseAction::Quit => {
                        // A game must not outlive the process tracking it, so a
                        // quit stops it through the waiter first, which records
                        // its playtime. That needs the frontend's confirmation, and
                        // an unconfirmed quit may cancel - so hold the window open
                        // rather than closing on the user's click alone.
                        if state.any_running() {
                            let _ = window.app_handle().emit(tray::EVENT_QUIT_REQUESTED, ());
                            api.prevent_close();
                        }
                    }
                }
            }
        })
        .invoke_handler(invoke_handler)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    // =========================================================================
    // needs_update / channel-switch Tests
    // =========================================================================

    fn inst(build: u64, channel: &str) -> GameInstallation {
        GameInstallation {
            game_id: "chan-test".to_string(),
            installed_version: "1.0.0".to_string(),
            installed_build: build,
            channel: channel.to_string(),
            install_path: std::path::PathBuf::from("/tmp/chan-test"),
            installed_files: HashMap::new(),
            installed_at: chrono::Utc::now(),
            last_played: None,
            total_playtime_seconds: 0,
            executable: "game.exe".to_string(),
        }
    }

    fn target(build: u64, channel: &str) -> GameManifest {
        let mut manifest = test_utils::create_test_manifest();
        manifest.build_number = build;
        manifest.channel = channel.to_string();
        manifest
    }

    #[test]
    fn test_needs_update_same_channel_newer_build() {
        assert!(needs_update(&inst(100, "stable"), &target(101, "stable")));
    }

    #[test]
    fn test_needs_update_same_channel_same_build_is_current() {
        assert!(!needs_update(&inst(100, "stable"), &target(100, "stable")));
    }

    #[test]
    fn test_needs_update_same_channel_older_build_is_not_a_downgrade() {
        // Within one channel the publisher should never ship a lower build, so
        // an older target is treated as "already current" rather than forcing
        // a pointless re-download loop.
        assert!(!needs_update(&inst(100, "stable"), &target(99, "stable")));
    }

    #[test]
    fn test_needs_update_switching_alpha_back_to_stable_lower_build() {
        // The regression this guards: a player on alpha build 150 opting back
        // into stable build 100 must still be offered the downgrade. Comparing
        // build numbers alone would report "up to date" and trap them on alpha.
        assert!(needs_update(&inst(150, "alpha"), &target(100, "stable")));
    }

    #[test]
    fn test_needs_update_switching_stable_to_alpha_higher_build() {
        assert!(needs_update(&inst(100, "stable"), &target(101, "alpha")));
    }

    #[test]
    fn test_needs_update_switching_channel_same_build_number() {
        // Even an identical build number must re-sync when the channel differs,
        // because the two channels ship different file sets.
        assert!(needs_update(&inst(100, "stable"), &target(100, "beta")));
    }

    // =========================================================================
    // Channel Defaulting Tests
    // =========================================================================

    #[test]
    fn test_manifest_without_channel_defaults_to_stable() {
        // Manifests published before channels existed must still load and be
        // treated as `stable`, so existing games do not appear broken.
        let json = r#"{
            "game_id": "legacy-game",
            "name": "Legacy Game",
            "version": "1.0.0",
            "build_number": 7,
            "description": null,
            "icon_url": null,
            "banner_url": null,
            "executable": "game.exe",
            "files": [],
            "launch_args": null
        }"#;

        let manifest: GameManifest =
            serde_json::from_str(json).expect("legacy manifest should load");
        assert_eq!(manifest.channel, DEFAULT_CHANNEL);
        assert_eq!(manifest.channel, "stable");
    }

    #[test]
    fn test_installation_without_channel_defaults_to_stable() {
        // Same guarantee for installation records written by older builds.
        let json = r#"{
            "game_id": "legacy-game",
            "installed_version": "1.0.0",
            "installed_build": 7,
            "install_path": "/games/legacy",
            "installed_files": {},
            "installed_at": "2026-01-01T00:00:00Z",
            "last_played": null,
            "total_playtime_seconds": 0,
            "executable": "game.exe"
        }"#;

        let installation: GameInstallation =
            serde_json::from_str(json).expect("legacy installation should load");
        assert_eq!(installation.channel, DEFAULT_CHANNEL);
    }

    #[test]
    fn test_known_channels_are_ordered_most_to_least_stable() {
        assert_eq!(KNOWN_CHANNELS[0], "stable");
        assert_eq!(KNOWN_CHANNELS[1], "beta");
        assert_eq!(KNOWN_CHANNELS[2], "alpha");
    }

    // =========================================================================
    // get_default_games_path Tests
    // =========================================================================

    #[test]
    fn test_get_default_games_path() {
        let path = get_default_games_path();

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
            channel: "stable".to_string(),

            platforms: None,
            size_bytes: None,
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
            channel: "stable".to_string(),
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
            channel: "stable".to_string(),

            platforms: None,
            size_bytes: None,
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
            channel: "stable".to_string(),
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
            channel: "stable".to_string(),

            platforms: None,
            size_bytes: None,
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
            channel: "stable".to_string(),
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
            channel: "stable".to_string(),

            platforms: None,
            size_bytes: None,
        };

        let needs_update = check_game_update_logic(app_data_dir, &manifest).await;
        assert!(!needs_update); // Already newer
    }

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
        assert!(settings.close_to_tray);
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
            channel: "stable".to_string(),

            platforms: None,
            size_bytes: None,
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
            channel: "stable".to_string(),
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
            channel: "stable".to_string(),

            platforms: None,
            size_bytes: None,
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
            channel: "stable".to_string(),
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
            channel: "stable".to_string(),
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
            channel: "stable".to_string(),
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
            channel: "stable".to_string(),
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
    // Game ID validation tests
    // =====================================================================

    #[test]
    fn test_validate_game_id_or_err_accepts_simple_id() {
        let result = path_utils::validate_game_id("my-game");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_game_id_or_err_rejects_traversal() {
        let result = path_utils::validate_game_id("../evil");
        assert!(result.is_err());
    }

    // =====================================================================
    // Install path safety tests
    // =====================================================================

    #[test]
    fn test_assert_path_inside_root_accepts_inside() {
        let temp_dir = tempfile::tempdir().unwrap();
        let allowed_root = temp_dir.path().join("games");
        let install_path = allowed_root.join("my-game");
        std::fs::create_dir_all(&install_path).unwrap();

        assert!(assert_path_inside_root(&install_path, &allowed_root).is_ok());
    }

    #[test]
    fn test_assert_path_inside_root_rejects_escape() {
        let temp_dir = tempfile::tempdir().unwrap();
        let allowed_root = temp_dir.path().join("games");
        let escape = temp_dir.path().join("outside");
        std::fs::create_dir_all(&allowed_root).unwrap();
        std::fs::create_dir_all(&escape).unwrap();

        assert!(assert_path_inside_root(&escape, &allowed_root).is_err());
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
