# Phase 2 — Type Safety + IPC Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan inline.

**Goal:** Generate TypeScript bindings from Rust, replace string errors with structured errors, and unify duplicated domain types/helpers.

**Architecture:** Add tauri-specta to the Rust backend, derive `specta::Type` on IPC types, export a `src/lib/bindings.ts` file from `build.rs`, and consume it from the frontend. Introduce a `LauncherError` enum returned by every command. Delete unused Rust `GameInfo` and dead TS status values.

**Tech Stack:** Tauri v2, tauri-specta v2, specta v2, TypeScript 5, React, Zustand.

---

## File map

| File                             | Responsibility                                                      |
| -------------------------------- | ------------------------------------------------------------------- |
| `src-tauri/Cargo.toml`           | Add tauri-specta and specta dependencies                            |
| `src-tauri/build.rs`             | Generate `src/lib/bindings.ts`                                      |
| `src-tauri/src/types.rs`         | Derive `specta::Type`; add `LauncherError`; delete `GameInfo`       |
| `src-tauri/src/lib.rs`           | Commands return `Result<T, LauncherError>`; add `#[specta::specta]` |
| `src-tauri/src/patch.rs`         | Convert patch errors to `LauncherError`                             |
| `src-tauri/src/download.rs`      | Convert download errors to `LauncherError`                          |
| `src/lib/bindings.ts`            | Generated file (checked in)                                         |
| `src/lib/commands.ts`            | Re-export generated commands                                        |
| `src/lib/store.ts`               | Handle `LauncherError` codes                                        |
| `src/types/index.ts`             | Remove `repairing`; unify `DownloadProgressSnapshot`                |
| `src/lib/game-service.ts`        | Import `DownloadProgressSnapshot` from `download-channel.ts`        |
| `src/lib/cdn.ts`                 | Remove duplicated `formatBytes`                                     |
| `src/lib/utils.ts`               | Keep canonical `formatBytes`                                        |
| `src-tauri/src/types.rs` (tests) | Add `LauncherError` serialization tests                             |

---

## Task 1: Add tauri-specta dependencies

**Files:**

- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add crates**

```toml
[build-dependencies]
tauri-build = { version = "2", features = [] }
tauri-specta = { version = "2", features = ["javascript", "typescript"] }

[dependencies]
tauri-specta = { version = "2", features = ["javascript", "typescript"] }
specta = { version = "2", features = ["derive"] }
```

- [ ] **Step 2: Update `src-tauri/build.rs`**

Replace the existing build script with:

```rust
use std::path::PathBuf;

fn main() {
    tauri_build::build();

    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let out_path = manifest_dir.join("..").join("src").join("lib").join("bindings.ts");

    tauri_specta::Builder::new()
        .commands(tauri_specta::collect_commands![])
        .path(out_path)
        .export_ts()
        .expect("Failed to export TypeScript bindings");
}
```

We will fill `collect_commands!` after adding `#[specta::specta]` to commands.

---

## Task 2: Define LauncherError and derive specta types

**Files:**

- Modify: `src-tauri/src/types.rs`

- [ ] **Step 1: Add `thiserror` if not present**

Already in `Cargo.toml`.

- [ ] **Step 2: Add `LauncherError`**

```rust
use thiserror::Error;

#[derive(Debug, Clone, Error, Serialize, specta::Type)]
#[serde(tag = "code", content = "details")]
pub enum LauncherError {
    #[error("Game is not installed")]
    NotInstalled,
    #[error("Game is already running")]
    AlreadyRunning,
    #[error("Executable not found")]
    ExecutableNotFound { path: String },
    #[error("Path is outside allowed root")]
    PathNotAllowed { path: String },
    #[error("Network request failed")]
    Network(String),
    #[error("Failed to parse manifest")]
    ManifestParse(String),
    #[error("Invalid settings")]
    Validation(String),
    #[error("IO error")]
    Io(String),
    #[error("{0}")]
    Other(String),
}
```

- [ ] **Step 3: Derive `specta::Type` on IPC types**

Add `specta::Type` to:

- `GameManifest`
- `FileEntry`
- `GameInstallation`
- `LauncherSettings`
- `LaunchResult`
- `GameExitedPayload`
- `VerificationResult`
- `DownloadEvent`

Example:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct GameManifest { ... }
```

- [ ] **Step 4: Delete Rust `GameInfo`**

Remove the `GameInfo` struct and its `impl` block. Update or delete related tests.

---

## Task 3: Update commands to return LauncherError

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/patch.rs`
- Modify: `src-tauri/src/download.rs`

- [ ] **Step 1: Convert patch errors**

In `src-tauri/src/patch.rs`, implement `From<PatchError> for LauncherError`:

```rust
impl From<PatchError> for LauncherError {
    fn from(err: PatchError) -> Self {
        match err {
            PatchError::Download(e) => LauncherError::Network(e.to_string()),
            PatchError::Io(e) => LauncherError::Io(e.to_string()),
            PatchError::Other(s) => LauncherError::Other(s),
        }
    }
}
```

- [ ] **Step 2: Convert download errors**

In `src-tauri/src/download.rs`, implement `From<DownloadError> for LauncherError`:

```rust
impl From<DownloadError> for LauncherError {
    fn from(err: DownloadError) -> Self {
        match err {
            DownloadError::Http(s) | DownloadError::Io(s) | DownloadError::Other(s) => {
                LauncherError::Network(s)
            }
        }
    }
}
```

- [ ] **Step 3: Update command signatures in `lib.rs`**

Change every `Result<T, String>` to `Result<T, LauncherError>`. Use `?` with `Into<LauncherError>` conversions.

Example `fetch_game_manifest`:

```rust
async fn fetch_game_manifest(url: String) -> Result<GameManifest, LauncherError> {
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| LauncherError::Network(e.to_string()))?;

    if !response.status().is_success() {
        return Err(LauncherError::Network(format!("HTTP {}", response.status())));
    }

    response
        .json::<GameManifest>()
        .await
        .map_err(|e| LauncherError::ManifestParse(e.to_string()))
}
```

- [ ] **Step 4: Add `#[specta::specta]` to commands**

```rust
#[tauri::command]
#[specta::specta]
async fn fetch_game_manifest(...) - ...
```

Do this for all commands.

---

## Task 4: Generate bindings

**Files:**

- Modify: `src-tauri/build.rs`
- Create: `src/lib/bindings.ts`

- [ ] **Step 1: Fill `collect_commands!` macro**

In `build.rs`, list every command:

```rust
tauri_specta::Builder::new()
    .commands(tauri_specta::collect_commands![
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
    .path(out_path)
    .export_ts()
    .expect("Failed to export TypeScript bindings");
```

- [ ] **Step 2: Build Rust to generate bindings**

Run: `cargo build` in `src-tauri`

- [ ] **Step 3: Verify `src/lib/bindings.ts` was created**

Run: `ls src/lib/bindings.ts`

---

## Task 5: Replace commands.ts with generated bindings

**Files:**

- Modify: `src/lib/commands.ts`

- [ ] **Step 1: Re-export generated commands**

```ts
export {
  fetchGameManifest,
  installGame,
  checkGameUpdate,
  verifyGame,
  launchGame,
  getInstalledGames,
  getGameInstallation,
  uninstallGame,
  getSettings,
  saveSettings,
  selectInstallFolder,
  cancelOperation,
  getAppDataDir,
  commands,
} from './bindings';

export type {
  GameManifest,
  FileEntry,
  GameInstallation,
  LauncherSettings,
  LaunchResult,
  VerificationResult,
  DownloadEvent,
  LauncherError,
} from './bindings';
```

- [ ] **Step 2: Remove old manual invoke helpers**

Delete the old `commands` object if `bindings.ts` provides `commands`.

---

## Task 6: Unify frontend domain types

**Files:**

- Modify: `src/types/index.ts`
- Modify: `src/lib/game-service.ts`
- Modify: `src/lib/download-channel.ts`
- Modify: `src/lib/cdn.ts`

- [ ] **Step 1: Remove dead `repairing` status**

```ts
export type GameStatus = 'not_installed' | 'installed' | 'updating' | 'downloading' | 'running';
```

- [ ] **Step 2: Unify `DownloadProgressSnapshot`**

In `src/lib/download-channel.ts`, export the interface:

```ts
export interface DownloadProgressSnapshot { ... }
```

In `src/lib/game-service.ts`, import it:

```ts
import type { DownloadProgressSnapshot } from './download-channel';
```

Remove the duplicate definition.

- [ ] **Step 3: Unify `formatBytes`**

In `src/lib/cdn.ts`, import from utils:

```ts
import { formatBytes } from './utils';
```

Delete the local `formatBytes` function.

---

## Task 7: Handle LauncherError in the frontend

**Files:**

- Modify: `src/lib/store.ts`

- [ ] **Step 1: Update `handleStoreError`**

```ts
interface LauncherError {
  code: string;
  details?: unknown;
}

function handleStoreError(error: unknown, set: ..., context: string): string {
  let message = 'An unexpected error occurred';
  if (error && typeof error === 'object' && 'code' in error) {
    const err = error as LauncherError;
    message = errorMessages[err.code] ?? (error as Error).message ?? String(error);
  } else if (error instanceof Error) {
    message = error.message;
  } else {
    message = String(error);
  }
  logger.error(`Store action failed: ${context}`, { error: message });
  (set as (partial: Partial<LauncherState>) => void)({ error: message });
  return message;
}

const errorMessages: Record<string, string> = {
  NotInstalled: 'Game is not installed',
  AlreadyRunning: 'Game is already running',
  ExecutableNotFound: 'Game executable not found',
  PathNotAllowed: 'Path is outside the allowed install directory',
  Network: 'Network request failed',
  ManifestParse: 'Failed to read game manifest',
  Validation: 'Invalid settings',
  Io: 'File system error',
  Other: 'An unexpected error occurred',
};
```

---

## Task 8: Add tests

**Files:**

- Modify: `src-tauri/src/types.rs` (tests)

- [ ] **Step 1: Add `LauncherError` serialization tests**

```rust
#[test]
fn test_launcher_error_serialization() {
    let err = LauncherError::NotInstalled;
    let json = serde_json::to_string(&err).unwrap();
    assert!(json.contains("NotInstalled"));

    let err = LauncherError::PathNotAllowed { path: "/bad".to_string() };
    let json = serde_json::to_string(&err).unwrap();
    assert!(json.contains("PathNotAllowed"));
    assert!(json.contains("/bad"));
}
```

- [ ] **Step 2: Update or remove `GameInfo` tests**

Delete `test_game_info_serialization`, `test_game_info_size_display`, `test_game_info_matches_search`.

---

## Task 9: Final verification

- [ ] Run `cargo build` in `src-tauri` to regenerate `bindings.ts` ✅
- [ ] Run `cargo test` in `src-tauri` ✅
- [ ] Run `cargo clippy --all-targets -- -D warnings` ✅
- [ ] Run `cargo fmt --check` ✅
- [ ] Run `npm run build` ✅
- [ ] Run `npm test` ✅
- [ ] Run `npm run lint` ✅
- [ ] Run `npm run format:check` ✅

---

## Execution choice

Plan saved to `docs/superpowers/plans/2026-07-11-phase2-type-safety-contracts-plan.md`.

**Recommended:** Inline execution in this session.
