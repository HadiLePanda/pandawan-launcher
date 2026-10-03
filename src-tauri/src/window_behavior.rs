//! The rule that decides what closing the main window means.
//!
//! Kept as a pure function so the policy is testable without a Tauri runtime
//! and cannot hide inside a window-event handler.

/// What a close of the main window should do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseAction {
    /// Hide the window; the app keeps running in the tray.
    Dock,
    /// Quit. A running game is stopped through the waiter that owns its
    /// process, so the session still records its playtime.
    Quit,
}

/// Closing is the one preference: `close_to_tray` off means the user asked for a
/// quit on close, and a quit that left a game running would detach it from the
/// launcher that tracks it.
///
/// Whether a game is running is deliberately NOT an input. It used to override
/// the setting and dock anyway, which made the toggle a lie: turning it off
/// while a game played still refused to close. The quit path stops the game
/// through the waiter instead, so its playtime is still recorded.
pub fn close_action(close_to_tray: bool) -> CloseAction {
    if close_to_tray {
        CloseAction::Dock
    } else {
        CloseAction::Quit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docks_when_close_to_tray_is_set() {
        assert_eq!(close_action(true), CloseAction::Dock);
    }

    #[test]
    fn quits_when_close_to_tray_is_off() {
        assert_eq!(close_action(false), CloseAction::Quit);
    }
}
