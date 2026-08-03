# Pandawan Launcher — v0.1 Ship-Readiness + i18n Foundation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Fresh coder subagent per task, two-stage review (spec + quality) between tasks, TDD per superpowers:test-driven-development, commits per superpowers workflow. Copy this file to `docs/superpowers/plans/2026-08-03-v01-ship-readiness.md` at execution start.

**Goal:** Finish half-built features (self-update UI, playtime, notifications, logs), add a proper i18n foundation, and fix the broken uncommitted WIP so v0.1 can ship.

---

## Answers to your questions

**Delta patching — you already have it, at file level.** `PatchManager::check_for_updates` (`src-tauri/src/patch.rs:58-86`) hashes every installed file with SHA256 and `patch_game` (`patch.rs:113-229`) downloads **only files that are missing or changed**, then deletes orphaned files from the previous manifest. Downloads resume mid-file via HTTP Range (`download.rs`) and run in parallel. So players never redownload the whole game — only changed files, like Steam at coarse granularity.

What it does **not** do: if a 2 GB file changes by 1 MB, the whole 2 GB file is re-downloaded (no binary/bsdiff deltas inside files). For typical indie games (many small-to-medium files) file-level patching is the right model and download sizes stay small. True binary delta patching is only worth it if your games ship huge monolithic archives — it's a roadmap item in README, not a gap for v0.1.

**Execution with skills + subagents:** this plan is written for superpowers:subagent-driven-development — each task below goes to a fresh coder subagent with TDD, followed by a review subagent, exactly as you asked.

---

## Critical finding: working tree is broken

There are **uncommitted changes** in `src-tauri/src/patch.rs` (refactor to `RwLock<DownloadManager>` + `reconfigure()`) that **do not compile**:

1. `patch.rs:220` — `let installation = Self::build_installation(&manifest, &install_path);` is missing `?` (the function now returns `Result`; line 149 was updated, this one wasn't).
2. `src-tauri/src/lib.rs:414` — `state.patch_manager.cancel();` missing `.await` (`cancel` is now `async`).

Nothing else can proceed until the tree compiles and tests are green.

---

## File structure (what gets created/modified)

- `src-tauri/src/patch.rs`, `src-tauri/src/lib.rs` — compile fixes, playtime tracking
- `src-tauri/src/types.rs` — `GameExited` gains `duration_seconds`
- `src/lib/bindings.ts` — regenerated via `export_typescript_bindings` test
- `src/lib/updater-service.ts` (new) — launcher self-update check/prompt/install
- `src/lib/notifications.ts` (new) — desktop notification helper gated on settings
- `src/lib/logger.ts` — extend with file persistence
- `src/lib/i18n.ts` + `src/locales/{en,fr,de,es}.json` (new) — react-i18next setup
- `src/components/*.tsx` — wrap strings in `t()`, updater banner UI, playtime display
- `src/components/UpdateBanner.tsx` (new)

## Task 0: Fix uncommitted WIP, green baseline

**Files:** `src-tauri/src/patch.rs:220`, `src-tauri/src/lib.rs:414`

- [ ] Add `?` at `patch.rs:220`: `let installation = Self::build_installation(&manifest, &install_path)?;`
- [ ] Change `lib.rs:414` to `state.patch_manager.cancel().await;` (and make the enclosing command `async` if it isn't already)
- [ ] Run `cargo test` in `src-tauri/` — must pass
- [ ] Run `npm run test && npm run lint && npm run build` — must pass
- [ ] Commit the WIP with a message describing the RwLock/reconfigure refactor (confirm with user at first commit)

## Task 1 (Rust): Playtime + last-played tracking, preserve metadata across updates

**Files:** `src-tauri/src/lib.rs:190-271`, `src-tauri/src/patch.rs:88-110`, `src-tauri/src/types.rs`, `src/lib/bindings.ts`

Bug folded in: `build_installation` resets `total_playtime_seconds: 0`, `last_played: None`, `installed_at: now` on **every** patch — an update currently wipes play history.

- [ ] TDD: failing test — patching over an existing installation preserves `total_playtime_seconds`, `last_played`, `installed_at`
- [ ] `build_installation` takes `previous: Option<&GameInstallation>` and carries those fields over
- [ ] `launch_game` (`lib.rs:247-261`): record `Instant::now()` at spawn; in exit task compute elapsed, load installation JSON, add to `total_playtime_seconds`, set `last_played = Utc::now()`, save via `save_installation`
- [ ] Add `duration_seconds: u64` to `GameExited` in `types.rs`; include it in the emit
- [ ] Regenerate `src/lib/bindings.ts` (run `export_typescript_bindings` test); verify `npm run build` still passes
- [ ] `cargo test` green; commit

## Task 2 (Frontend): Launcher self-update flow

**Files:** Create `src/lib/updater-service.ts`, `src/components/UpdateBanner.tsx`; modify `src/App.tsx`, `src/components/Settings.tsx` (About tab)

- [ ] TDD (vitest, mock `@tauri-apps/plugin-updater`): service transitions `idle → checking → up-to-date | available → downloading → ready`
- [ ] `updater-service.ts`: `check()` on startup (non-blocking, from `App.tsx` init); if update available expose `{version, downloadAndInstall()}` with progress events; on complete call `relaunch()` from `@tauri-apps/plugin-process` (already a dependency)
- [ ] `UpdateBanner.tsx`: dismissible banner "Update vX.Y.Z available" with progress bar + "Restart to update" when ready
- [ ] Settings → About: show current version + "Check for updates" button wired to the service
- [ ] `npm run test` green; commit

## Task 3 (Frontend): Wire notifications

**Files:** Create `src/lib/notifications.ts`; modify `src/lib/store.ts` / `src/components/GamePage.tsx` install-complete path; read `NotificationSettings` in `src/components/Settings.tsx` first to map toggles

- [ ] `notifications.ts`: `notify(title, body)` using `@tauri-apps/plugin-notification`, requests permission once, no-ops if the matching settings toggle is off
- [ ] Fire on: game install/update complete; game update detected (existing `check_game_update` flow)
- [ ] Vitest with mocked plugin; commit

## Task 4 (Frontend): Persistent logs

**Files:** Modify `src/lib/logger.ts`, `src/components/Settings.tsx` (About tab); check `src-tauri/capabilities/` fs scope covers app log dir

- [ ] `logger.ts` also appends to `launcher.log` in app data dir via `@tauri-apps/plugin-fs` (rotate at ~1 MB: rename to `launcher.prev.log`)
- [ ] Settings → About: "Open logs folder" button via plugin-shell
- [ ] Vitest for rotation logic; commit

## Task 5 (i18n foundation): react-i18next, all strings wrapped

**Files:** Create `src/lib/i18n.ts`, `src/locales/en.json`, `fr.json`, `de.json`, `es.json`; modify `src/main.tsx` and every component under `src/components/` + `src/App.tsx`

This is the "no rewrite later" foundation: every user-visible string goes through `t()` now, so adding a language later is just a JSON file.

- [ ] Add deps: `i18next`, `react-i18next` (confirm with user before install)
- [ ] `i18n.ts`: init with `en` fallback; `lng` driven by `settings.language` from the store; changing language in Settings calls `i18n.changeLanguage` live
- [ ] `en.json` complete; `fr/de/es.json` scaffolded with translated core strings (nav, settings, common buttons) — untranslated keys fall back to `en` automatically
- [ ] Sweep components in batches (subagent per batch): `TitleBar`, `AppTopBar`/`GameIconsBar`, `GamesHome`/`GamesPage`/`GamePage`, `News`, `Settings`, `AddGameModal`/`VerifyGameModal`/`EmptyState`/`PlayerProfile`, `UpdateBanner`
- [ ] While in Settings: audit the Theme selector — if it doesn't actually restyle the app, hide it for v0.1 (language selector stays, now functional)
- [ ] Vitest: i18n init + key coverage check (no missing `en` keys used in components)
- [ ] `npm run test && npm run build` green; commit

## Task 6: Playtime display

**Files:** `src/components/GamePage.tsx`, `src/lib/utils.ts`

- [ ] Show total playtime ("12.5 h played") + last played date on the game page, consuming `gameExited` events to refresh live
- [ ] Strings go through `t()` (lands after Task 5)
- [ ] Commit

## Task 7: Docs + release dry-run

**Files:** `README.md`, `AGENTS.md`, `docs/RELEASE.md` steps

- [ ] Update README roadmap (updater wired, playtime tracked, i18n added) and AGENTS.md (new services, i18n convention: all UI strings via `t()`)
- [ ] Manual (with user): signed local build, tag `v0.1.0`, verify release workflow drafts release + `latest.json`, upload to CDN endpoint, confirm Task 2's updater detects it

## Out of scope for v0.1
Binary (bsdiff) delta patching, cloud saves, friends/achievements, Discord Rich Presence, mod support, store/account wiring.

## Verification (gate before done)
- `cargo test` (src-tauri), `npm run test`, `npm run lint`, `npm run build` all green
- Manual smoke: install → launch → exit (playtime increments and survives an update); updater banner appears when endpoint serves newer version; notification fires on install complete; switching language re-renders UI live
