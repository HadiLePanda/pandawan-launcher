# Pandawan Launcher Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan inline.

**Goal:** Finish stubbed/unreachable launcher features (Add Game, Verify Files, auto updates, process lifecycle, notification persistence, player profile placeholder) and keep tests green.

**Architecture:** Add frontend entry points/modals for Add Game and Verify Files; wire store actions to backend commands; emit a Tauri event from Rust when a launched game exits; extend `LauncherSettings` with notification toggles; keep the player profile button visible with a placeholder panel.

**Tech Stack:** React 19, Zustand, TypeScript, Tailwind CSS v4, Tauri v2, Rust, reqwest, tokio.

---

## File map

| File                               | Responsibility                                                         |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `src/types/index.ts`               | Add `VerificationResult` and notification fields to `LauncherSettings` |
| `src/lib/commands.ts`              | Add `verifyGame` invoke helper                                         |
| `src/lib/game-service.ts`          | Add `verifyGame` service wrapper                                       |
| `src/lib/store.ts`                 | Auto update checks, process-exit listener, remove 5s timeout           |
| `src/components/GamesHome.tsx`     | Add "Install a Game" card to open `AddGameModal`                       |
| `src/App.tsx`                      | Wire `AddGameModal`, verify modal, `PlayerProfile` modal               |
| `src/components/GamePage.tsx`      | Hook verify into menu                                                  |
| `src/components/Settings.tsx`      | Persist notification toggles                                           |
| `src/components/PlayerProfile.tsx` | New placeholder profile panel                                          |
| `src/components/AppTopBar.tsx`     | Open profile panel on player button click                              |
| `src-tauri/src/types.rs`           | Add notification fields to `LauncherSettings`                          |
| `src-tauri/src/lib.rs`             | Emit `game-exited` event on process exit                               |
| `src-tauri/src/patch.rs`           | Expose `VerificationResult` for IPC                                    |
| `src/lib/store.test.ts`            | New tests for update detection and settings                            |
| `src-tauri/src/lib.rs` / tests     | Rust tests for launch event helper                                     |

---

## Task 1: Extend settings and types

**Files:**

- Modify: `src/types/index.ts`
- Modify: `src-tauri/src/types.rs`

- [ ] **Step 1: Add notification fields to TypeScript `LauncherSettings`**

```ts
export interface LauncherSettings {
  gamesInstallPath: string | null;
  maxDownloadSpeed: number | null;
  maxConcurrentDownloads: number;
  autoUpdateGames: boolean;
  autoUpdateLauncher: boolean;
  minimizeToTray: boolean;
  closeToTray: boolean;
  language: string;
  theme: string;
  notifyGameUpdates: boolean;
  notifyDownloadComplete: boolean;
  notifyFriendActivity: boolean;
  notifyNewsEvents: boolean;
}
```

- [ ] **Step 2: Add notification fields to Rust `LauncherSettings`**

```rust
pub struct LauncherSettings {
    // ... existing fields ...
    #[serde(default)]
    pub notify_game_updates: bool,
    #[serde(default)]
    pub notify_download_complete: bool,
    #[serde(default)]
    pub notify_friend_activity: bool,
    #[serde(default)]
    pub notify_news_events: bool,
}
```

Set defaults to `true` for update/download/news toggles and `false` for friend activity.

- [ ] **Step 3: Add `VerificationResult` type to TypeScript**

```ts
export interface VerificationResult {
  valid_files: number;
  invalid_files: string[];
  missing_files: string[];
  is_valid: boolean;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npm run build`  
Expected: no new TypeScript errors.

---

## Task 2: Verify files end-to-end

**Files:**

- Modify: `src/lib/commands.ts`
- Modify: `src/lib/game-service.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/GamePage.tsx`

- [ ] **Step 1: Add `verifyGame` to commands**

```ts
verifyGame: (manifest: GameManifest, installPath: string) =>
  invoke<VerificationResult>('verify_game', { manifest, installPath }),
```

- [ ] **Step 2: Add `verifyGame` service wrapper**

```ts
export async function verifyGame(gameId: string, channel: string): Promise<VerificationResult> {
  const game = await commands.getGameInstallation(gameId);
  if (!game) throw new Error('Game is not installed');
  const { manifestUrl } = resolveGameUrls(gameId, channel);
  const manifest = await fetchGameManifest(manifestUrl);
  return commands.verifyGame(manifest, game.install_path);
}
```

- [ ] **Step 3: Add verify modal state and handler in `App.tsx`**

Replace the `alert` stub with a state-driven modal:

```ts
const [verifyTarget, setVerifyTarget] = useState<Game | null>(null);
const [verifyResult, setVerifyResult] = useState<VerificationResult | null>(null);
const [verifyError, setVerifyError] = useState<string | null>(null);

const handleVerifyGame = async (gameId: string) => {
  const game = games.find((g) => g.info.id === gameId);
  if (!game) return;
  setVerifyTarget(game);
  setVerifyResult(null);
  setVerifyError(null);
  try {
    const result = await gameService.verifyGame(gameId, game.info.channel);
    setVerifyResult(result);
  } catch (err) {
    setVerifyError(errorMessage(err));
  }
};
```

- [ ] **Step 4: Render verify result modal**

Add a new modal component inline or in a new file; show counts of valid/invalid/missing files and a close button.

- [ ] **Step 5: Verify from GamePage menu**

`GamePage` already calls `onVerify`; no change needed beyond `App.tsx`.

---

## Task 3: Automatic update detection

**Files:**

- Modify: `src/lib/store.ts`

- [ ] **Step 1: Remove frontend version comparison in `mergeInstallations`**

Set `hasUpdate: false` there; updates will be determined by `checkForUpdates`.

- [ ] **Step 2: Add `refreshUpdateStatus` action**

```ts
refreshUpdateStatus: async () => {
  const { games } = get();
  await Promise.all(
    games.map(async (g) => {
      if (g.status !== 'installed') return;
      try {
        const hasUpdate = await gameService.checkForUpdates(g.info.id, g.info.channel);
        set((state) => ({
          games: state.games.map((game) =>
            game.info.id === g.info.id ? { ...game, hasUpdate } : game
          ),
        }));
      } catch (err) {
        logger.warn('Update check failed', { gameId: g.info.id, error: String(err) });
      }
    })
  );
},
```

- [ ] **Step 3: Call `refreshUpdateStatus` after `loadGames`**

In `loadGames`, after merging installations, call `await get().refreshUpdateStatus()`.

- [ ] **Step 4: Add light test**

Create `src/lib/store.test.ts` with a test that mocks `gameService.checkForUpdates` and verifies `hasUpdate` is set.

---

## Task 4: Process lifecycle event

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/store.ts`

- [ ] **Step 1: Emit Tauri event on process exit**

In `launch_game`, change the spawned wait task:

```rust
let app_handle = app.clone();
let game_id_clone = game_id.clone();
tauri::async_runtime::spawn(async move {
    if let Some(mut child) = { ... } {
        let _ = child.wait().await;
        let _ = app_handle.emit("game-exited", GameExitedPayload { game_id: game_id_clone });
    }
});
```

Add `GameExitedPayload` to `types.rs`:

```rust
#[derive(Clone, Serialize)]
pub struct GameExitedPayload {
    pub game_id: String,
}
```

- [ ] **Step 2: Listen in `store.ts` on init**

In `useLauncherStore`, after `loadSettings`/`loadCatalog`, or in an effect in `App.tsx`, listen:

```ts
import { listen } from '@tauri-apps/api/event';

// inside store init or App effect
listen<{ game_id: string }>('game-exited', (event) => {
  get().updateGameStatus(event.payload.game_id, 'installed');
});
```

- [ ] **Step 3: Remove 5s timeout**

Delete `setTimeout(() => updateGameStatus(gameId, 'installed'), 5000)` in `launchGame`.

- [ ] **Step 4: Add Rust test**

Add a unit test that calls a helper `emit_game_exited_on_wait` with a mock child (or test the payload serialization).

---

## Task 5: Notification settings persistence

**Files:**

- Modify: `src/components/Settings.tsx`
- Modify: `src/lib/store.ts` (default settings shape)

- [ ] **Step 1: Update `DEFAULT_SETTINGS` in `Settings.tsx`**

Add the four notification booleans.

- [ ] **Step 2: Make `NotificationSettings` read/write `settings`**

Change signature to accept `settings` and `onChange`, remove local `useState`.

- [ ] **Step 3: Pass `LauncherSettings` defaults in store init / load**

Ensure `loadSettings` returns the new defaults when fields are missing.

---

## Task 6: Player profile placeholder

**Files:**

- Create: `src/components/PlayerProfile.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/AppTopBar.tsx`

- [ ] **Step 1: Create placeholder modal**

A simple modal with avatar placeholder, "Player" name, and "Account features coming soon."

- [ ] **Step 2: Wire open/close in `App.tsx`**

Add `isProfileOpen` state and pass `onPlayerClick={() => setIsProfileOpen(true)}`.

- [ ] **Step 3: Update `AppTopBar`**

`onPlayerClick` already wired; ensure it is called.

---

## Task 7: Add Game entry point

**Files:**

- Modify: `src/components/GamesHome.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add "Install a Game" card**

After the games grid, render a plus card when `uninstalledGames.length > 0`:

```tsx
{
  uninstalledGames.length > 0 && (
    <button onClick={onInstallGame} className="game-card game-card-add">
      <div className="game-card-art">
        <Plus className="w-10 h-10" />
      </div>
      <div className="game-card-content">
        <h3 className="game-card-title">Install a Game</h3>
        <p className="caption">{uninstalledGames.length} available</p>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Pass `onInstallGame` prop from `App.tsx`**

```tsx
<GamesHome
  games={games}
  onSelectGame={handleSelectGame}
  onInstallGame={() => setIsAddGameOpen(true)}
/>
```

---

## Task 8: Final verification

- [ ] Run `cargo test` in `src-tauri` — expect all pass.
- [ ] Run `npm test` — expect all pass.
- [ ] Run `npm run build` — expect no TypeScript errors.
- [ ] Run `cargo clippy --all-targets -- -D warnings` — expect clean.

---

## Execution choice

Plan complete and saved to `docs/superpowers/plans/2026-07-11-launcher-polish-plan.md`.

**Recommended:** Inline execution in this session so the plan can be adjusted if any step needs to change.
