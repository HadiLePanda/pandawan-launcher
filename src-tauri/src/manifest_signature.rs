//! Verification of the signature a published manifest carries.
//!
//! The launcher trusts the CDN for nothing else. A manifest lists each file's
//! SHA256, so an attacker who can write to the bucket - or who is served by a
//! mis-issued certificate - can publish a build whose hashes match the files it
//! ships, and the launcher would install and run it. The signature is what makes
//! the bucket's contents checkable rather than merely fetched: only the holder of
//! the release key can produce one, and the public half ships inside this binary.
//!
//! The key is the one `src-tauri/updater.pub` pins, which is also what the
//! launcher's own updates use. One keypair rather than two because that is the one
//! secret the release pipeline already holds and protects, and a second key would
//! be a second thing to lose. See docs/GAME_CATALOG.md for what is signed.

use crate::types::LauncherError;
use base64::Engine;
use minisign_verify::{PublicKey, Signature};

/// The public key this build trusts, as committed in `src-tauri/updater.pub`.
///
/// That file holds the base64 of a whole minisign PublicKeyBox, which is the form
/// the Tauri CLI writes and `verify_signature()` in tauri-plugin-updater decodes.
/// `npm run keys:check` keeps it in step with the secret key.
const PUBLIC_KEY_BOX: &str = include_str!("../updater.pub");

/// Verify `body` against the signature box published beside it.
///
/// `signature_box` is the content of the `.sig` file: the base64 of a minisign
/// SignatureBox, which is what `tauri signer sign` writes.
pub fn verify(body: &[u8], signature_box: &str) -> Result<(), LauncherError> {
    let public_key = pinned_public_key()?;
    verify_with(&public_key, body, signature_box)
}

/// Verify against a caller-supplied key.
///
/// Split out from `verify` so the rule can be exercised with a keypair a test
/// generates, rather than only with the release key that CI does not have.
pub fn verify_with(
    public_key: &PublicKey,
    body: &[u8],
    signature_box: &str,
) -> Result<(), LauncherError> {
    let decoded = decode_box(signature_box, "signature")?;
    let signature = Signature::decode(&decoded).map_err(|e| {
        LauncherError::ManifestUnsigned(format!("the signature does not decode: {e}"))
    })?;

    // `allow_legacy` matches how the updater plugin verifies its own artifacts, so
    // either form the Tauri CLI can produce is accepted.
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

/// A key or signature file holds the base64 of a minisign box, so the text has to
/// be decoded before the box can be parsed. Reporting which of the two steps failed
/// is what makes a wrong file obvious instead of a bare "verification failed".
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

    // The committed key must parse the way this build parses it, or every game
    // becomes unresolvable the moment this ships. Same check as
    // tests/updater_signing_tests.rs makes for the updater, on this code path.
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
