# Phase 2 — Type Safety + IPC Contracts

**Date:** 2026-07-11  
**Scope:** Generate TypeScript bindings from Rust with tauri-specta, replace string errors with structured errors, and unify duplicated domain types/helpers.

## Goals

1. Make Rust the single source of truth for IPC types and command signatures.
2. Replace `Result<T, String>` with a typed `LauncherError` the frontend can handle by code.
3. Remove dead/duplicated domain concepts that create drift.

## Non-goals

- Store split / architecture refactors
- Persistent logging / crash reporting
- Code signing / e2e tests
- CDN allowlist (Phase 3)

## Architecture

### Generated bindings

- Add `tauri-specta` (features `javascript`, `typescript`) and `specta` (feature `derive`) to `src-tauri/Cargo.toml`.
- Derive `specta::Type` on every type that crosses the IPC boundary:
  - `GameManifest`, `FileEntry`
  - `GameInstallation`
  - `LauncherSettings`
  - `LaunchResult`, `GameExitedPayload`
  - `VerificationResult`
  - `DownloadEvent`
  - `LauncherError`
- Mark every `#[tauri::command]` with `#[specta::specta]`.
- In `src-tauri/build.rs`, collect commands and export TypeScript to `src/lib/bindings.ts`.
- Replace `src/lib/commands.ts` with re-exports from `bindings.ts`.

### Structured errors

```rust
#[derive(Debug, thiserror::Error, Serialize, specta::Type)]
pub enum LauncherError {
    #[error("Game is not installed")]
    NotInstalled,
    #[error("Game is already running")]
    AlreadyRunning,
    #[error("Executable not found: {path}")]
    ExecutableNotFound { path: String },
    #[error("Path is outside allowed root")]
    PathNotAllowed { path: String },
    #[error("Network request failed: {0}")]
    Network(String),
    #[error("Failed to parse manifest: {0}")]
    ManifestParse(String),
    #[error("Invalid settings: {0}")]
    Validation(String),
    #[error("IO error: {0}")]
    Io(String),
    #[error("{0}")]
    Other(String),
}
```

All commands return `Result<T, LauncherError>`. Tauri serializes the enum to a JSON object; the generated TypeScript bindings include the discriminated union.

### Unified domain types

- Delete Rust `GameInfo` (it is not used over IPC; keeping it risks drift).
- Remove `'repairing'` from TypeScript `GameStatus`.
- Delete duplicated `formatBytes` in `src/lib/cdn.ts`; import from `src/lib/utils.ts`.
- Move `DownloadProgressSnapshot` to `src/lib/download-channel.ts` and import it from `src/lib/game-service.ts`.

## Error handling

- Frontend `handleStoreError` extracts `LauncherError.code` and maps to a message.
- Unknown errors fall back to the raw message.

## Testing

- Rust: serialization round-trip for `LauncherError` variants.
- Rust: ensure `GameInfo` removal does not break remaining tests.
- Frontend: update any tests referencing `'repairing'`.
- Full CI suite must remain green.

## Risks

- tauri-specta versions must be pinned to compatible stable releases.
- Build script generation means `src/lib/bindings.ts` must be checked in or regenerated in CI.
- Changing error shape affects user-facing messages; map codes carefully.
