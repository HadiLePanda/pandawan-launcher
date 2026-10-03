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

/// Validates a game id.
///
/// Rules:
/// - non-empty and at most 64 characters
/// - only ASCII alphanumeric characters, `-`, `_`, and `.`
/// - `.` and `-` are not allowed at the start or end
/// - `.` and `..` are rejected
/// - Windows reserved device names (e.g. `CON`, `COM1`) are rejected, with or
///   without an extension
pub fn validate_game_id(game_id: &str) -> Result<String, PathError> {
    if game_id.is_empty() {
        return Err(PathError::InvalidGameId("Game id is empty".to_string()));
    }
    if game_id.len() > 64 {
        return Err(PathError::InvalidGameId(format!(
            "Game id is too long ({} chars, max 64)",
            game_id.len()
        )));
    }

    if !game_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(PathError::InvalidGameId(format!(
            "Game id contains invalid characters: {}",
            game_id
        )));
    }

    if game_id == "."
        || game_id == ".."
        || game_id.starts_with('.')
        || game_id.ends_with('.')
        || game_id.starts_with('-')
        || game_id.ends_with('-')
    {
        return Err(PathError::InvalidGameId(format!(
            "Game id is unsafe: {}",
            game_id
        )));
    }

    if is_windows_reserved_name(game_id) {
        return Err(PathError::InvalidGameId(format!(
            "Game id is a Windows reserved name: {}",
            game_id
        )));
    }

    Ok(game_id.to_string())
}

/// Returns true if `name` matches a Windows reserved device name, with or
/// without an extension (e.g. `CON` or `CON.txt`).
fn is_windows_reserved_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name);
    let upper = stem.to_ascii_uppercase();

    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

/// Normalizes a slash-separated path by removing `.` and resolving `..`.
/// If `..` would escape below the root, it is kept in the result so the caller
/// can reject it.
fn normalize_path(path: &str) -> String {
    let unified = path.replace('\\', "/");
    let parts: Vec<&str> = unified.split('/').collect();
    let mut normalized: Vec<&str> = Vec::with_capacity(parts.len());

    for part in parts {
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

/// Validates that `path` is a relative path with no directory traversal.
///
/// Rejects the following forms:
/// - empty paths
/// - paths containing a null byte
/// - paths containing a colon
/// - absolute paths
/// - `.` (normalizes to an empty path)
/// - `..` and any other traversal sequences
pub fn sanitize_relative_path(path: &str) -> Result<PathBuf, PathError> {
    if path.is_empty() {
        return Err(PathError::PathNotAllowed("Empty path".to_string()));
    }
    if path.contains('\0') {
        return Err(PathError::PathNotAllowed("Null byte in path".to_string()));
    }
    if path.contains(':') {
        return Err(PathError::PathNotAllowed(format!(
            "Colons are not allowed in relative paths: {}",
            path
        )));
    }

    let as_path = Path::new(path);
    // `is_absolute` is false for a Windows root-relative path like `/foo` (it
    // has a root but no drive prefix); `has_root` catches both forms.
    if as_path.is_absolute() || as_path.has_root() {
        return Err(PathError::PathNotAllowed(format!(
            "Absolute paths are not allowed: {}",
            path
        )));
    }

    if path.split(['/', '\\']).any(|s| s == "..") {
        return Err(PathError::PathNotAllowed(format!(
            "Path contains parent directory references: {}",
            path
        )));
    }

    let normalized = normalize_path(path);
    if normalized.is_empty() {
        return Err(PathError::PathNotAllowed(format!(
            "Path normalizes to an empty path: {}",
            path
        )));
    }

    let check = Path::new(&normalized);
    for component in check.components() {
        match component {
            std::path::Component::Prefix(_)
            | std::path::Component::RootDir
            | std::path::Component::ParentDir => {
                return Err(PathError::PathNotAllowed(format!(
                    "Path escapes the allowed directory: {}",
                    path
                )));
            }
            _ => {}
        }
    }

    Ok(check.to_path_buf())
}

/// Safely joins `base` with a sanitized relative `path`.
///
/// The relative segment is sanitized by [`sanitize_relative_path`] and any `..`
/// traversal is rejected. The returned path is therefore lexically under
/// `base`. This function does not canonicalize the paths or follow symlinks; use
/// [`is_path_inside`] after the filesystem operation if symlink safety is
/// required.
pub fn safe_join(base: &Path, path: &str) -> Result<PathBuf, PathError> {
    let relative = sanitize_relative_path(path)?;
    Ok(base.join(relative))
}

fn normalize_components(path: &Path) -> Vec<std::path::Component<'_>> {
    let mut normalized: Vec<std::path::Component> = Vec::new();

    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if matches!(normalized.last(), Some(std::path::Component::Normal(_))) {
                    normalized.pop();
                } else {
                    normalized.push(component);
                }
            }
            _ => normalized.push(component),
        }
    }

    normalized
}

/// Returns true if `path` is lexically inside `root`.
///
/// Tries canonical paths first to resist symlink attacks, then falls back to
/// lexical normalization for paths that do not yet exist.
pub fn is_path_inside(path: &Path, root: &Path) -> bool {
    if let (Ok(canon_path), Ok(canon_root)) = (path.canonicalize(), root.canonicalize()) {
        return canon_path.starts_with(&canon_root);
    }

    let path_comps = normalize_components(path);
    let root_comps = normalize_components(root);

    root_comps.len() <= path_comps.len()
        && root_comps
            .iter()
            .zip(path_comps.iter())
            .all(|(a, b)| a == b)
}

/// Returns `Ok(())` if `path` is inside `root`.
pub fn assert_path_inside(path: &Path, root: &Path) -> Result<(), PathError> {
    if is_path_inside(path, root) {
        Ok(())
    } else {
        Err(PathError::PathNotAllowed(format!(
            "Path {} is outside allowed root {}",
            path.display(),
            root.display()
        )))
    }
}

/// Validates that a manifest file URL is relative and stays under `base_url`.
///
/// Returns the normalized relative path to download.
pub fn validate_download_url(base_url: &str, file_url: &str) -> Result<String, PathError> {
    if file_url.is_empty() {
        return Err(PathError::PathNotAllowed("Empty file URL".to_string()));
    }

    let base = reqwest::Url::parse(base_url)
        .map_err(|e| PathError::InvalidUrl(format!("Invalid base URL '{}': {}", base_url, e)))?;

    if !base.path().ends_with('/') {
        return Err(PathError::InvalidUrl(
            "Base URL must end with '/' to represent a directory".to_string(),
        ));
    }

    // Reject absolute file URLs (including file:// and https://).
    // Protocol-relative URLs ("//host/path") fail the absolute-URL parse without a
    // base and are rejected by the origin check below.
    if reqwest::Url::parse(file_url).is_ok() {
        return Err(PathError::PathNotAllowed(format!(
            "File URL must be relative, got absolute: {}",
            file_url
        )));
    }

    let joined = base
        .join(file_url)
        .map_err(|e| PathError::InvalidUrl(format!("Invalid file URL '{}': {}", file_url, e)))?;

    if joined.origin() != base.origin() {
        return Err(PathError::PathNotAllowed(
            "File URL points to a different origin than the manifest base URL".to_string(),
        ));
    }

    let base_segments: Vec<&str> = base.path().split('/').filter(|s| !s.is_empty()).collect();
    let joined_segments: Vec<&str> = joined.path().split('/').filter(|s| !s.is_empty()).collect();

    if joined_segments.len() < base_segments.len()
        || joined_segments
            .iter()
            .zip(base_segments.iter())
            .any(|(a, b)| a != b)
    {
        return Err(PathError::PathNotAllowed(format!(
            "File URL escapes the manifest base directory: {}",
            file_url
        )));
    }

    let relative = joined_segments[base_segments.len()..].join("/");
    let normalized = normalize_path(&relative);
    if normalized.is_empty() || normalized.starts_with("..") {
        return Err(PathError::PathNotAllowed(format!(
            "File URL escapes the manifest base directory: {}",
            file_url
        )));
    }

    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_game_id_accepts_valid_id() {
        assert_eq!(validate_game_id("my-game_v1.0").unwrap(), "my-game_v1.0");
        assert_eq!(validate_game_id("a").unwrap(), "a");
        assert_eq!(validate_game_id("A1_b-2.c").unwrap(), "A1_b-2.c");
    }

    #[test]
    fn validate_game_id_rejects_empty() {
        assert!(validate_game_id("").is_err());
    }

    #[test]
    fn validate_game_id_rejects_too_long() {
        let long = "a".repeat(65);
        assert!(validate_game_id(&long).is_err());
        assert_eq!(validate_game_id(&"a".repeat(64)).unwrap().len(), 64);
    }

    #[test]
    fn validate_game_id_rejects_invalid_chars() {
        assert!(validate_game_id("game@id").is_err());
        assert!(validate_game_id("game id").is_err());
        assert!(validate_game_id("game/id").is_err());
        assert!(validate_game_id("game\\id").is_err());
        assert!(validate_game_id("game:id").is_err());
    }

    #[test]
    fn validate_game_id_rejects_leading_or_trailing_dot_or_dash() {
        assert!(validate_game_id(".game").is_err());
        assert!(validate_game_id("game.").is_err());
        assert!(validate_game_id("-game").is_err());
        assert!(validate_game_id("game-").is_err());
    }

    #[test]
    fn validate_game_id_rejects_dot_segments() {
        assert!(validate_game_id(".").is_err());
        assert!(validate_game_id("..").is_err());
    }

    #[test]
    fn validate_game_id_rejects_windows_reserved_names() {
        for name in ["CON", "PRN", "AUX", "NUL"] {
            assert!(
                validate_game_id(name).is_err(),
                "{} should be rejected",
                name
            );
            assert!(
                validate_game_id(&format!("{}.txt", name)).is_err(),
                "{}.txt should be rejected",
                name
            );
            assert!(
                validate_game_id(&name.to_lowercase()).is_err(),
                "{} should be rejected",
                name.to_lowercase()
            );
        }
        for i in 1..=9 {
            assert!(validate_game_id(&format!("COM{}", i)).is_err());
            assert!(validate_game_id(&format!("LPT{}", i)).is_err());
            assert!(validate_game_id(&format!("com{}.", i)).is_err());
            assert!(validate_game_id(&format!("lpt{}.txt", i)).is_err());
        }
    }

    #[test]
    fn validate_game_id_accepts_similar_but_not_reserved_names() {
        assert_eq!(validate_game_id("CONFIG").unwrap(), "CONFIG");
        assert_eq!(validate_game_id("com10").unwrap(), "com10");
        assert_eq!(validate_game_id("lpt10").unwrap(), "lpt10");
        assert_eq!(validate_game_id("CONSOLE").unwrap(), "CONSOLE");
    }

    #[test]
    fn sanitize_relative_path_rejects_empty() {
        assert!(sanitize_relative_path("").is_err());
    }

    #[test]
    fn sanitize_relative_path_rejects_dot() {
        assert!(sanitize_relative_path(".").is_err());
    }

    #[test]
    fn sanitize_relative_path_rejects_dotdot() {
        assert!(sanitize_relative_path("..").is_err());
    }

    #[test]
    fn sanitize_relative_path_rejects_mixed_traversal() {
        assert!(sanitize_relative_path("foo/../bar").is_err());
        assert!(sanitize_relative_path("foo/bar/../../baz").is_err());
        assert!(sanitize_relative_path("../foo").is_err());
    }

    #[test]
    fn sanitize_relative_path_normalizes_backslashes_and_rejects_traversal() {
        assert_eq!(
            sanitize_relative_path("foo\\bar").unwrap(),
            Path::new("foo/bar")
        );
        assert!(sanitize_relative_path("foo\\..\\bar").is_err());
        assert!(sanitize_relative_path("..\\x").is_err());
    }

    #[test]
    fn sanitize_relative_path_accepts_valid_relative_path() {
        assert_eq!(
            sanitize_relative_path("data/config.json").unwrap(),
            Path::new("data/config.json")
        );
    }

    #[test]
    fn sanitize_relative_path_rejects_absolute_paths() {
        if cfg!(windows) {
            assert!(sanitize_relative_path("C:\\foo").is_err());
        }
        assert!(sanitize_relative_path("/foo/bar").is_err());
    }

    #[test]
    fn sanitize_relative_path_rejects_null_byte() {
        assert!(sanitize_relative_path("foo\0bar").is_err());
    }

    #[test]
    fn sanitize_relative_path_rejects_colon() {
        assert!(sanitize_relative_path("foo:bar").is_err());
    }

    #[test]
    fn safe_join_joins_correctly() {
        let base = Path::new("/games");
        assert_eq!(
            safe_join(base, "my-game/data.bin").unwrap(),
            Path::new("/games/my-game/data.bin")
        );
    }

    #[test]
    fn safe_join_rejects_escapes() {
        let base = Path::new("/games");
        assert!(safe_join(base, "../escape").is_err());
        assert!(safe_join(base, "game/../../escape").is_err());
        assert!(safe_join(base, "..").is_err());
    }

    #[test]
    fn is_path_inside_detects_inside_and_outside() {
        let root = std::env::temp_dir().join("pandawan-path-test-root");
        let inside = root.join("sub").join("file.txt");
        let outside = std::env::temp_dir().join("pandawan-path-test-other");

        assert!(is_path_inside(&inside, &root));
        assert!(!is_path_inside(&outside, &root));
    }

    #[test]
    fn is_path_inside_handles_nonexistent_paths() {
        let root = Path::new("/tmp/pandawan-nonexistent-root");
        let inside = root.join("sub/file.txt");
        let outside = Path::new("/tmp/pandawan-nonexistent-other");

        assert!(is_path_inside(&inside, root));
        assert!(!is_path_inside(outside, root));
    }

    #[test]
    fn validate_download_url_accepts_relative_url() {
        assert_eq!(
            validate_download_url("https://cdn.example.com/games/", "data/file.bin").unwrap(),
            "data/file.bin"
        );
    }

    #[test]
    fn validate_download_url_rejects_absolute_url() {
        assert!(validate_download_url(
            "https://cdn.example.com/games/",
            "https://evil.example.com/file.bin"
        )
        .is_err());
        assert!(
            validate_download_url("https://cdn.example.com/games/", "file:///etc/passwd").is_err()
        );
    }

    #[test]
    fn validate_download_url_rejects_origin_mismatch() {
        assert!(validate_download_url(
            "https://cdn.example.com/games/",
            "//other.example.com/file.bin"
        )
        .is_err());
    }

    #[test]
    fn validate_download_url_rejects_traversal() {
        assert!(validate_download_url("https://cdn.example.com/games/", "../secret.txt").is_err());
    }

    #[test]
    fn validate_download_url_rejects_sibling_directory_prefix() {
        assert!(
            validate_download_url("https://cdn.example.com/games/", "../games2/secret.txt")
                .is_err()
        );
    }

    #[test]
    fn validate_download_url_rejects_base_without_trailing_slash() {
        assert!(validate_download_url("https://cdn.example.com/games", "file.bin").is_err());
    }
}
