//! Guards on what may and may not end up inside the shipped launcher.
//!
//! The publishing dashboard (`scripts/dashboard.mjs`) runs R2 commands using the
//! account credentials and can delete bucket objects. It must never reach a
//! player's machine. Nothing about the current bundler setup includes it, but
//! nothing *stops* it either: a well-meaning `bundle.resources` entry, or a
//! Vite config change, would quietly ship it. These tests fail loudly instead.
//!
//! What ships is the compiled Rust binary plus `frontendDist` (`dist/`). Both are
//! checked here.

use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

fn tauri_config() -> serde_json::Value {
    let raw = std::fs::read_to_string(repo_root().join("src-tauri/tauri.conf.json"))
        .expect("tauri.conf.json is readable");
    serde_json::from_str(&raw).expect("tauri.conf.json is valid JSON")
}

/// Paths that must never be reachable from a shipped build.
const FORBIDDEN: &[&str] = &[
    "scripts",
    "src-tauri/.secrets",
    ".env",
    "src-tauri/gen",
];

#[test]
fn test_bundle_does_not_include_developer_scripts_or_secrets() {
    let bundle = &tauri_config()["bundle"];

    // `resources` is what puts arbitrary files next to the executable. It is
    // absent today, which is the safest state.
    let resources = bundle.get("resources");
    if let Some(list) = resources {
        let rendered = list.to_string();
        for forbidden in FORBIDDEN {
            assert!(
                !rendered.contains(forbidden),
                "bundle.resources references {forbidden}, which would ship it to every \
                 player. The dashboard holds R2 credentials and can delete objects, and \
                 .secrets holds the updater signing key."
            );
        }
    }
}

#[test]
fn test_frontend_dist_contains_no_developer_files() {
    let dist = repo_root().join("dist");
    // dist/ only exists after a frontend build. Skipping is correct here: this
    // guards the artifact, it does not require one to exist.
    if !dist.exists() {
        return;
    }

    let mut offenders = Vec::new();
    let mut stack = vec![dist.clone()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            let full = path.to_string_lossy().replace('\\', "/");

            // The frontend build must not carry the dashboard, any .env, or a
            // signing key, whatever the source layout does.
            let looks_like_dashboard = name == "dashboard.mjs"
                || name == "app.js" && full.contains("dashboard")
                || full.contains("/scripts/");
            let looks_secret = name == ".env" || name.ends_with(".key");
            let looks_like_key = full.contains(".secrets");

            if looks_like_dashboard || looks_secret || looks_like_key {
                offenders.push(full);
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "developer tooling or secrets would ship inside the launcher: {offenders:?}"
    );
}

#[test]
fn test_env_and_signing_keys_are_gitignored() {
    // These files hold live credentials. If they are ever un-ignored they can be
    // committed by accident, so the guard is on the ignore rules themselves.
    let raw = std::fs::read_to_string(repo_root().join(".gitignore")).expect(".gitignore exists");

    for pattern in [".env", "src-tauri/.secrets/"] {
        assert!(
            raw.lines().any(|line| line.trim() == pattern),
            ".gitignore must contain an entry for {pattern}"
        );
    }
}