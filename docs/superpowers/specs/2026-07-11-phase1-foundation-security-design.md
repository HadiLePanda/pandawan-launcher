# Phase 1 — Foundation + Security Hardening

**Date:** 2026-07-11  
**Scope:** CI, formatting/linting, Tauri security tightening, and gitignore hygiene. Skip generated bindings, store split, logging, signing, and e2e for later phases.

## Goals

1. Add a PR CI workflow that prevents regressions from reaching `main`/`dev`.
2. Introduce formatting and linting configs so the codebase stays consistent.
3. Harden Tauri security: narrow `assetProtocol`, add a CSP, and validate all filesystem paths.
4. Fix gitignore inconsistencies.

## Non-goals

- Generated TypeScript/Rust IPC bindings
- Store split or architecture refactors
- Persistent logging / crash reporting
- Windows code signing
- End-to-end tests
- CDN allowlist (Phase 2)

## Architecture

### CI

`.github/workflows/ci.yml` runs on `push` and `pull_request` for `main` and `dev`:

- Frontend build and tests: `npm ci`, `npm run build`, `npm test`
- Rust tests and linting: `cargo test`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`

### Formatting and linting

- `.prettierrc`: single quotes, 100 print width, trailing commas.
- `eslint.config.js`: `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`. Only bug-catching rules; stylistic formatting is Prettier's job.
- First format pass applied to the whole repo so subsequent diffs are meaningful.

### Tauri security

- `tauri.conf.json`:
  - `assetProtocol.scope`: only `$APPDATA/PandawanGames/**` and `$APPDATA/com.pandawancorp.launcher/**`.
  - `csp`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https:`.
- Rust path-safety helper in `src-tauri/src/lib.rs`:
  - `assert_path_inside_root(path, root)` canonicalizes both paths and checks prefix.
  - Used by `install_game`, `uninstall_game`, `launch_game`, `verify_game`, and `cleanup_orphaned_files`.
- Launch executable resolution is verified to stay inside `installation.install_path`.

### Gitignore

- Remove `docs/BRAND_GUIDE.md` from `.gitignore` if it is meant to be tracked; otherwise delete it.
- Add `.tmp-venv/`.

## Error handling

- CI failures must block merge.
- Path validation returns typed errors surfaced to the frontend; no silent swallowing.

## Testing

- Existing tests must remain green after formatting and security changes.
- Add Rust unit tests for the new path-safety helper.

## Risks

- Prettier/eslint first pass will produce a large diff; review should focus on config files, not formatting noise.
- CSP may block existing remote images/news if not configured correctly; `img-src https:` allows remote CDN images.
- `style-src 'unsafe-inline'` is required because the download progress bar uses inline `width` styles. If we later refactor that to a CSS custom property we can remove `'unsafe-inline'`.
