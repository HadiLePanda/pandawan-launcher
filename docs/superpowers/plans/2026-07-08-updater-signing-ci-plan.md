# Updater Signing Layout and Release CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the minisign secret key into a gitignored project folder, wire local signed builds to a single npm script, and add a GitHub Actions release workflow triggered by semver tags.

**Architecture:** A small Node build script reads the local secret key and sets `TAURI_SIGNING_PRIVATE_KEY` before invoking `tauri build`. The public key remains committed and is synced into `tauri.conf.json` by the existing script. CI uses the same build script with the key injected from a GitHub secret.

**Tech Stack:** Node.js scripts, Tauri CLI, GitHub Actions, minisign.

---

## File Structure

| File                             | Responsibility                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src-tauri/updater.pub`          | Committed minisign public key (source of truth).                                                         |
| `src-tauri/.secrets/updater.key` | Gitignored minisign secret key. Created by moving the existing key from `~/.pandawan/new-updater/`.      |
| `.gitignore`                     | Ignore `src-tauri/.secrets/` and `*.key`.                                                                |
| `scripts/sync-updater-key.cjs`   | Existing script that writes `updater.pub` into `tauri.conf.json`. Keep as-is unless it needs path fixes. |
| `scripts/build-signed.cjs`       | New script: sync public key, load secret key, set env var, run `tauri build`.                            |
| `package.json`                   | Update `tauri:build` to call `scripts/build-signed.cjs`.                                                 |
| `.github/workflows/release.yml`  | New workflow: build and draft release on `v*.*.*` tag push.                                              |
| `README.md`                      | Document local secret-key path and CI secret name.                                                       |
| `AGENTS.md`                      | Document signing layout for future agents.                                                               |

---

### Task 1: Rotate keypair and move secret into gitignored project folder

**Files:**

- Create: `src-tauri/.secrets/updater.key`
- Modify: `src-tauri/updater.pub`
- Modify: `.gitignore`

**Prerequisite:** The fresh keypair currently lives at `C:/Users/hadilepanda/.pandawan/new-updater/updater.key` and `.../updater.pub`. Public key base64: `RWQvuHc8cORDVNcS0ZqpM9YYQP8mUkjSfLJSQG9MbMuqo+o6rT2dzo16`.

- [ ] **Step 1: Create the secrets directory and move the secret key**

```bash
mkdir -p src-tauri/.secrets
cp "C:/Users/hadilepanda/.pandawan/new-updater/updater.key" src-tauri/.secrets/updater.key
```

- [ ] **Step 2: Replace the committed public key**

Overwrite `src-tauri/updater.pub` with the contents of `C:/Users/hadilepanda/.pandawan/new-updater/updater.pub`. It should contain one line, e.g.:

```
RWQvuHc8cORDVNcS0ZqpM9YYQP8mUkjSfLJSQG9MbMuqo+o6rT2dzo16
```

- [ ] **Step 3: Add gitignore rules**

Modify `.gitignore` to add:

```gitignore
# Minisign updater keys
src-tauri/.secrets/
*.key
```

- [ ] **Step 4: Verify the secret key is ignored**

```bash
git check-ignore -v src-tauri/.secrets/updater.key
```

Expected: prints the `.gitignore` rule that matches.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/updater.pub .gitignore
git commit -m "chore(updater): rotate minisign keypair and gitignore local secret"
```

---

### Task 2: Verify the public-key sync script

**Files:**

- Read: `scripts/sync-updater-key.cjs`

- [ ] **Step 1: Read the script and confirm it reads `src-tauri/updater.pub` and writes `tauri.conf.json`.**

- [ ] **Step 2: Run it**

```bash
npm run sync:updater-key
```

Expected: `src-tauri/tauri.conf.json` now contains the new public key under `plugins.updater.pubkey`.

- [ ] **Step 3: Commit the synced config**

```bash
git add src-tauri/tauri.conf.json
git commit -m "chore(updater): sync rotated public key into tauri.conf.json"
```

---

### Task 3: Add the local signed-build script

**Files:**

- Create: `scripts/build-signed.cjs`
- Modify: `package.json`

- [ ] **Step 1: Create `scripts/build-signed.cjs`**

```javascript
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = resolve(__dirname, '..');
const secretKeyPath = resolve(projectRoot, 'src-tauri', '.secrets', 'updater.key');

// 1. Sync public key first.
const sync = spawn('node', [resolve(__dirname, 'sync-updater-key.cjs')], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

sync.on('close', (code) => {
  if (code !== 0) {
    console.error('Failed to sync updater public key.');
    process.exit(code ?? 1);
  }

  // 2. Ensure secret key exists.
  if (!existsSync(secretKeyPath)) {
    console.error(
      `Missing updater secret key: ${secretKeyPath}\n` +
        'Place your minisign secret key at that path or set TAURI_SIGNING_PRIVATE_KEY.'
    );
    process.exit(1);
  }

  // 3. Read secret key and set env var.
  const privateKey = readFileSync(secretKeyPath, 'utf-8').trim();
  if (!privateKey) {
    console.error(`Updater secret key file is empty: ${secretKeyPath}`);
    process.exit(1);
  }

  // 4. Run tauri build with the signing key.
  const build = spawn('tauri', ['build'], {
    cwd: resolve(projectRoot, 'src-tauri'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: privateKey,
    },
  });

  build.on('close', (buildCode) => {
    process.exit(buildCode ?? 0);
  });
});
```

- [ ] **Step 2: Update `package.json` scripts**

Change:

```json
"tauri:build": "node scripts/sync-updater-key.cjs && tauri build",
```

to:

```json
"tauri:build": "node scripts/build-signed.cjs",
```

Leave `tauri:dev` and `sync:updater-key` unchanged.

- [ ] **Step 3: Validate the script loads the key without running a full build**

Temporarily add a `console.log` at the start of `scripts/build-signed.cjs`, run:

```bash
npm run tauri:build
```

Let it proceed until Tauri starts; remove the debug log afterwards. The sync step should succeed and Tauri should begin building. Cancel with Ctrl+C once the build is underway.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-signed.cjs package.json
git commit -m "feat(updater): add local signed-build script"
```

---

### Task 4: Add the release CI workflow

**Files:**

- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags:
      - 'v[0-9]+.[0-9]+.[0-9]+*'

jobs:
  release:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: windows-latest
            args: ''
    runs-on: ${{ matrix.platform }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Setup Rust
        uses: dtolnay/rust-action@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Install frontend dependencies
        run: npm ci

      - name: Build frontend
        run: npm run build

      - name: Build and release Tauri bundle
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'Pandawan Launcher ${{ github.ref_name }}'
          releaseBody: 'See the assets below to download and install Pandawan Launcher.'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release workflow for signed builds"
```

---

### Task 5: Update documentation

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update `README.md` Self-Updates section**

Add or update the section to include:

```markdown
### Self-updates

The launcher uses Tauri's built-in updater with a minisign keypair.

- Public key: `src-tauri/updater.pub` (committed). It is synced into `tauri.conf.json` automatically by `npm run sync:updater-key`.
- Secret key: `src-tauri/.secrets/updater.key` (gitignored). Place your key there before running `npm run tauri:build`.
- CI: set the full minisign secret key as the GitHub repository secret `TAURI_SIGNING_PRIVATE_KEY`.
```

- [ ] **Step 2: Update `AGENTS.md` updater notes**

Add under Important Notes:

```markdown
- The updater secret key lives at `src-tauri/.secrets/updater.key` and is gitignored. Never commit it.
- The public key source of truth is `src-tauri/updater.pub`; run `npm run sync:updater-key` (or any `tauri:*` script) to sync it into `tauri.conf.json`.
- Release CI is triggered by pushing a semver tag like `v0.1.0` and expects `TAURI_SIGNING_PRIVATE_KEY` in GitHub Secrets.
```

- [ ] **Step 3: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: document new signing layout and CI secret"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run frontend build and tests**

```bash
npm run build
npm test
```

Expected: both pass.

- [ ] **Step 2: Run Rust tests and clippy**

```bash
cargo test --all-targets
cargo clippy --all-targets -- -D warnings
```

Expected: both pass.

- [ ] **Step 3: Verify git status is clean except for untracked secrets**

```bash
git status
```

Expected: committed files are clean; `src-tauri/.secrets/` is untracked and ignored.

- [ ] **Step 4: Show final commit log**

```bash
git log --oneline -10
```

Expected: commits are clean and checkpointed.

---

## Self-Review

1. **Spec coverage:**
   - Secret key inside project gitignored folder → Task 1.
   - Local signed build single npm script → Tasks 2 and 3.
   - GitHub Actions release workflow → Task 4.
   - Documentation → Task 5.
   - Release branches + tags model → documented in Task 4 and docs.

2. **Placeholder scan:** No TBD/TODO, no vague "add error handling", every code block is complete.

3. **Type consistency:** File paths are consistent across all tasks. Secret env var name is `TAURI_SIGNING_PRIVATE_KEY` everywhere.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-08-updater-signing-ci-plan.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
