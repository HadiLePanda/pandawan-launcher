---
name: release-verification
description: Use before cutting a release tag or declaring a release works. Covers the updater signing chain (tauri signer vs minisign CLI), the two minisign pubkey encodings, R2 publishing, and the checks that actually prove a release works versus the ones that only prove a file exists.
version: 1.0.0
---

# Release verification

A release can pass every cheap check and still be completely broken. The
failures recorded here were all silent: the build succeeded, the tag pushed, CI
went green, and players got nothing. Each is now guarded by a test or a
failing-fast step, because the pattern that caused them was checking that a file
existed rather than checking that it worked.

## The signing chain

**Generate keys with `tauri signer generate`, never `minisign -G`.** The Tauri
CLI base64-decodes the key before parsing it (`secret_key()` in
`tauri-cli/src/helpers/updater_signature.rs`), and the Rust `minisign` crate it
uses rejects the empty-password key format that `minisign -G` writes:

```
incorrect updater private key password: Wrong password for that key
```

The C tool and the Rust crate are not interchangeable. `npm run keys:generate`
wraps the correct one.

**Always set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, even to an empty string.**
The CLI reads it with clap `env=`, and when the variable is *absent* it falls
back to prompting interactively. The build then hangs forever at:

```
Info Decrypting updater signing key, expect a prompt for password
```

with no error and no timeout. An unset variable and an empty one are different
things here.

**`bundle.createUpdaterArtifacts` belongs under `bundle`,** not
`plugins.updater`. In the wrong place it is ignored, `tauri build` emits no
`.sig` files and no `latest.json`, and the release ships unsigned with no
warning.

## The two pubkey encodings

This caused the most confusion, because both forms exist and each is valid
*somewhere*. Getting it backwards fails at runtime, not at build.

`plugins.updater.pubkey` must be the **base64 of a whole PublicKeyBox** (the
`untrusted comment:` line plus the key line). `verify_signature()` in
`tauri-plugin-updater/src/updater.rs` does:

```rust
let pub_key_decoded = base64_to_string(pub_key)?;
let public_key = PublicKey::decode(&pub_key_decoded)?;   // decode, NOT from_base64
```

`PublicKey::decode` takes a whole box. `PublicKey::from_base64` takes a raw key
and is **not** what the plugin calls. Conflating the two produces a manifest that
compiles, installs, and rejects its own updates.

`updater.pub` is written already in that form, so it is embedded verbatim.
Anything that parses a public key should go through one shared helper that
mirrors the plugin exactly, rather than each call site picking an API.

## Verifying signatures

**Do not verify a Tauri signature with the `minisign` CLI.** Tauri writes the
untrusted comment `signature from tauri secret key`, and minisign 0.12 refuses
it with `Untrusted signature comment too long`. This looks like a bad signature
but is a tool limitation. Use `minisign-verify`, the crate the plugin depends on.

**Existence is not validity.** A test that the config is synced can pass while
every update fails. The test that matters downloads the published artifact and
checks the signature:

```
verified published windows-x86_64-msi (7200768 bytes)
```

## Publishing

`tauri signer sign` with the key present proves the key works. Proving the
*config* is right needs a test; proving a *release* works needs a download from
the live bucket.

The R2 upload is a separate failure domain from the build and should be
separable. A full three-platform release is ~25 minutes, almost all Rust
compilation; the upload is ~30 seconds. Do not spend 25 minutes rediscovering a
publishing bug - `npm run release:publish` and the workflow's `publish_only`
trigger both do the upload alone.

**aws-cli 2.33.x** computes a CRC32 by default and its recursive `s3 cp` aborts
with `Need to rewind the stream ... but stream is not seekable` (aws-cli#10026).
`AWS_REQUEST_CHECKSUM_CALCULATION=when_required` fixes it. `--no-checksum` on
the command does not.

**Upload `latest.json` last.** It is the file the updater polls, so it must
never reference an artifact that has not landed yet.

**Refuse to publish an incomplete manifest.** If `latest.json` points at a file
that is not on the release, stop. Players would find an update, download it, and
fail - worse than no update at all.

## URL rewriting

`tauri-action` emits two URL shapes and both occur in one manifest:

```
https://github.com/<o>/<r>/releases/download/<tag>/<file>
https://api.github.com/repos/<o>/<r>/releases/assets/<id>
```

The second appears for macOS, where one universal archive backs every `darwin-*`
target. Taking the last path segment yields a numeric asset **id**, not a
filename, so the naive rewrite publishes a URL that 404s for every macOS player
while Windows and Linux work fine - a failure that only shows up on one
platform. Resolve the id through the release assets.

`gh api --paginate` emits one JSON array **per page**; mapping each page
independently produces nested arrays. Use `jq -s add`.

## Tag discipline

`gh run rerun` re-runs the workflow **from the tagged commit, not from `main`**.
A fix committed to `main` is silently absent from a rerun, which looks exactly
like the fix not working. This cost two full 25-minute cycles. Before debugging a
CI failure, confirm the tag contains the fix:

```bash
git show v0.1.0:path/to/file | grep <the fix>
```

## Credentials

- Secrets, never repository variables. Variables are plaintext and readable by
  anyone with repo access.
- Account ID, bucket name, and public URLs are configuration, not credentials -
  variables are correct for those.
- **`gh secret set NAME` reports success for any input, including an empty
  paste.** Verify with `gh secret list` timestamps afterwards.
- Rotate any credential that has been read into a transcript or log.

## Never

- Print the contents of `.env` or any credential file. If a value must be
  checked, check only that the key exists and report a length or a masked form.
- Claim a release works from a config test. Download the artifact.
- Say a fix works before reproducing the original failure.
- Change code you have not read, based on a remembered version. Re-read first;
  an edit anchored to stale text either fails or lands somewhere unintended.