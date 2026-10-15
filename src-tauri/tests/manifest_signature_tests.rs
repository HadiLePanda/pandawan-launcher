//! End-to-end proof that a manifest signed by the release tooling verifies.
//!
//! A hardcoded signature would not prove this: what matters is that the bytes the
//! publisher signs are the bytes the launcher checks, through the same command. So
//! this generates a throwaway keypair with the Tauri CLI, signs a document with it,
//! and verifies that document through the launcher's own code path.
//!
//! A keypair of its own rather than the release key, because the release key is
//! gitignored and absent in CI, and a test that skips everywhere proves nothing.
//! The pinned key is covered from two sides: `src/manifest_signature.rs` asserts
//! that `updater.pub` parses with this code, and `updater_signing_tests.rs` asserts
//! that the same file is the key the updater plugin accepts.

use pandawan_launcher_lib::manifest_signature;
use pandawan_launcher_lib::types::LauncherError;
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .to_path_buf()
}

fn tauri_cli() -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "node_modules/.bin/tauri.cmd"
    } else {
        "node_modules/.bin/tauri"
    };
    let path = repo_root().join(name);
    path.exists().then_some(path)
}

fn run_tauri(cli: &Path, args: &[&str], envs: &[(&str, &str)]) -> std::process::Output {
    let mut command = if cfg!(windows) {
        // Command cannot execute a .cmd directly on Windows.
        let mut c = std::process::Command::new("cmd");
        c.arg("/C").arg(cli);
        c
    } else {
        std::process::Command::new(cli)
    };

    command.args(args);
    for (key, value) in envs {
        command.env(key, value);
    }
    command.output().expect("run the Tauri CLI")
}

/// The public key file `tauri signer generate` writes, decoded the way the launcher
/// decodes the pinned one: base64 first, then the minisign box.
fn public_key_from(file: &Path) -> minisign_verify::PublicKey {
    let raw = std::fs::read_to_string(file).expect("read the public key file");
    let decoded = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, raw.trim())
        .expect("the public key file is base64");
    let text = String::from_utf8(decoded).expect("the public key decodes to UTF-8");
    minisign_verify::PublicKey::decode(&text).expect("the public key is a minisign box")
}

#[test]
fn test_a_manifest_signed_by_the_release_tooling_verifies() {
    let Some(cli) = tauri_cli() else {
        eprintln!("skipping: the Tauri CLI is not installed");
        return;
    };

    let dir = std::env::temp_dir().join(format!("pandawan-manifest-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create the temp dir");

    // A keypair to sign with. --ci skips the interactive password prompt.
    let key_path = dir.join("manifest-test.key");
    let generated = run_tauri(
        &cli,
        &[
            "signer",
            "generate",
            "-w",
            key_path.to_str().unwrap(),
            "--ci",
        ],
        &[],
    );
    assert!(
        generated.status.success(),
        "tauri signer generate failed:\n{}\n{}",
        String::from_utf8_lossy(&generated.stdout),
        String::from_utf8_lossy(&generated.stderr)
    );

    // Sign the document, exactly as the publisher does.
    let body = br#"{"game_id":"example-game","version":"1.0.0","files":[]}"#;
    let document = dir.join("manifest.json");
    std::fs::write(&document, body).expect("write the document");
    let key = std::fs::read_to_string(&key_path).expect("read the secret key");

    let signed = run_tauri(
        &cli,
        &["signer", "sign", document.to_str().unwrap()],
        &[
            ("TAURI_SIGNING_PRIVATE_KEY", key.trim()),
            // Always set, even empty: unset makes the CLI prompt and this test
            // would hang instead of failing.
            ("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", ""),
        ],
    );
    assert!(
        signed.status.success(),
        "tauri signer sign failed:\n{}\n{}",
        String::from_utf8_lossy(&signed.stdout),
        String::from_utf8_lossy(&signed.stderr)
    );

    // The CLI appends .sig to the whole file name.
    let signature =
        std::fs::read_to_string(dir.join("manifest.json.sig")).expect("read the signature");
    let public_key = public_key_from(&dir.join("manifest-test.key.pub"));

    manifest_signature::verify_with(&public_key, body, &signature)
        .expect("a signature the publisher wrote must verify");

    // The check is only worth having if it refuses a document changed after
    // signing: one byte in a hash or a URL is the whole attack.
    let tampered = br#"{"game_id":"example-game","version":"9.9.9","files":[]}"#;
    let refused = manifest_signature::verify_with(&public_key, tampered, &signature)
        .expect_err("a tampered document must be refused");
    assert!(
        matches!(refused, LauncherError::ManifestUnsigned(_)),
        "expected a signature error, got {refused:?}"
    );

    // And a signature from another keypair, which is what an attacker who can write
    // to the bucket would have to produce.
    let other_key = dir.join("other.key");
    let generated = run_tauri(
        &cli,
        &[
            "signer",
            "generate",
            "-w",
            other_key.to_str().unwrap(),
            "--ci",
        ],
        &[],
    );
    assert!(generated.status.success(), "second keypair generated");
    let other = std::fs::read_to_string(&other_key).expect("read the other key");
    let signed = run_tauri(
        &cli,
        &["signer", "sign", document.to_str().unwrap()],
        &[
            ("TAURI_SIGNING_PRIVATE_KEY", other.trim()),
            ("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", ""),
        ],
    );
    assert!(signed.status.success(), "signed with the other key");
    let foreign = std::fs::read_to_string(dir.join("manifest.json.sig")).expect("read signature");

    let refused = manifest_signature::verify_with(&public_key, body, &foreign)
        .expect_err("a signature from another key must be refused");
    assert!(
        matches!(refused, LauncherError::ManifestUnsigned(_)),
        "expected a signature error, got {refused:?}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
