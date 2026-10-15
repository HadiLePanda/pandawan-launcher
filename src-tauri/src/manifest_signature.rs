//! Verification of the signature a published manifest carries.
//!
//! The manifest lists each file's SHA256, so it decides what gets installed: unsigned,
//! anyone who can write to the bucket can publish a build whose hashes match the files
//! they planted.

use crate::types::LauncherError;
use base64::Engine;
use minisign_verify::{PublicKey, Signature};

/// The key this build trusts, from `src-tauri/updater.pub`: the base64 of a whole minisign
/// PublicKeyBox, the form the Tauri CLI writes.
const PUBLIC_KEY_BOX: &str = include_str!("../updater.pub");

/// Verify `body` against the signature box published beside it.
pub fn verify(body: &[u8], signature_box: &str) -> Result<(), LauncherError> {
    let public_key = pinned_public_key()?;
    verify_with(&public_key, body, signature_box)
}

/// Verify against a caller-supplied key, so a test can use a keypair it generated.
pub fn verify_with(
    public_key: &PublicKey,
    body: &[u8],
    signature_box: &str,
) -> Result<(), LauncherError> {
    let decoded = decode_box(signature_box, "signature")?;
    let signature = Signature::decode(&decoded).map_err(|e| {
        LauncherError::ManifestUnsigned(format!("the signature does not decode: {e}"))
    })?;

    // `allow_legacy` matches how the updater plugin verifies its own artifacts.
    public_key
        .verify(body, &signature, true)
        .map_err(|e| LauncherError::ManifestUnsigned(format!("the signature does not match: {e}")))
}

/// The pinned key, decoded the way the updater decodes the one in tauri.conf.json.
pub fn pinned_public_key() -> Result<PublicKey, LauncherError> {
    let decoded = decode_box(PUBLIC_KEY_BOX.trim(), "public key")?;
    PublicKey::decode(&decoded).map_err(|e| {
        LauncherError::ManifestUnsigned(format!("the public key does not decode: {e}"))
    })
}

/// A key or signature file holds the base64 of a minisign box, so decode first. Naming
/// which step failed is what makes a wrong file obvious.
fn decode_box(text: &str, what: &str) -> Result<String, LauncherError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(text.trim())
        .map_err(|e| LauncherError::ManifestUnsigned(format!("the {what} is not base64: {e}")))?;
    String::from_utf8(bytes)
        .map_err(|_| LauncherError::ManifestUnsigned(format!("the {what} is not UTF-8")))
}

#[cfg(test)]
mod tests {
    use super::*;

    // The committed key must parse the way this build parses it, or every game becomes
    // unresolvable once this ships.
    #[test]
    fn test_pinned_public_key_parses() {
        if let Err(err) = pinned_public_key() {
            panic!("src-tauri/updater.pub cannot be used to verify manifests: {err}");
        }
    }

    #[test]
    fn test_a_signature_that_is_not_base64_is_refused() {
        let public_key = pinned_public_key().expect("the pinned key parses");
        let err = verify_with(&public_key, b"{}", "not base64!").expect_err("refused");
        assert!(
            matches!(err, LauncherError::ManifestUnsigned(_)),
            "expected a signature error, got {err:?}"
        );
    }

    #[test]
    fn test_a_signature_box_that_is_not_a_signature_is_refused() {
        let public_key = pinned_public_key().expect("the pinned key parses");
        let not_a_box = base64::engine::general_purpose::STANDARD.encode("hello");
        let err = verify_with(&public_key, b"{}", &not_a_box).expect_err("refused");
        assert!(
            err.to_string().contains("does not decode"),
            "expected a decode error, got {err}"
        );
    }
}
