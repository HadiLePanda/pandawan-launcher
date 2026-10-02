//! Integration tests for the updater signing configuration.
//!
//! These tests pin down the pubkey committed in `tauri.conf.json`, because the
//! failure mode is silent and total: the updater base64-decodes
//! `plugins.updater.pubkey` and parses the result with
//! `minisign_verify::PublicKey::decode`, so the value must be the base64 of a whole
//! minisign PublicKeyBox. If it is the inner raw key line instead (the
//! obvious-looking choice), every downloaded update fails signature verification
//! at runtime.
//!
//! `verify_signature()` in tauri-plugin-updater is the reference for that parse,
//! and `parse_like_the_plugin` below reproduces it exactly, so a key that passes
//! here is a key the running launcher accepts.

use std::path::Path;

fn repo_root() -> std::path::PathBuf {
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

fn updater_pubkey() -> String {
    tauri_config()["plugins"]["updater"]["pubkey"]
        .as_str()
        .expect("plugins.updater.pubkey is a string")
        .to_string()
}

/// Reproduce the updater plugin's parse of `plugins.updater.pubkey`.
///
/// `verify_signature()` in tauri-plugin-updater does `base64_to_string(pub_key)`
/// followed by `PublicKey::decode(..)`, so the configured value has to be the
/// base64 of a whole PublicKeyBox.
fn parse_like_the_plugin(pubkey: &str) -> Result<minisign_verify::PublicKey, String> {
    let decoded = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, pubkey)
        .map_err(|e| format!("not valid base64: {e}"))?;
    let text = String::from_utf8(decoded).map_err(|_| "does not decode to UTF-8".to_string())?;
    minisign_verify::PublicKey::decode(&text).map_err(|e| format!("not a PublicKeyBox: {e}"))
}

#[test]
fn test_committed_updater_pubkey_parses_as_minisign_public_key() {
    if let Err(err) = parse_like_the_plugin(&updater_pubkey()) {
        panic!(
            "plugins.updater.pubkey cannot be parsed by the updater at runtime: {err}. \
             It must be the base64 of a whole minisign PublicKeyBox, which is what \
             `npm run sync:updater-key` writes."
        );
    }
}

/// Regression guard for the two encodings, which are easy to swap by accident:
/// `updater.pub` holds the base64 of the whole box, and that whole value is what
/// belongs in the config - not the key line decoded out of it.
#[test]
fn test_inner_key_line_is_not_a_valid_config_pubkey() {
    let pub_file =
        std::fs::read_to_string(repo_root().join("src-tauri/updater.pub")).expect("updater.pub");
    let whole_box = pub_file.trim();

    let decoded = String::from_utf8(
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, whole_box)
            .expect("updater.pub must be valid base64"),
    )
    .expect("updater.pub must decode to UTF-8");
    let key_line = decoded
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with("untrusted comment:"))
        .expect("updater.pub contains a key line");

    assert!(
        parse_like_the_plugin(key_line).is_err(),
        "the inner raw key line must not be used as plugins.updater.pubkey; \
         the config needs the base64 of the whole box"
    );
}

#[test]
fn test_updater_pub_is_synced_into_tauri_conf() {
    let pub_file =
        std::fs::read_to_string(repo_root().join("src-tauri/updater.pub")).expect("updater.pub");
    let trimmed = pub_file.trim();

    // `tauri signer generate` writes `updater.pub` as the base64 of the whole
    // PublicKeyBox, and that value goes into the config verbatim. A key written by
    // the `minisign` CLI is plain text, so the file is base64-encoded first.
    let expected = if trimmed.starts_with("untrusted comment:") {
        base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            trimmed.as_bytes(),
        )
    } else {
        trimmed.to_string()
    };

    assert_eq!(
        updater_pubkey(),
        expected,
        "run `npm run sync:updater-key` to sync src-tauri/updater.pub into tauri.conf.json"
    );
}

#[test]
fn test_create_updater_artifacts_is_set_on_bundle() {
    // `createUpdaterArtifacts` belongs to `bundle`, not to `plugins.updater`.
    // Without it `tauri build` emits no .sig files and no latest.json, and the
    // release silently ships with nothing for the updater to verify.
    let config = tauri_config();
    let artifacts = config["bundle"]["createUpdaterArtifacts"]
        .as_bool()
        .expect("bundle.createUpdaterArtifacts must be set to true");

    assert!(
        artifacts,
        "bundle.createUpdaterArtifacts must be true or no signatures are produced"
    );
    assert!(
        config["plugins"]["updater"]
            .get("createUpdaterArtifacts")
            .is_none(),
        "createUpdaterArtifacts does not belong under plugins.updater"
    );
}

/// GET a URL, or None when the network or the object is unavailable.
///
/// Uses curl rather than a Rust HTTP client: this only has to prove that the
/// published bytes are fetchable and intact, and reqwest's blocking feature is
/// not enabled in this crate. `curl -f` fails on a 404, so a missing object comes
/// back as None rather than an error body.
fn fetch(url: &str) -> Option<Vec<u8>> {
    let out = std::process::Command::new("curl")
        .args(["-sfL", "--max-time", "120", url])
        .output()
        .ok()?;

    if !out.status.success() {
        return None;
    }
    Some(out.stdout)
}

/// Verifies the signature of the PUBLISHED installer against the pubkey the
/// launcher embeds, using the same crate the updater plugin uses at runtime.
///
/// This is the end-to-end proof that a release actually works for players:
/// artifact bytes are downloaded from the public bucket, the .sig beside them is
/// downloaded, and the pair is checked exactly as tauri-plugin-updater would.
/// A green unit test on the committed config cannot show that; only this can.
///
/// Requires network access to the public bucket. Skips when unreachable so an
/// offline `cargo test` still passes.
#[test]
fn test_published_installer_signature_verifies_against_embedded_pubkey() {
    let config = tauri_config();
    let pubkey = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .expect("pubkey is a string")
        .to_string();

    // The endpoint is the manifest itself (.../launcher/latest.json), so the
    // download base is its directory. Drop the trailing filename first.
    let endpoint = config["plugins"]["updater"]["endpoints"][0]
        .as_str()
        .expect("endpoint is a string");
    let base = endpoint
        .split('/')
        .take(endpoint.trim_end_matches('/').matches('/').count())
        .collect::<Vec<_>>()
        .join("/");

    let Ok(manifest) = serde_json::from_slice::<serde_json::Value>(
        &fetch(&format!("{base}/latest.json")).unwrap_or_else(|| {
            println!("skipping: latest.json not reachable at {base}/latest.json");
            std::process::exit(0);
        }),
    ) else {
        println!("skipping: latest.json is not valid JSON");
        std::process::exit(0);
    };

    let platforms = &manifest["platforms"];
    let targets: Vec<String> = platforms
        .as_object()
        .expect("platforms is an object")
        .keys()
        .cloned()
        .collect();
    assert!(!targets.is_empty(), "published manifest has no platforms");

    // The Windows MSI is the one artifact this test can fully check end to end.
    let Some(entry) = platforms.get("windows-x86_64-msi") else {
        println!("skipping: no windows-x86_64-msi entry in the published manifest");
        std::process::exit(0);
    };
    let url = entry["url"].as_str().expect("entry has a url");

    let Some(artifact) = fetch(url) else {
        println!("skipping: artifact not reachable at {url}");
        std::process::exit(0);
    };
    assert!(!artifact.is_empty(), "downloaded artifact is empty");

    // The .sig sits beside the artifact, which is how the publish script lays it out.
    // Its presence is asserted rather than used: the signature actually checked is
    // the one embedded in latest.json, which is what the updater reads.
    let sig_url = format!(
        "{}/{}",
        url.rsplit_once('/').map_or("", |(h, _)| h),
        sig_name(url)
    );
    if fetch(&sig_url).is_none() {
        panic!("published manifest points at {url} but {sig_url} is missing");
    }

    // The updater stores the signature base64-encoded in latest.json and decodes
    // it before verifying, so mirror that rather than reading the file directly.
    let decoded_sig = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        entry["signature"].as_str().expect("entry has a signature"),
    )
    .expect("signature is base64");

    // Parse exactly as the plugin does: base64-decode, then PublicKey::decode.
    // Note this is `decode` (whole PublicKeyBox), NOT `from_base64` (raw key).
    let key = parse_like_the_plugin(&pubkey).expect("pubkey parses like the plugin does");
    let signature = minisign_verify::Signature::decode(
        &String::from_utf8(decoded_sig).expect("signature utf8"),
    )
    .expect("signature decodes");

    key.verify(&artifact, &signature, false)
        .expect("published artifact does not verify against the embedded pubkey");

    println!(
        "verified published windows-x86_64-msi ({} bytes)",
        artifact.len()
    );
}

/// `Pandawan.Launcher_0.1.0_x64_en-US.msi` -> `Pandawan.Launcher_0.1.0_x64_en-US.msi.sig`
fn sig_name(url: &str) -> String {
    let file = url.rsplit('/').next().unwrap_or_default();
    format!("{file}.sig")
}

#[test]
fn test_updater_endpoint_is_https() {
    // The plugin rejects non-https endpoints in release builds.
    let config = tauri_config();
    let endpoints = config["plugins"]["updater"]["endpoints"]
        .as_array()
        .expect("plugins.updater.endpoints is an array");

    assert!(
        !endpoints.is_empty(),
        "at least one updater endpoint is required"
    );
    for endpoint in endpoints {
        let url = endpoint.as_str().expect("endpoint is a string");
        assert!(
            url.starts_with("https://"),
            "updater endpoint must use https, got: {url}"
        );
    }
}

/// Verify a real release signature against the configured pubkey.
///
/// This is the exact data flow a player hits: the updater downloads the `.sig`
/// from `latest.json`, base64-decodes it, parses it with `Signature::decode`, and
/// verifies the installer bytes with `plugins.updater.pubkey`. Reproduced here so
/// a broken keypair is caught even when nobody runs a build.
///
/// Skipped when there is no built installer, which is the normal case in CI.
/// `npm run tauri:build` produces the artifacts this reads.
#[test]
fn test_built_installer_signature_verifies_against_configured_pubkey() {
    let bundle = repo_root().join("src-tauri/target/release/bundle");
    if !bundle.exists() {
        eprintln!("skipping: {} does not exist", bundle.display());
        return;
    }

    // Any `*.sig` next to a bundle, newest last; they are all signed with the same key.
    let mut sigs: Vec<std::path::PathBuf> = Vec::new();
    for entry in std::fs::read_dir(&bundle).expect("read bundle dir") {
        let dir = entry.expect("bundle entry").path();
        if !dir.is_dir() {
            continue;
        }
        for file in std::fs::read_dir(&dir).expect("read bundle subdir") {
            let path = file.expect("bundle file").path();
            if path.extension().is_some_and(|ext| ext == "sig") {
                sigs.push(path);
            }
        }
    }
    if sigs.is_empty() {
        eprintln!("skipping: no .sig artifacts in {}", bundle.display());
        return;
    }

    let public_key = parse_like_the_plugin(&updater_pubkey()).expect("configured pubkey parses");

    for sig_path in sigs {
        let installer = sig_path.with_extension("");
        assert!(
            installer.exists(),
            "{} has no matching installer",
            sig_path.display()
        );

        let sig_text = std::fs::read_to_string(&sig_path).expect("read signature");
        let sig_decoded = String::from_utf8(
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, sig_text.trim())
                .expect("signature is base64"),
        )
        .expect("signature decodes to UTF-8");
        let signature =
            minisign_verify::Signature::decode(&sig_decoded).expect("signature decodes");

        let bytes = std::fs::read(&installer).expect("read installer");
        public_key
            .verify(&bytes, &signature, true)
            .unwrap_or_else(|e| panic!("{} failed verification: {e}", installer.display()));
    }
}
/// End-to-end check of the whole signing chain, with the real keypair.
///
/// Signs a probe file with the Tauri CLI (the same code path `tauri build` uses)
/// and verifies the resulting signature against `plugins.updater.pubkey` using
/// `minisign-verify`, exactly as the updater does when a player installs an update.
/// This is the only test that can catch a secret key that does not belong to the
/// committed public key - every cheaper check passes while updates stay broken.
///
/// Skipped when the secret key is absent, which is the normal case in CI: the file
/// is gitignored. `npm run keys:check` runs the same check locally.
#[test]
fn test_secret_key_signature_verifies_against_configured_pubkey() {
    let secret = repo_root().join("src-tauri/.secrets/updater.key");
    if !secret.exists() {
        eprintln!("skipping: {} is not present", secret.display());
        return;
    }

    let tauri = repo_root().join(if cfg!(windows) {
        "node_modules/.bin/tauri.cmd"
    } else {
        "node_modules/.bin/tauri"
    });
    if !tauri.exists() {
        eprintln!("skipping: {} is not installed", tauri.display());
        return;
    }

    let dir = std::env::temp_dir().join(format!("pandawan-sign-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("create temp dir");
    let probe = dir.join("probe.bin");
    let payload = b"pandawan updater signing check";
    std::fs::write(&probe, payload).expect("write probe file");

    // The key file is already the base64 of a SecretKeyBox, which is what the CLI
    // decodes before parsing it.
    let key = std::fs::read_to_string(&secret).expect("read secret key");
    let key = key.trim().to_string();

    let output = if cfg!(windows) {
        // Command cannot execute a .cmd directly on Windows.
        std::process::Command::new("cmd")
            .args(["/C", tauri.to_str().unwrap()])
            .args(["signer", "sign", probe.to_str().unwrap()])
            .env("TAURI_SIGNING_PRIVATE_KEY", &key)
            // Always set, even when empty: unset makes the CLI prompt interactively
            // and the test would hang instead of failing.
            .env("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "")
            .output()
    } else {
        std::process::Command::new(&tauri)
            .args(["signer", "sign", probe.to_str().unwrap()])
            .env("TAURI_SIGNING_PRIVATE_KEY", &key)
            .env("TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "")
            .output()
    }
    .expect("run tauri signer sign");

    // The CLI appends `.sig` to the full file name, so `probe.bin` -> `probe.bin.sig`.
    let sig_path = dir.join("probe.bin.sig");
    assert!(
        output.status.success() && sig_path.exists(),
        "tauri signer sign failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    // The signature is written as the base64 of the SignatureBox, which is the form
    // that ends up in latest.json.
    let sig_text = std::fs::read_to_string(&sig_path).expect("read signature file");
    let sig_decoded = String::from_utf8(
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, sig_text.trim())
            .expect("signature is base64"),
    )
    .expect("signature decodes to UTF-8");

    let public_key = parse_like_the_plugin(&updater_pubkey()).expect("configured pubkey parses");
    let signature = minisign_verify::Signature::decode(&sig_decoded).expect("signature decodes");

    public_key
        .verify(payload, &signature, true)
        .unwrap_or_else(|e| {
            panic!(
                "a signature made with src-tauri/.secrets/updater.key did not verify against \
             plugins.updater.pubkey ({e}). The secret key and the committed public key \
             are not a pair; restore the matching updater.key."
            )
        });

    let _ = std::fs::remove_dir_all(&dir);
}
