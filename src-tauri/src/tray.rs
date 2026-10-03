use std::sync::Mutex;

use tauri::{
    image::Image,
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Wry,
};

/// What the tray reflects about the running app.
///
/// A std `Mutex`, not the tokio one used elsewhere: the `CloseRequested`
/// handler is synchronous and must read the close policy without waiting on the
/// async runtime it would otherwise deadlock against.
pub struct TrayState(pub Mutex<TrayData>);

#[derive(Default)]
pub struct TrayData {
    /// Mirrors the `close_to_tray` setting so the window-close handler can
    /// decide synchronously whether to hide the window or let the app exit.
    pub close_to_tray: bool,
    /// Games the launcher is currently running. The launcher can run more than
    /// one at a time, so this is a list and not an Option.
    pub running: Vec<RunningGame>,
    /// Set from the frontend when the updater finds or installs an update, so
    /// the tooltip can say so.
    pub update_available: bool,
}

#[derive(Clone)]
pub struct RunningGame {
    pub game_id: String,
    pub name: String,
}

impl TrayState {
    pub fn new(close_to_tray: bool) -> Self {
        Self(Mutex::new(TrayData {
            close_to_tray,
            running: Vec::new(),
            update_available: false,
        }))
    }

    /// The close policy and whether a game is running, read together so the
    /// window handler cannot observe a half-updated pair.
    pub fn close_policy(&self) -> (bool, bool) {
        let data = self.0.lock().unwrap();
        (data.close_to_tray, !data.running.is_empty())
    }

    pub fn add_running(&self, game: RunningGame) {
        let mut data = self.0.lock().unwrap();
        data.running.retain(|g| g.game_id != game.game_id);
        data.running.push(game);
    }

    pub fn remove_running(&self, game_id: &str) {
        let mut data = self.0.lock().unwrap();
        data.running.retain(|g| g.game_id != game_id);
    }

    pub fn set_update_available(&self, available: bool) {
        self.0.lock().unwrap().update_available = available;
    }
}

pub const TRAY_ID: &str = "tray";
const OPEN_ID: &str = "tray-open";
const UPDATE_ID: &str = "tray-check-updates";
const QUIT_ID: &str = "tray-quit";
/// Stop items are built per running game; the id carries the game id.
const STOP_PREFIX: &str = "tray-stop:";

/// Emitted when the tray's Check for updates is chosen; the updater is JS.
pub const EVENT_CHECK_UPDATES: &str = "tray-check-updates";
/// Emitted when Quit is chosen while a game runs, so the frontend can confirm.
pub const EVENT_QUIT_REQUESTED: &str = "tray-quit-requested";
/// Emitted when the window docks to the tray, so the frontend can show the
/// one-time tray hint at the moment the user loses the window.
pub const EVENT_TRAY_DOCKED: &str = "tray-docked";

/// Show, restore and focus the launcher window.
///
/// The tray's Open item and the single-instance handler both need the same
/// "bring it back from the tray" behaviour, so it lives here once.
pub fn focus_main_window(app: &AppHandle<Wry>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn init(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID).on_menu_event(on_menu_event);

    // Prefer the icon the app already has; a dev build does not always resolve
    // one, so fall back to the bundled PNG rather than shipping a blank tray.
    let icon = app
        .default_window_icon()
        .cloned()
        .or_else(|| Image::from_bytes(include_bytes!("../icons/icon.png")).ok());
    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    refresh(app);
    Ok(())
}

fn tooltip_text(data: &TrayData) -> String {
    match data.running.len() {
        0 if data.update_available => "Pandawan Launcher — update available".to_string(),
        0 => "Pandawan Launcher".to_string(),
        1 => format!("Pandawan Launcher — {} is running", data.running[0].name),
        n => format!("Pandawan Launcher — {n} games running"),
    }
}

fn build_menu(app: &AppHandle<Wry>, data: &TrayData) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(
        app,
        OPEN_ID,
        "Open Pandawan Launcher",
        true,
        None::<&str>,
    )?)?;

    // Stop is only meaningful while something is running, and it names the game
    // so the item says what it will stop.
    for game in &data.running {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(
            app,
            format!("{STOP_PREFIX}{}", game.game_id),
            format!("Stop {}", game.name),
            true,
            None::<&str>,
        )?)?;
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        UPDATE_ID,
        "Check for updates",
        true,
        None::<&str>,
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(
        app,
        QUIT_ID,
        "Quit",
        true,
        None::<&str>,
    )?)?;
    Ok(menu)
}

/// Rebuild the tray menu and tooltip from the current state.
pub fn refresh(app: &AppHandle<Wry>) {
    let (tooltip, menu) = {
        let state = app.state::<TrayState>();
        let data = state.0.lock().unwrap();
        (tooltip_text(&data), build_menu(app, &data))
    };

    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match menu {
        Ok(menu) => {
            let _ = tray.set_menu(Some(menu));
        }
        Err(e) => eprintln!("Failed to rebuild the tray menu: {e}"),
    }
    let _ = tray.set_tooltip(Some(tooltip));
}

fn request_quit(app: &AppHandle<Wry>) {
    let running = app.state::<TrayState>().0.lock().unwrap().running.len();
    if running > 0 {
        // Quitting now would drop the running session's playtime (the launcher
        // owns the waiter that records it), so let the frontend confirm first.
        let _ = app.emit(EVENT_QUIT_REQUESTED, ());
    } else {
        app.exit(0);
    }
}

fn on_menu_event(app: &AppHandle<Wry>, event: MenuEvent) {
    let id = event.id().as_ref();
    if id == OPEN_ID {
        focus_main_window(app);
    } else if let Some(game_id) = id.strip_prefix(STOP_PREFIX) {
        let game_id = game_id.to_string();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = crate::stop_game_by_id(&app, &game_id).await {
                eprintln!("Failed to stop game from the tray: {e}");
            }
        });
    } else if id == UPDATE_ID {
        let _ = app.emit(EVENT_CHECK_UPDATES, ());
    } else if id == QUIT_ID {
        request_quit(app);
    }
}
