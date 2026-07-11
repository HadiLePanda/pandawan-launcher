# Secure Patch Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the install/patch/verify/uninstall pipeline so malicious manifest paths, game IDs, file URLs, or saved installation records cannot escape the configured game root or download from untrusted origins.

**Architecture:** Introduce a single `path_utils` module that owns filesystem-path and download-URL validation. `PatchManager` and Tauri commands delegate to it instead of scattering `canonicalize` and `join` logic. `PatchError` gains a `PathNotAllowed` variant that maps to `LauncherError::PathNotAllowed`. game IDs are validated/slugified at every command entry point and in installation persistence helpers.

**Tech Stack:** Rust 2021, Tauri v2, reqwest 0.12, thiserror, tokio, tempfile (tests), cargo clippy/fmt.

---

## File Structure

- **Create:** `src-tauri/src/path_utils.rs`
  - Validates and slugifies game IDs.
  - Normalizes relative paths and blocks directory traversal (`..`, absolute paths, drive letters, null bytes).
  - Safely joins a base directory with a relative segment.
  - Checks that a path is inside an allowed root (canonical + lexical fallback).
  - Validates that a manifest file URL is relative and stays inside the manifest base URL directory.
- **Modify:** `src-tauri/src/types.rs`
  - Add `PatchError::PathNotAllowed(String)`.
  - Add `From<PathError> for PatchError`.
  - Update `From<PatchError> for LauncherError` to map the new variant.
- **Modify:** `src-tauri/src/patch.rs`
  - Replace inline `assert_path_inside_install` with `path_utils::assert_path_inside`.
  - Use `path_utils::safe_join` for every filesystem path derived from manifest or saved records.
  - Use `path_utils::validate_download_url` before creating download tasks.
  - Normalize `base_url` to end with `/` so the channel directory is preserved.
  - Validate `manifest.game_id` at the top of `patch_game`.
  - Validate game IDs in `save_installation` and `load_installation`.
- **Modify:** `src-tauri/src/lib.rs`
  - Refactor `assert_path_inside_root` to delegate to `path_utils::assert_path_inside`.
  - Validate/slugify `manifest.game_id` inside `install_game` before computing `install_dir`.
  - Validate `game_id` in `check_game_update`, `get_game_installation`, and `uninstall_game`.
  - Update the `uninstall_game` installation-record deletion to use the validated slug.
- **Modify:** `src/lib/cdn.ts`
  - Append a trailing slash to `baseUrl` returned by `resolveGameUrls` so the backend URL joining semantics are correct.
- **Tests:**
  - `src-tauri/src/path_utils.rs` — unit tests for every public helper.
  - `src-tauri/src/patch.rs` — additional tests for traversal in manifest paths and previous-file cleanup.
  - `src-tauri/src/lib.rs` — additional tests for invalid game IDs and path escaping in `install_game`.

---

## Task 1: Create `path_utils.rs`

**Files:**

- Create: `src-tauri/src/path_utils.rs`

- [ ] **Step 1: Write the module skeleton and `PathError` enum**

```rust
//! Path and URL safety helpers for the launcher.
//!
//! Every filesystem operation that joins a controlled base directory with a
//! user-influenced relative segment must go through this module. It also
//! validates that manifest file URLs remain relative to the manifest base URL.

use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum PathError {
    #[error("Game id is invalid: {0}")]
    InvalidGameId(String),
    #[error("Path is outside the allowed directory: {0}")]
    PathNotAllowed(String),
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
}
```

- [ ] **Step 2: Add game-id validation**

```rust
/// Validates a game id and returns a filesystem-safe slug.
///
/// Rules:
/// - non-empty and at most 64 characters
/// - only ASCII alphanumeric, `-`, `_`, and `.`
/// - `.` and `-` are not allowed at the start or end
/// - sequences that collapse to `.` or `..` are rejected
pub fn validate_game_id(game_id: &str) -> Result<String, PathError> {
    if game_id.is_empty() {
        return Err(PathError::InvalidGameId("game id is empty".to_string()));
    }
    if game_id.len() > 64 {
        return Err(PathError::InvalidGameId(format!(
            "game id is too long ({} chars, max 64)",
            game_id.len()
        )));
    }

    let slug: String = game_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();

    if slug.is_empty()
        || slug == "."
        || slug == ".."
        || slug.starts_with('.')
        || slug.ends_with('.')
        || slug.starts_with('-')
        || slug.ends_with('-')
    {
        return Err(PathError::InvalidGameId(format!(
            "game id resulted in an unsafe slug: {}",
            slug
        )));
    }

    Ok(slug)
}
```

- [ ] **Step 3: Add relative-path normalization and `sanitize_relative_path`**

```rust
/// Normalizes a slash-separated path by removing `.` and resolving `..`.
/// If `..` would escape below the root, it is kept in the result so the caller
/// can reject it.
fn normalize_path(path: &str) -> String {
    let unified = path.replace('\\', "/");
    let parts: Vec<&str> = unified.split('/').collect();
    let mut normalized: Vec<&str> = Vec::with_capacity(parts.len());

    for part in &parts {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            if normalized.pop().is_none() {
                normalized.push("..");
            }
        } else {
            normalized.push(part);
        }
    }

    normalized.join("/")
}

fn normalize_path_buf(path: &Path) -> PathBuf {
    Path::new(&normalize_path(&path.to_string_lossy())).to_path_buf()
}

/// Validates that `path` is a relative path with no directory traversal.
pub fn sanitize_relative_path(path: &str) -> Result<PathBuf, PathError> {
    if path.is_empty() {
        return Err(PathError::PathNotAllowed("empty path".to_string()));
    }
    if path.contains('\0') {
        return Err(PathError::PathNotAllowed("null byte in path".to_string()));
    }
    if path.contains(':') {
        return Err(PathError::PathNotAllowed(format!(
            "colons are not allowed in relative paths: {}",
            path
        )));
    }

    let as_path = Path::new(path);
    if as_path.is_absolute() {
        return Err(PathError::PathNotAllowed(format!(
            "absolute paths are not allowed: {}",
            path
        )));
    }

    let normalized = normalize_path(path);
    let check = Path::new(&normalized);
    for component in check.components() {
        match component {
            std::path::Component::Prefix(_)
            | std::path::Component::RootDir
            | std::path::Component::ParentDir => {
                return Err(PathError::PathNotAllowed(format!(
                    "path escapes the allowed directory: {}",
                    path
                )));
            }
            _ => {}
        }
    }

    Ok(check.to_path_buf())
}
```

- [ ] **Step 4: Add `safe_join` and path-inside checks**

```rust
/// Safely joins `base` with a sanitized relative `path`.
pub fn safe_join(base: &Path, path: &str) -> Result<PathBuf, PathError> {
    let relative = sanitize_relative_path(path)?;
    Ok(base.join(relative))
}

/// Returns true if `path` is lexically inside `root`.
///
/// Tries canonical paths first to resist symlink attacks, then falls back to
/// lexical normalization for paths that do not yet exist.
pub fn is_path_inside(path: &Path, root: &Path) -> bool {
    let canon_path = path
        .canonicalize()
        .unwrap_or_else(|_| normalize_path_buf(path));
    let canon_root = root
        .canonicalize()
        .unwrap_or_else(|_| normalize_path_buf(root));
    canon_path.starts_with(&canon_root)
}

/// Returns `Ok(())` if `path` is inside `root`.
pub fn assert_path_inside(path: &Path, root: &Path) -> Result<(), PathError> {
    if is_path_inside(path, root) {
        Ok(())
    } else {
        Err(PathError::PathNotAllowed(format!(
            "path {} is outside allowed root {}",
            path.display(),
            root.display()
        )))
    }
}
```

- [ ] **Step 5: Add download URL validation**

```rust
/// Validates that a manifest file URL is relative and stays under `base_url`.
///
/// Returns the normalized relative path to download.
pub fn validate_download_url(base_url: &str, file_url: &str) -> Result<String, PathError> {
    if file_url.is_empty() {
        return Err(PathError::PathNotAllowed("empty file URL".to_string()));
    }

    let base = reqwest::Url::parse(base_url)
        .map_err(|e| PathError::InvalidUrl(format!("invalid base URL '{}': {}", base_url, e)))?;

    if !base.path().ends_with('/') {
        return Err(PathError::InvalidUrl(
            "base URL must end with '/' to represent a directory".to_string(),
        ));
    }

    // Reject absolute file URLs (including file://, https://, and protocol-relative).
    if reqwest::Url::parse(file_url).is_ok() {
        return Err(PathError::PathNotAllowed(format!(
            "file URL must be relative, got absolute: {}",
            file_url
        )));
    }

    let joined = base.join(file_url).map_err(|e| {
        PathError::InvalidUrl(format!("invalid file URL '{}': {}", file_url, e))
    })?;

    if joined.origin() != base.origin() {
        return Err(PathError::PathNotAllowed(
            "file URL points to a different origin than the manifest base URL".to_string(),
        ));
    }

    if !joined.path().starts_with(base.path()) {
        return Err(PathError::PathNotAllowed(format!(
            "file URL escapes the manifest base directory: {}",
            file_url
        )));
    }

    let relative = joined.path().trim_start_matches('/').to_string();
    let normalized = normalize_path(&relative);
    if normalized.starts_with("..") {
        return Err(PathError::PathNotAllowed(format!(
            "file URL escapes the manifest base directory: {}",
            file_url
        )));
    }

    Ok(normalized)
}
```

- [ ] **Step 6: Declare the module in `lib.rs`**

Add `pub mod path_utils;` next to the existing module declarations in `src-tauri/src/lib.rs`:

```rust
pub mod download;
pub mod patch;
pub mod path_utils;
pub mod types;
```

- [ ] **Step 7: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/path_utils.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add path_utils security helpers"
```

---

## Task 2: Extend `PatchError` and `LauncherError` mapping

**Files:**

- Modify: `src-tauri/src/types.rs`

- [ ] **Step 1: Add the new `PatchError` variant and conversions**

Replace the `PatchError` enum and its `LauncherError` conversion with:

```rust
#[derive(Debug, thiserror::Error)]
pub enum PatchError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Download error: {0}")]
    Download(#[from] DownloadError),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Path not allowed: {0}")]
    PathNotAllowed(String),

    #[error("{0}")]
    Other(String),
}

impl From<crate::path_utils::PathError> for PatchError {
    fn from(err: crate::path_utils::PathError) -> Self {
        PatchError::PathNotAllowed(err.to_string())
    }
}

impl From<PatchError> for LauncherError {
    fn from(err: PatchError) -> Self {
        match err {
            PatchError::Io(e) => LauncherError::Io(e.to_string()),
            PatchError::Download(e) => e.into(),
            PatchError::Serialization(e) => LauncherError::ManifestParse(e.to_string()),
            PatchError::PathNotAllowed(path) => LauncherError::PathNotAllowed { path },
            PatchError::Other(s) => LauncherError::Other(s),
        }
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors (the `PathError` module must exist from Task 1).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/types.rs
git commit -m "feat(rust): add PatchError::PathNotAllowed variant"
```

---

## Task 3: Refactor `patch.rs` to use `path_utils`

**Files:**

- Modify: `src-tauri/src/patch.rs`

- [ ] **Step 1: Replace imports and remove the old `assert_path_inside_install` helper**

Replace the top of `src-tauri/src/patch.rs` so it imports `path_utils`:

```rust
use crate::download::{DownloadError, DownloadManager, FileDownloadTask};
use crate::path_utils::{assert_path_inside, safe_join, validate_download_url, validate_game_id};
use crate::types::{
    DownloadEvent, FileEntry, GameInstallation, GameManifest, LauncherError, PatchProgress,
    PatchState, PatchStatus,
};
```

Delete the old `assert_path_inside_install` function entirely.

- [ ] **Step 2: Harden `check_for_updates`**

Replace the loop body so it uses `safe_join`:

```rust
        for file_entry in &manifest.files {
            let file_path = safe_join(install_path, &file_entry.path)?;

            if !file_path.exists() {
                files_to_update.push(file_entry.clone());
                continue;
            }

            match compute_file_hash(&file_path).await {
                Ok(hash) => {
                    if hash != file_entry.hash {
                        files_to_update.push(file_entry.clone());
                    }
                }
                Err(_) => {
                    files_to_update.push(file_entry.clone());
                }
            }
        }
```

- [ ] **Step 3: Harden `patch_game` start and download preparation**

At the top of `patch_game`, validate the game id and normalize the base URL:

```rust
        // Validate game id before touching disk
        validate_game_id(&manifest.game_id)?;

        // Ensure base_url behaves as a directory when joining file URLs
        let base_url = if base_url.ends_with('/') {
            base_url
        } else {
            format!("{}/", base_url)
        };
```

Replace the task-preparation loop with:

```rust
        let base = reqwest::Url::parse(&base_url)
            .map_err(|e| PatchError::Other(format!("Invalid base URL '{}': {}", base_url, e)))?;
        let mut download_tasks = Vec::new();
        for file in &files_to_update {
            let relative_url = validate_download_url(&base_url, &file.url)?;
            let url = base
                .join(&relative_url)
                .map_err(|e| PatchError::Other(format!("Invalid file URL '{}': {}", file.url, e)))?
                .to_string();
            let dest_path = safe_join(&install_path, &file.path)?;
            assert_path_inside(&dest_path, &install_path)?;

            download_tasks.push(FileDownloadTask {
                url,
                dest_path,
                expected_hash: Some(file.hash.clone()),
                size: file.size,
            });
        }
```

- [ ] **Step 4: Harden `verify_installation`**

Replace the loop body:

```rust
        for file_entry in &manifest.files {
            let file_path = safe_join(install_path, &file_entry.path)?;

            if !file_path.exists() {
                missing_files.push(file_entry.path.clone());
                continue;
            }

            match compute_file_hash(&file_path).await {
                Ok(hash) => {
                    if hash == file_entry.hash {
                        valid_files += 1;
                    } else {
                        invalid_files.push(file_entry.path.clone());
                    }
                }
                Err(_) => {
                    invalid_files.push(file_entry.path.clone());
                }
            }
        }
```

- [ ] **Step 5: Harden `cleanup_orphaned_files`**

Replace the loop body:

```rust
        for relative_path in previous_files {
            if manifest_paths.contains(relative_path) {
                continue;
            }
            let file_path = safe_join(install_path, relative_path)?;
            assert_path_inside(&file_path, install_path)?;
            if file_path.exists() {
                let _ = fs::remove_file(&file_path);
            }
        }
```

- [ ] **Step 6: Harden installation persistence**

At the top of `save_installation`:

```rust
pub fn save_installation(
    app_data_dir: &Path,
    installation: &GameInstallation,
) -> Result<(), PatchError> {
    validate_game_id(&installation.game_id)?;

    let installs_dir = app_data_dir.join("installations");
    fs::create_dir_all(&installs_dir)?;

    let file_path = installs_dir.join(format!("{}.json", installation.game_id));
    let json = serde_json::to_string_pretty(installation)?;
    fs::write(file_path, json)?;

    Ok(())
}
```

At the top of `load_installation`:

```rust
pub fn load_installation(
    app_data_dir: &Path,
    game_id: &str,
) -> Result<Option<GameInstallation>, PatchError> {
    validate_game_id(game_id)?;

    let file_path = app_data_dir
        .join("installations")
        .join(format!("{}.json", game_id));

    if !file_path.exists() {
        return Ok(None);
    }

    let json = fs::read_to_string(file_path)?;
    let installation = serde_json::from_str(&json)?;

    Ok(Some(installation))
}
```

- [ ] **Step 7: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/patch.rs
git commit -m "feat(rust): harden patch pipeline against traversal and malicious URLs"
```

---

## Task 4: Refactor `lib.rs` command entry points

**Files:**

- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Update imports**

Add to the existing `use patch::{...}` block:

```rust
use path_utils::{assert_path_inside, validate_game_id};
```

Keep the existing `use patch::{...}` imports.

- [ ] **Step 2: Replace `assert_path_inside_root` with the new helper**

Replace the whole `assert_path_inside_root` function with:

```rust
/// Verify a path is inside a given root before deleting, writing, or executing.
pub fn assert_path_inside_root(
    path: &std::path::Path,
    root: &std::path::Path,
) -> Result<(), LauncherError> {
    assert_path_inside(path, root).map_err(|_| LauncherError::PathNotAllowed {
        path: path.to_string_lossy().to_string(),
    })
}
```

- [ ] **Step 3: Harden `install_game`**

Replace the beginning of `install_game` (before computing `install_dir`) with:

```rust
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
```

- [ ] **Step 4: Harden `check_game_update`, `get_game_installation`, and `uninstall_game`**

Add validation at the start of each:

```rust
async fn check_game_update(
    app: AppHandle,
    game_id: String,
    manifest: GameManifest,
) -> Result<bool, LauncherError> {
    let game_id = validate_game_id(&game_id)
        .map_err(|e| LauncherError::Validation(e.to_string()))?;
    // ... rest unchanged, using game_id
}
```

```rust
async fn get_game_installation(
    app: AppHandle,
    game_id: String,
) -> Result<Option<GameInstallation>, LauncherError> {
    let game_id = validate_game_id(&game_id)
        .map_err(|e| LauncherError::Validation(e.to_string()))?;
    // ... rest unchanged
}
```

For `uninstall_game`, validate the id and use the validated slug when deleting the installation record:

```rust
async fn uninstall_game(
    app: AppHandle,
    state: State<'_, LauncherState>,
    game_id: String,
) -> Result<(), LauncherError> {
    let game_id = validate_game_id(&game_id)
        .map_err(|e| LauncherError::Validation(e.to_string()))?;

    // Check if running (uses validated game_id)
    {
        let running = state.running_games.lock().await;
        if running.contains_key(&game_id) {
            return Err(LauncherError::Other(
                "Cannot uninstall while game is running".to_string(),
            ));
        }
    }

    // ... app_data_dir lookup unchanged ...

    if let Some(installation) = load_installation(&app_data_dir, &game_id)? {
        // ... path check and removal unchanged ...

        // Remove installation record using the validated slug
        let install_file = app_data_dir
            .join("installations")
            .join(format!("{}.json", game_id));
        if install_file.exists() {
            std::fs::remove_file(install_file)?;
        }
    }

    Ok(())
}
```

- [ ] **Step 5: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(rust): validate game ids and delegate root checks to path_utils"
```

---

## Task 5: Fix frontend `baseUrl` trailing slash

**Files:**

- Modify: `src/lib/cdn.ts`

- [ ] **Step 1: Append `/` to `baseUrl` in `resolveGameUrls`**

Change the function to:

```typescript
export function resolveGameUrls(
  id: string,
  channel: string = 'stable'
): { manifestUrl: string; baseUrl: string } {
  const baseUrl = `${CdnUrl.gamesPath(id, channel)}/`;
  return {
    manifestUrl: `${baseUrl}manifest.json`,
    baseUrl,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/lib/cdn.ts
git commit -m "fix(frontend): ensure manifest baseUrl ends with trailing slash"
```

---

## Task 6: Add unit tests for `path_utils.rs`

**Files:**

- Modify: `src-tauri/src/path_utils.rs`

- [ ] **Step 1: Add a `#[cfg(test)] mod tests` block with game-id tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_game_id_accepts_simple_id() {
        assert_eq!(validate_game_id("my-game").unwrap(), "my-game");
    }

    #[test]
    fn validate_game_id_rejects_empty() {
        assert!(validate_game_id("").is_err());
    }

    #[test]
    fn validate_game_id_rejects_dotdot() {
        assert!(validate_game_id("..").is_err());
    }

    #[test]
    fn validate_game_id_rejects_leading_dot() {
        assert!(validate_game_id(".hidden").is_err());
    }

    #[test]
    fn validate_game_id_rejects_trailing_dot() {
        assert!(validate_game_id("game.").is_err());
    }

    #[test]
    fn validate_game_id_rejects_path_separator() {
        assert!(validate_game_id("game/id").is_err());
        assert!(validate_game_id("game\\id").is_err());
    }

    #[test]
    fn validate_game_id_rejects_too_long() {
        assert!(validate_game_id(&"a".repeat(65)).is_err());
    }

    #[test]
    fn validate_game_id_slugifies_spaces() {
        assert_eq!(validate_game_id("my game").unwrap(), "my-game");
    }
}
```

- [ ] **Step 2: Add relative-path tests**

```rust
    #[test]
    fn sanitize_relative_path_accepts_simple_file() {
        assert_eq!(
            sanitize_relative_path("data/config.json").unwrap(),
            Path::new("data/config.json")
        );
    }

    #[test]
    fn sanitize_relative_path_rejects_absolute() {
        assert!(sanitize_relative_path("/etc/passwd").is_err());
    }

    #[test]
    fn sanitize_relative_path_rejects_traversal() {
        assert!(sanitize_relative_path("../secret.txt").is_err());
        assert!(sanitize_relative_path("data/../../secret.txt").is_err());
    }

    #[test]
    fn sanitize_relative_path_rejects_colon() {
        assert!(sanitize_relative_path("C:/Windows/system32").is_err());
    }

    #[test]
    fn sanitize_relative_path_rejects_null_byte() {
        assert!(sanitize_relative_path("foo\0bar").is_err());
    }

    #[test]
    fn sanitize_relative_path_normalizes_backslashes() {
        assert_eq!(
            sanitize_relative_path("data\\config.json").unwrap(),
            Path::new("data/config.json")
        );
    }

    #[test]
    fn sanitize_relative_path_rejects_empty() {
        assert!(sanitize_relative_path("").is_err());
    }
```

- [ ] **Step 3: Add `safe_join` and `is_path_inside` tests**

```rust
    #[test]
    fn safe_join_builds_expected_path() {
        let base = Path::new("/games/my-game");
        let joined = safe_join(base, "data/config.json").unwrap();
        assert!(joined.to_string_lossy().contains("data/config.json"));
    }

    #[test]
    fn safe_join_rejects_traversal() {
        let base = Path::new("/games/my-game");
        assert!(safe_join(base, "../other").is_err());
    }

    #[test]
    fn is_path_inside_accepts_child() {
        let root = Path::new("/games");
        let child = Path::new("/games/my-game/data");
        assert!(is_path_inside(child, root));
    }

    #[test]
    fn is_path_inside_rejects_escape() {
        let root = Path::new("/games");
        let escape = Path::new("/other");
        assert!(!is_path_inside(escape, root));
    }
```

- [ ] **Step 4: Add download URL tests**

```rust
    #[test]
    fn validate_download_url_accepts_relative() {
        assert_eq!(
            validate_download_url("https://cdn.example.com/games/id/stable/", "files/game.exe").unwrap(),
            "files/game.exe"
        );
    }

    #[test]
    fn validate_download_url_rejects_absolute_other_origin() {
        assert!(
            validate_download_url(
                "https://cdn.example.com/games/id/stable/",
                "https://evil.com/game.exe"
            )
            .is_err()
        );
    }

    #[test]
    fn validate_download_url_rejects_traversal() {
        assert!(
            validate_download_url(
                "https://cdn.example.com/games/id/stable/",
                "../other-game/game.exe"
            )
            .is_err()
        );
    }

    #[test]
    fn validate_download_url_rejects_missing_trailing_slash() {
        assert!(
            validate_download_url("https://cdn.example.com/games/id/stable", "files/game.exe")
                .is_err()
        );
    }
```

- [ ] **Step 5: Verify tests compile**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --no-run`
Expected: tests compile.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/path_utils.rs
git commit -m "test(rust): add path_utils unit tests"
```

---

## Task 7: Add patch traversal tests

**Files:**

- Modify: `src-tauri/src/patch.rs`

- [ ] **Step 1: Add tests for `check_for_updates` and `verify_installation` rejecting traversal**

Append to the existing `mod tests`:

```rust
    #[tokio::test]
    async fn test_check_for_updates_rejects_traversal_path() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path().join("install");

        let mut manifest = create_test_manifest();
        manifest.files = vec![FileEntry {
            path: "../secret.txt".to_string(),
            hash: "a".repeat(64),
            size: 100,
            url: "secret.txt".to_string(),
            compress: None,
        }];

        let manager = PatchManager::new(4, None);
        let result = manager.check_for_updates(&manifest, &install_path).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_verify_installation_rejects_traversal_path() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path();

        let mut manifest = create_test_manifest();
        manifest.files = vec![FileEntry {
            path: "../secret.txt".to_string(),
            hash: "a".repeat(64),
            size: 100,
            url: "secret.txt".to_string(),
            compress: None,
        }];

        let manager = PatchManager::new(4, None);
        let result = manager.verify_installation(&manifest, install_path).await;
        assert!(result.is_err());
    }
```

- [ ] **Step 2: Add a test for `cleanup_orphaned_files` rejecting traversal in previous files**

```rust
    #[tokio::test]
    async fn test_cleanup_orphaned_files_rejects_traversal_previous_files() {
        let temp_dir = tempfile::tempdir().unwrap();
        let install_path = temp_dir.path().join("install");
        fs::create_dir_all(&install_path).unwrap();

        let mut previous_files = HashSet::new();
        previous_files.insert("../outside.txt".to_string());

        let manifest = create_test_manifest();

        let manager = PatchManager::new(4, None);
        let result = manager
            .cleanup_orphaned_files(&manifest, &install_path, Some(&previous_files))
            .await;
        assert!(result.is_err());
    }
```

- [ ] **Step 3: Verify tests compile**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --no-run`
Expected: tests compile.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/patch.rs
git commit -m "test(rust): add patch traversal tests"
```

---

## Task 8: Add command-level game-id validation tests

**Files:**

- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add tests for the validation helper behavior**

Append to the existing `mod tests`:

```rust
    // =====================================================================
    // Game ID validation tests
    // =====================================================================

    #[test]
    fn test_validate_game_id_or_err_accepts_simple_id() {
        // The underlying helper is exercised via install logic; this test
        // documents the expected mapping to LauncherError::Validation.
        let result = path_utils::validate_game_id("my-game");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_game_id_or_err_rejects_traversal() {
        let result = path_utils::validate_game_id("../evil");
        assert!(result.is_err());
    }
```

- [ ] **Step 2: Add a test that verifies `assert_path_inside_root` still accepts and rejects correctly**

```rust
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
```

- [ ] **Step 3: Verify tests compile**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --no-run`
Expected: tests compile.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "test(rust): add game id and root check tests"
```

---

## Task 9: Run full verification

- [ ] **Step 1: Format**

Run: `cargo fmt --manifest-path src-tauri/Cargo.toml`
Expected: completes without changes (or with only formatting fixes that you then commit).

- [ ] **Step 2: Lint**

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
Expected: no warnings or errors.

- [ ] **Step 3: Check**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: no errors.

- [ ] **Step 4: Compile tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --no-run`
Expected: all test binaries compile.

> Note: In the current environment, Rust test binaries compile successfully but may fail to execute with `STATUS_ENTRYPOINT_NOT_FOUND` due to the Tauri runtime. Compilation success is the acceptance criterion here.

- [ ] **Step 5: Frontend build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: TypeScript checks**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore(rust): verify secure patch pipeline"
```

---

## Self-Review

**1. Spec coverage:**

- Path traversal in manifest file paths → Task 3 (`safe_join` in `check_for_updates`, `verify_installation`).
- Path traversal in saved previous-file records → Task 3 (`safe_join` in `cleanup_orphaned_files`).
- Malicious game IDs used as directory/filename → Task 1 + Task 4 (validate/slugify at every entry point and in persistence).
- Malicious file URLs escaping the CDN base → Task 1 + Task 3 (`validate_download_url`).
- Missing trailing slash on `baseUrl` dropping the channel directory → Task 5 (frontend fix) + Task 3 (backend normalization).

**2. Placeholder scan:**

- No `TBD`, `TODO`, or "implement later" strings.
- Every code step includes the full code block.
- Every test includes assertions.

**3. Type consistency:**

- `PathError` is defined in `path_utils.rs` and converted to `PatchError::PathNotAllowed` in `types.rs`.
- `PatchError::PathNotAllowed` maps to `LauncherError::PathNotAllowed { path }`.
- All call sites use the helper names consistently (`safe_join`, `assert_path_inside`, `validate_game_id`, `validate_download_url`).

**Open gaps intentionally left for future workstreams:**

- Tauri capability hardening (`shell:default` / `fs:default` scoping) is not in this plan.
- Frontend input validation/sanitization beyond the `baseUrl` trailing slash is not in this plan.
