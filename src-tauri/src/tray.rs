use std::sync::Mutex;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Wry,
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
}

pub const TRAY_ID: &str = "tray";
const OPEN_ID: &str = "tray-open";
const TOOLTIP_PLAIN: &str = "Pandawan Launcher";

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
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(
        app,
        OPEN_ID,
        "Open Pandawan Launcher",
        true,
        None::<&str>,
    )?)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(TOOLTIP_PLAIN)
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == OPEN_ID {
                focus_main_window(app);
            }
        });

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
    Ok(())
}
