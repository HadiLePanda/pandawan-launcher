# Release Checklist

Sticky-note guide for shipping a new Pandawan Launcher version.

## Files this touches

| File                        | What to change              |
| --------------------------- | --------------------------- |
| `package.json`              | `"version"`                 |
| `src-tauri/Cargo.toml`      | `version` under `[package]` |
| `src-tauri/tauri.conf.json` | `"version"`                 |

## Key files you must have

- `src-tauri/updater.pub` â€” minisign **public** key, committed to the repo.
- `src-tauri/.secrets/updater.key` â€” minisign **secret** key, **never committed**.
- GitHub Secrets:
  - `TAURI_SIGNING_PRIVATE_KEY` - the **verbatim contents of `updater.key`**:
    `gh secret set TAURI_SIGNING_PRIVATE_KEY < src-tauri/.secrets/updater.key`.
    `tauri signer generate` already writes that file base64-encoded and the Tauri
    CLI base64-decodes it, so do NOT re-encode it and do NOT paste raw minisign text.
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - only if the key has a password. Without
    it the CLI prompts interactively and the CI build hangs.

Never generate keys with the `minisign` CLI. The Rust `minisign` crate that Tauri
uses rejects the empty-password key format that `minisign -G` writes, so the two
formats are not interchangeable. Use `npm run keys:generate` (which wraps
`tauri signer generate`).

`npm run tauri:build` and the release workflow automatically sync `updater.pub` into `tauri.conf.json` for you.

## Steps

1. **Make sure `main` is green** (CI passes).

2. **Bump the version** in the three files above to the same semver value, e.g. `0.2.0`.

3. **Cut a release branch** from latest `main`:

   ```bash
   git checkout main
   git pull
   git checkout -b release/v0.2.0
   git push -u origin release/v0.2.0
   ```

4. **Stabilise** on that branch â€” bug fixes only, no new features.

5. **Test a local signed build**:

   ```bash
   npm run tauri:build
   ```

   This needs `src-tauri/.secrets/updater.key` on your machine.

6. **Tag and push** when ready:

   ```bash
   git tag -a v0.2.0 -m "Release v0.2.0"
   git push origin v0.2.0
   ```

7. **CI builds the release** via `.github/workflows/release.yml`.
   - Builds Windows, macOS (universal), and Linux bundles.
   - Drafts a GitHub Release and generates `latest.json` for the auto-updater.

8. **Publish** the drafted GitHub Release.

9. **Upload `latest.json`** to your CDN endpoint (`https://pub-789d1bb0f3da4a99ae1024d53ea305d3.r2.dev/launcher/updates.json`) so installed launchers can find the update.

## Notes

- Tags must match `v*.*.*` (e.g. `v0.2.0`) to trigger the workflow.
- The release is drafted, not published automatically.
- If `TAURI_SIGNING_PRIVATE_KEY` is missing, the build will fail â€” the workflow checks the public key exists first, but the secret itself must be set in GitHub.
