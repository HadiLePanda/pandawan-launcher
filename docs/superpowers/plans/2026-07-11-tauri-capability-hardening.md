# Tauri Capability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan inline.

**Goal:** Replace the broad `fs:default` and `shell:default` capability grants with the minimum scoped permissions the launcher actually uses.

**Architecture:** The `default` capability file is the only capability. After auditing frontend and Rust usage, `fs:default` and `shell:default` can be removed because the launcher performs filesystem operations through Rust's `std::fs` (not the Tauri FS plugin) and does not invoke the Shell plugin from either side.

**Tech Stack:** Tauri v2 capabilities JSON.

---

## File map

| File | Responsibility |
|------|---------------|
| `src-tauri/capabilities/default.json` | Scoped Tauri permissions |

---

## Task 1: Audit current plugin usage

**Files:**
- Read: `src-tauri/capabilities/default.json`
- Read: `src-tauri/src/lib.rs` plugin init section
- Search: `src/**` for `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-shell`, `@tauri-apps/plugin-process`, `@tauri-apps/plugin-notification`

- [ ] **Step 1: Confirm no frontend usage of fs/shell plugins**

Expected: only `plugin-http` is used from the frontend (`catalog-service.ts`, `news-service.ts`).

- [ ] **Step 2: Confirm Rust usage of plugins**

Expected: `tauri_plugin_dialog` is used for folder picker; `tauri_plugin_fs`, `tauri_plugin_shell` are initialized but not invoked.

---

## Task 2: Harden the capability file

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Remove `fs:default` and `shell:default`**

The hardened file should be:

```json
{
  "$schema": "../gen/schemas/capabilities.json",
  "identifier": "default",
  "description": "Scoped capabilities for the launcher",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-start-dragging",
    "core:window:allow-is-maximized",
    "dialog:default",
    {
      "identifier": "http:default",
      "allow": [
        { "url": "http://localhost" },
        { "url": "http://localhost:*" },
        { "url": "http://localhost:*/*" },
        { "url": "http://127.0.0.1:*/*" },
        { "url": "https://cdn.pandawancorp.com/**" }
      ]
    },
    "notification:default",
    "process:default"
  ]
}
```

- [ ] **Step 2: Verify JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('src-tauri/capabilities/default.json'))"`
Expected: no output / no error.

---

## Task 3: Verify nothing breaks

- [ ] **Step 1: Rust checks**

Run:
```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```
Expected: no errors.

- [ ] **Step 2: Frontend build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Tests**

Run:
```bash
cargo test --manifest-path src-tauri/Cargo.toml --no-run
npm test
```
Expected: compile/link pass; frontend tests pass.

---

## Task 4: Commit

```bash
git add src-tauri/capabilities/default.json
git commit -m "security(tauri): remove broad fs and shell capabilities"
```

---

## Execution choice

Plan saved to `docs/superpowers/plans/YYYY-MM-DD-tauri-capability-hardening.md`.

**Recommended:** Inline execution in this session because the change is small and isolated.
