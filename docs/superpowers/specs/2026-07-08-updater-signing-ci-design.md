# Updater Signing Layout and Release CI Design

## Context

The launcher uses Tauri's built-in updater with a minisign keypair. The public key must be baked into `tauri.conf.json` at build time; the private key must sign the bundle. Previously the secret key lived outside the repo at `~/.pandawan/new-updater/updater.key`, which made local builds and CI configuration harder to document and reproduce.

## Goals

1. Keep the secret key inside the project folder for convenience but never committed.
2. Make local signed builds a single npm script.
3. Add a GitHub Actions workflow that builds and signs releases automatically.
4. Document the new layout so future maintainers know where keys live and how CI uses them.

## Decision: Release branches + tags

Professionally, tags mark a fixed point in history as a release. Branches are for parallel work. For this project we will use:

- Feature/fix branches merged into `main` via PR.
- When ready to release, cut a `release/vX.Y.Z` branch for final stabilisation.
- Tag the release branch as `vX.Y.Z`.
- Pushing the tag triggers the release CI workflow.

This gives a stable release line while keeping `main` open for ongoing work.

## Local secret-key layout

- `src-tauri/updater.pub` — committed public key.
- `src-tauri/.secrets/updater.key` — gitignored secret key.

`.gitignore` will ignore:

```gitignore
src-tauri/.secrets/
*.key
```

The existing `scripts/sync-updater-key.cjs` reads `src-tauri/updater.pub` and injects it into `tauri.conf.json`. This keeps the public key in one source of truth.

## Build tooling

### New script: `scripts/build-signed.cjs`

Responsibilities:

1. Run `scripts/sync-updater-key.cjs` so `tauri.conf.json` has the current public key.
2. Read `src-tauri/.secrets/updater.key`.
3. Set `TAURI_SIGNING_PRIVATE_KEY` for the Tauri CLI.
4. Execute `tauri build`.

If the secret key file is missing, the script exits with a clear error message instead of starting an unsigned build.

### `package.json` changes

- `tauri:build` becomes `node scripts/build-signed.cjs`.
- `tauri:dev` stays as `node scripts/sync-updater-key.cjs && tauri dev` (signing is only required for release bundles).
- `sync:updater-key` stays unchanged.

## Release CI workflow

File: `.github/workflows/release.yml`

Trigger: `push` of tags matching `v[0-9]+.[0-9]+.[0-9]+*`.

Jobs:

1. **build-and-publish**
   - Checkout the tag.
   - Set up Node.js and Rust.
   - Install frontend dependencies.
   - Run `npm run build` (Vite production build).
   - Run Tauri build via `tauri-apps/tauri-action`, passing `TAURI_SIGNING_PRIVATE_KEY` from a GitHub repository secret.
   - Draft a GitHub Release and attach installers.

GitHub secret name: `TAURI_SIGNING_PRIVATE_KEY`

The workflow will initially target Windows only, with the matrix easily extended to Linux and macOS later.

## Documentation updates

- `README.md`: update Self-Updates section to mention `src-tauri/.secrets/updater.key` and the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret.
- `AGENTS.md`: add the same notes under the Important Notes / Updater section.

## Security notes

- The secret key is never printed, logged, or committed.
- The build script reads the key from disk only at build time.
- CI receives the key via an encrypted GitHub secret.
- If a developer does not have the secret key, `tauri:build` fails safely rather than producing an unsigned bundle silently.

## Future considerations

- `updates.json` generation and CDN upload are not in scope for this change; the workflow will draft the GitHub Release only.
- Cross-platform builds can be added by extending the matrix in `release.yml`.

## Approved approach

- Secret key inside project: `src-tauri/.secrets/updater.key` (gitignored).
- Release model: release branches + semver tags.
- CI trigger: tag push matching `v*.*.*`.
