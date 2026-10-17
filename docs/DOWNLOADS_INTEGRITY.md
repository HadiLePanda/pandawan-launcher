# Download integrity

The public download page is the only path that hands a binary to a person without
the updater's signature check. An R2-write holder could otherwise replace an
installer or a URL, and a visitor would run it with no verification. The launcher
publishes two documents that close that gap.

The site lives in a separate repository. This document is the contract it must
implement; nothing here edits that checkout.

## What the launcher publishes

`{CDN_ORIGIN}/launcher/downloads.json`:

```json
{
  "version": "0.4.1",
  "platforms": {
    "windows": [
      {
        "label": "EXE installer",
        "url": "https://.../launcher/Pandawan.Launcher_0.4.1_x64-setup.exe",
        "sha256": "<64 lowercase hex characters>"
      }
    ]
  }
}
```

`{CDN_ORIGIN}/launcher/downloads.json.sig` is the minisign signature of those
exact bytes, made with the release key. The pinned public key is
`src-tauri/updater.pub` (the base64 of a whole minisign PublicKeyBox).

`scripts/lib/minisign-verify.mjs` is a working verifier. Tauri signs with the
`ED` algorithm, which is Ed25519 over a BLAKE2b-512 prehash of the bytes.

## What the site must do

1. **Verify the document before serving it.** The Pages Function reads
   `downloads.json` and `downloads.json.sig`, checks the signature against the
   pinned key, and returns only the verified body. A signature failure is an
   error, not a fallback to the unverified copy.
2. **Check the bytes before offering them.** After a download, compute SHA-256
   and compare it with the entry's `sha256`. A mismatch is an error.
3. **Refuse an entry it cannot verify.** No `sha256`, a non-`https` URL, or a
   host other than the pinned CDN origin means the entry is not offered.
4. **Treat the key as a constant.** Put `updater.pub`'s value in the site's
   source and review changes to it. A key read from the bucket is not a pin.

The function runs outside R2, so an R2-write holder cannot change the check.

Workers expose Ed25519 through WebCrypto but not BLAKE2b. Use a small BLAKE2b
implementation (for example `@noble/hashes/blake2b`) for the prehash; SHA-256
for the file hashes is in WebCrypto already.

## Deployment order

1. Sign the live catalog: `npm run publish:catalog -- --resign --confirm`.
   The client refuses an unsigned catalog, and a normal publish uploads nothing
   when the merged document is unchanged, so this is the one-time migration.
2. Publish a launcher build. Its publisher writes the signed, hashed
   `downloads.json` and `downloads.json.sig`. A local Windows publish hashes the
   Windows group; the CI index-only step hashes the macOS and Linux groups.
3. Deploy the site change that verifies both documents.
4. Ship a launcher whose client verifies the catalog signature.

The fields are additive, so an unverified site still works until step 3. It is
the step that closes the finding.
