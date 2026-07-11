# Phase 1 — Foundation + Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan inline.

**Goal:** Add PR CI, formatting/linting configs, Tauri security hardening, and gitignore hygiene.

**Architecture:** A single GitHub Actions workflow runs frontend and Rust checks on every PR. Prettier and ESLint configs enforce consistency. A Rust path-safety helper is applied to all file-system commands. Tauri config narrows asset access and adds a CSP.

**Tech Stack:** GitHub Actions, npm, Prettier, ESLint, TypeScript-ESLint, Rust, Tauri v2.

---

## File map

| File                           | Responsibility                                   |
| ------------------------------ | ------------------------------------------------ |
| `.github/workflows/ci.yml`     | PR CI workflow                                   |
| `.prettierrc`                  | Prettier formatting rules                        |
| `eslint.config.js`             | ESLint rules (bug catching only)                 |
| `package.json`                 | Add lint/format scripts and dev deps             |
| `src-tauri/tauri.conf.json`    | Tighten asset protocol scope and CSP             |
| `src-tauri/src/lib.rs`         | Add `assert_path_inside_root`, apply to commands |
| `src-tauri/src/patch.rs`       | Apply path safety to `cleanup_orphaned_files`    |
| `src-tauri/src/lib.rs` (tests) | Unit tests for path safety helper                |
| `.gitignore`                   | Remove `docs/BRAND_GUIDE.md`, add `.tmp-venv/`   |

---

## Task 1: Add PR CI workflow

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: CI

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main, dev]

env:
  CARGO_TERM_COLOR: always

jobs:
  frontend:
    name: Frontend
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run format:check
      - run: npm run build
      - run: npm test

  rust:
    name: Rust
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy, rustfmt
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
        working-directory: .
      - run: cargo fmt --check
        working-directory: src-tauri
      - run: cargo clippy --all-targets -- -D warnings
        working-directory: src-tauri
      - run: cargo test
        working-directory: src-tauri
```

- [ ] **Step 2: Verify YAML is valid** (no tool required; eyeball it)

---

## Task 2: Add formatting and linting configs

**Files:**

- Create: `.prettierrc`
- Create: `eslint.config.js`
- Modify: `package.json`

- [ ] **Step 1: Add `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
```

- [ ] **Step 2: Add `eslint.config.js`**

```js
import js from '@eslint/js';
import ts from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default ts.config(js.configs.recommended, ...ts.configs.recommended, {
  plugins: {
    'react-hooks': reactHooks,
    'react-refresh': reactRefresh,
  },
  rules: {
    ...reactHooks.configs.recommended.rules,
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    '@typescript-eslint/no-explicit-any': 'off',
  },
});
```

- [ ] **Step 3: Add scripts and dependencies to `package.json`**

Add to `scripts`:

```json
"lint": "eslint . --ext .ts,.tsx",
"format": "prettier --write .",
"format:check": "prettier --check ."
```

Add to `devDependencies`:

```json
"@eslint/js": "^9.0.0",
"eslint": "^9.0.0",
"eslint-plugin-react-hooks": "^5.0.0",
"eslint-plugin-react-refresh": "^0.4.0",
"prettier": "^3.0.0",
"typescript-eslint": "^8.0.0"
```

- [ ] **Step 4: Install dependencies**

Run: `npm install`

- [ ] **Step 5: Run first format pass**

Run: `npm run format`

- [ ] **Step 6: Run lint and fix real issues**

Run: `npm run lint`  
Fix any legitimate bugs; ignore pure formatting noise (Prettier owns that).

- [ ] **Step 7: Verify build and tests still pass**

Run: `npm run build` and `npm test`

---

## Task 3: Harden Tauri config

**Files:**

- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Tighten `assetProtocol` scope**

Replace:

```json
"assetProtocol": {
  "enable": true,
  "scope": [
    "$APPDATA/**",
    "$HOME/**",
    "$DOCUMENT/**"
  ]
}
```

With:

```json
"assetProtocol": {
  "enable": true,
  "scope": [
    "$APPDATA/com.pandawancorp.launcher/**",
    "$APPDATA/PandawanGames/**"
  ]
}
```

- [ ] **Step 2: Add CSP**

Replace `"csp": null` with:

```json
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https:; font-src 'self'; object-src 'none'; frame-ancestors 'none';"
```

- [ ] **Step 3: Verify frontend still builds**

Run: `npm run build`

---

## Task 4: Add Rust path-safety helper

**Files:**

- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/patch.rs`

- [ ] **Step 1: Add helper in `src-tauri/src/lib.rs`**

After the existing `assert_install_path_safe` function, add:

```rust
/// Verify a path is inside a given root after canonicalization.
/// This should be used before any file read/write/delete/exec operation.
pub fn assert_path_inside_root(
    path: &std::path::Path,
    root: &std::path::Path,
) -> Result<(), String> {
    let canonical_path = path
        .canonicalize()
        .map_err(|e| format!("Invalid path {}: {}", path.display(), e))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("Invalid root {}: {}", root.display(), e))?;

    if !canonical_path.starts_with(&canonical_root) {
        return Err(format!(
            "Path {} is outside allowed root {}",
            canonical_path.display(),
            canonical_root.display()
        ));
    }

    Ok(())
}
```

- [ ] **Step 2: Apply path safety to `install_game`**

After computing `install_dir`, call:

```rust
let allowed_root = settings
    .games_install_path
    .clone()
    .unwrap_or_else(get_default_games_path);
assert_path_inside_root(&install_dir, &allowed_root)?;
```

- [ ] **Step 3: Apply path safety to `uninstall_game`**

Already has `assert_install_path_safe`; replace it with `assert_path_inside_root` for consistency.

- [ ] **Step 4: Apply path safety to `launch_game`**

After computing `exe_path`, verify:

```rust
assert_path_inside_root(&exe_path, &installation.install_path)?;
```

- [ ] **Step 5: Apply path safety to `verify_game`**

After resolving `install_path`, verify:

```rust
assert_path_inside_root(&install_path, &install_path)?;
```

Actually verify against the allowed games root. Fetch the allowed root from settings and verify `install_path` is inside it.

- [ ] **Step 6: Apply path safety to `cleanup_orphaned_files` in `src-tauri/src/patch.rs`**

For each relative path, after joining with `install_path`, call a helper that verifies the joined path is inside `install_path` before deleting.

Use a local helper:

```rust
fn assert_inside_install(path: &Path, install_path: &Path) -> Result<(), PatchError> {
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let canonical_install = install_path
        .canonicalize()
        .unwrap_or_else(|_| install_path.to_path_buf());
    if !canonical.starts_with(&canonical_install) {
        return Err(PatchError::Other(format!(
            "Unsafe path {} escapes install directory",
            path.display()
        )));
    }
    Ok(())
}
```

Call it before `fs::remove_file`.

- [ ] **Step 7: Add unit tests for path safety helper**

In `src-tauri/src/lib.rs` `#[cfg(test)]` module:

```rust
#[test]
fn test_assert_path_inside_root_accepts_inside() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("games");
    let child = root.join("my-game");
    std::fs::create_dir_all(&child).unwrap();
    assert!(assert_path_inside_root(&child, &root).is_ok());
}

#[test]
fn test_assert_path_inside_root_rejects_escape() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("games");
    let escape = temp.path().join("outside");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::create_dir_all(&escape).unwrap();
    assert!(assert_path_inside_root(&escape, &root).is_err());
}
```

- [ ] **Step 8: Run Rust tests and clippy**

Run: `cargo test` and `cargo clippy --all-targets -- -D warnings` in `src-tauri`

---

## Task 5: Clean up gitignore

**Files:**

- Modify: `.gitignore`

- [ ] **Step 1: Remove tracked-but-ignored file conflict**

If `docs/BRAND_GUIDE.md` is intended to be tracked, remove its `.gitignore` entry. If not, delete the file.

- [ ] **Step 2: Add `.tmp-venv/`**

Add:

```gitignore
.tmp-venv/
```

---

## Task 6: Final verification

- [ ] Run `npm run build` ✅
- [ ] Run `npm test` ✅
- [ ] Run `cargo test` in `src-tauri` ✅
- [ ] Run `cargo clippy --all-targets -- -D warnings` ✅
- [ ] Run `cargo fmt --check` in `src-tauri` ✅
- [ ] Run `npm run lint` ✅
- [ ] Run `npm run format:check` ✅

---

## Execution choice

Plan saved to `docs/superpowers/plans/2026-07-11-phase1-foundation-security-plan.md`.

**Recommended:** Inline execution in this session for fast iteration.
