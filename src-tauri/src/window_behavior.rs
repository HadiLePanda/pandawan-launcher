//! The rule that decides what closing the main window means.
//!
//! Kept as a pure function so the policy is testable without a Tauri runtime
//! and cannot hide inside a window-event handler.

/// Whether closing the main window should dock to the tray instead of exiting.
///
/// A running game always docks, regardless of the `close_to_tray` setting. That
/// override is not a preference: the launcher owns the waiter task that records
/// playtime and emits `game-exited`, so exiting the launcher mid-game silently
/// loses the whole session's playtime. Refusing to quit is the lesser surprise,
/// and the tray's explicit Quit still offers a real exit after a confirmation.
pub fn should_dock_on_close(close_to_tray: bool, game_running: bool) -> bool {
    close_to_tray || game_running
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quits_when_neither_is_set() {
        assert!(!should_dock_on_close(false, false));
    }

    #[test]
    fn docks_when_close_to_tray_is_set() {
        assert!(should_dock_on_close(true, false));
    }

    #[test]
    fn docks_when_a_game_is_running_even_with_the_setting_off() {
        assert!(should_dock_on_close(false, true));
    }

    #[test]
    fn docks_when_both_are_set() {
        assert!(should_dock_on_close(true, true));
    }
}
