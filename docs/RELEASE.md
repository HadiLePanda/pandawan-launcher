# Release Checklist

Sticky-note guide for shipping a new Pandawan Launcher version.

## Prerequisites

- Secret key exists locally at `src-tauri/.secrets/updater.key`.
- GitHub repository secret `TAURI_SIGNING_PRIVATE_KEY` is set.
- `src-tauri/updater.pub` is committed and synced into `tauri.conf.json`.

## Steps

1. **Bump the version** in all three files:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`

2. **Cut a release branch** from latest `main`:

   ```bash
   git checkout main
   git pull
   git checkout -b release/v0.1.0
   git push -u origin release/v0.1.0
   ```

3. **Stabilise** on the branch. Merge fixes only, no new features.

4. **Tag and push** when ready:

   ```bash
   git tag -a v0.1.0 -m "Release v0.1.0"
   git push origin v0.1.0
   ```

5. **CI builds and drafts the release** automatically via `.github/workflows/release.yml`.

6. **Publish** the drafted GitHub Release and upload `updates.json` to the CDN endpoint configured in `tauri.conf.json`.

## Notes

- Tags must match `v*.*.*` to trigger the workflow.
- The release is drafted, not published automatically.
- Local builds use `npm run tauri:build`, which reads `src-tauri/.secrets/updater.key` automatically.
