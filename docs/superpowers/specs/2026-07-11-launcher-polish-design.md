# Pandawan Launcher Polish — Design Spec

**Date:** 2026-07-11  
**Scope:** Finish the currently stubbed/unreachable launcher features. Skip the Store view (last priority).

## Goals

1. Make the **Add Game** modal reachable from the Games home view.
2. Wire **Verify Files** end-to-end using the existing Rust backend.
3. Make update detection **automatic and consistent** by using `build_number` from the backend.
4. Keep the **Playing** status accurate by reporting process exit from Rust to React.
5. **Persist notification settings** in `LauncherSettings`.
6. Keep the **player profile button** visible (launcher identity) and open a minimal placeholder panel.
7. Add backend/functional tests for new behavior.

## Non-goals

- Store view redesign (deferred).
- Real account system / login.
- Delta patching.

## Architecture

### Frontend (React / Zustand)

- `GamesHome` gains an **"Install a Game"** card at the end of the grid when uninstalled titles exist.
- `App.tsx` owns `isAddGameOpen` state and passes it to `AddGameModal`.
- `App.tsx` owns a verification modal state and displays results from a new `verifyGame` service call.
- `store.ts`:
  - Calls `checkForUpdates` for every catalog game after `loadGames` merges installations.
  - Removes the hardcoded 5s launch timeout.
  - Listens for a Tauri `game-exited` event and resets status to `installed`.
- `Settings.tsx` notification tab reads/writes four new booleans in `LauncherSettings`.
- New `PlayerProfile.tsx` placeholder modal opened from `AppTopBar`.

### Backend (Rust / Tauri)

- `launch_game` emits a Tauri event (`game-exited`) when the child process exits, carrying `game_id`.
- `verify_game` already exists and returns `VerificationResult`. Add a frontend wrapper only.
- `check_game_update` is already the source of truth; use it from `store.ts`.

### Data model changes

`LauncherSettings` gains:

```ts
notifyGameUpdates: boolean;
notifyDownloadComplete: boolean;
notifyFriendActivity: boolean;
notifyNewsEvents: boolean;
```

Rust `LauncherSettings` mirrors these fields with `#[serde(default)]` so existing saved settings still load.

## Error handling

- Verification failures surface in the modal as an error message.
- Update checks fail silently per game (logged) so a single unreachable manifest doesn't break the catalog.
- Process-exit event listener unsubscribes on cleanup.

## Testing

- Rust unit tests for the event-emitting launch helper (mock process handle).
- Rust tests for `VerificationResult` serialization and verify command input.
- Frontend functional tests for `store.ts` update detection and notification settings persistence.
- `npm run build` and `cargo test` must remain green.
