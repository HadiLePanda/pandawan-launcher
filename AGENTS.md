# Pandawan Launcher - Agent Guidelines

## Project Overview

This is a Tauri-based game launcher for Pandawan Corp games, built with React and Rust.

### Architecture

- **Frontend**: React 19 + TypeScript + Tailwind CSS + Zustand
- **Backend**: Rust + Tauri
- **Design**: Steam-minimal neutral theme with Battle.net-style sidebar layout

## Key Technologies

### Frontend Stack

- **Build Tool**: Vite
- **Styling**: Tailwind CSS with custom design system
- **State Management**: Zustand
- **Icons**: Lucide React
- **Routing**: React Router DOM

### Backend Stack

- **Framework**: Tauri v2
- **HTTP Client**: reqwest
- **Async Runtime**: Tokio
- **Hashing**: SHA2
- **Type-Safe IPC**: tauri-specta + specta (generates `src/lib/bindings.ts`)

## File Structure

```
src/                          # React frontend
├── components/               # React components
│   ├── AppHeader.tsx         # TitleBar status bar + MainNav
│   ├── GamesBar.tsx          # Pinned games shortcuts bar
│   ├── FiltersPanel.tsx      # Game-grid filters on the overview
│   ├── DownloadsPopup.tsx    # Active downloads popover
│   ├── DownloadsPage.tsx
│   ├── EmptyState.tsx
│   ├── GameContextMenu.tsx
│   ├── GamePage.tsx
│   ├── GamesHome.tsx
│   ├── GamesPage.tsx
│   ├── News.tsx
│   ├── NewsArticleView.tsx
│   ├── NotificationsPanel.tsx
│   ├── PinManagerModal.tsx   # Manage pinned games
│   ├── Settings.tsx
│   ├── StorePlaceholder.tsx  # Store tab placeholder cards
│   ├── UpdateBanner.tsx
│   ├── VerifyGameModal.tsx
│   └── WindowControls.tsx
# Note: the header is two bars (TitleBar status + MainNav); filters are
# FiltersPanel (overview) only — GameRail was removed.
├── lib/                      # Utilities, services, and store
│   ├── store.ts              # Zustand state management
│   ├── catalog-service.ts    # Remote/local/embedded catalog loading
│   ├── cdn.ts                # CDN URL helpers and game info resolver
│   ├── game-service.ts       # Tauri command wrappers for install/launch
│   ├── news-service.ts       # News feed loader
│   ├── commands.ts           # Re-exports generated Tauri Specta bindings
│   ├── bindings.ts           # Auto-generated typed commands/events/types
│   ├── errors.ts             # CommandError / unwrapResult helpers
│   ├── download-channel.ts   # Download progress event mapping
│   ├── updater-service.ts    # Launcher self-update flow (check/download/relaunch)
│   ├── notifications.ts      # OS notifications (install/update complete, update available)
│   ├── i18n.ts               # i18next setup, supported languages, applyLanguage()
│   ├── utils.ts              # Shared helpers (formatPlaytime, etc.)
│   ├── logger.ts             # Lightweight structured logging
│   ├── window.ts             # Custom title-bar window controls
│   └── *.test.ts             # Vitest unit tests, colocated with sources
├── locales/                  # i18next resources (en/fr.json)
├── types/                    # TypeScript types
├── App.tsx                   # Main app
└── main.tsx                  # Entry point

src-tauri/                    # Rust backend
└── src/
    ├── lib.rs                # Main library with commands
    ├── types.rs              # Shared types
    ├── download.rs           # Download manager
    └── patch.rs              # Patching system
```

## Coding Style

### TypeScript/React

- Use functional components with hooks
- Type all props and state explicitly
- Use `@/` path aliases for imports
- Tailwind classes should follow: layout -> sizing -> spacing -> colors -> effects

### Rust

- Use `?` operator for error propagation
- Prefer `Arc<Mutex<T>>` for shared state
- Commands return `Result<T, LauncherError>`; `LauncherError` is a structured enum serialized with `code`/`details`

### Internationalization

- All UI strings go through `t()` (i18next + react-i18next, configured in `src/lib/i18n.ts`); no hardcoded user-facing text in components.
- Locales live in `src/locales/{en,fr}.json`; English is the source of truth and fallback.
- Any new key must be added to both locale files in the same PR — `src/lib/i18n-coverage.test.ts` enforces key parity across locales, rejects unused/stale keys in `en.json`, and checks that translations keep the same `{{placeholders}}` as English.
- Register conventions: FR uses the informal register (tu); French uses a non-breaking space before `?`, `!`, `;`, and `:`.

### Schema Parity

- The Rust `LauncherSettings` struct (`src-tauri/src/types.rs`) and the frontend `LauncherSettings` interface (`src/types/index.ts`) are maintained separately and must stay in sync. `src/lib/settings-schema-parity.test.ts` fails if either side gains a field the other lacks.
- When adding a setting: update the Rust struct, the TypeScript interface, `DEFAULT_SETTINGS` in `src/components/Settings.tsx`, and `DEFAULT_SETTINGS_SHAPE` in the parity test together.
- Removing a setting is backward compatible: serde ignores unknown keys, so settings files written by older builds still load. Covered by `test_launcher_settings_deserialization_ignores_removed_fields` in `src-tauri/src/types.rs`.

## Design System

### Colors

- Canvas: `#0e1013` (main background)
- Surface: `#16191d` (cards/elevated)
- Action (primary): `#22c55e` (green, primary actions)
- Secondary: `#3b82f6` (blue)
- Ink: `#f4f4f5` (primary text)
- Ink Muted: `#9ca3af` (secondary text)

### Typography

- Primary: Geist (sans-serif)
- Mono: JetBrains Mono (code/metadata)

### Components

- Cards: `rounded-2xl bg-surface border border-border`
- Buttons: `btn-press` class for tactile feedback
- Glass: `glass` or `glass-strong` for backdrop blur

## Tauri Commands

Available commands are defined in `src-tauri/src/lib.rs` and exported through `src/lib/bindings.ts`:

| Command               | Args                       | Returns                  | Error type    |
| --------------------- | -------------------------- | ------------------------ | ------------- |
| fetch_game_manifest   | url: String                | GameManifest             | LauncherError |
| install_game          | manifest, baseUrl, onEvent | GameInstallation         | LauncherError |
| check_game_update     | gameId, manifest           | bool                     | LauncherError |
| verify_game           | manifest, installPath      | VerificationResult       | LauncherError |
| launch_game           | gameId: String             | LaunchResult             | LauncherError |
| get_installed_games   | -                          | GameInstallation[]       | LauncherError |
| get_game_installation | gameId: String             | GameInstallation \| null | LauncherError |
| uninstall_game        | gameId: String             | ()                       | LauncherError |
| get_settings          | -                          | LauncherSettings         | LauncherError |
| save_settings         | settings                   | ()                       | LauncherError |
| select_install_folder | -                          | PathBuf \| null          | LauncherError |
| cancel_operation      | -                          | ()                       | LauncherError |
| get_app_data_dir      | -                          | PathBuf                  | LauncherError |

All commands are wrapped by Tauri Specta in a discriminated result union on the frontend:
`{ status: "ok"; data: T } | { status: "error"; error: LauncherError }`. Use `unwrapResult()` in
`src/lib/errors.ts` to convert this into a plain promise that throws `CommandError`.

## Development Workflow

1. **Frontend only**: `npm run dev`
2. **With Tauri**: `npm run tauri:dev`
3. **Build**: `npm run tauri:build`

## Important Notes

- Window is frameless with custom title bar (`AppHeader` component)
- Downloads support resume via HTTP Range requests
- Patching uses SHA256 hash comparison
- Settings persist to JSON in app data directory
- Games are expected to have `-launcher` arg passed
- The `game-exited` event is typed through Tauri Specta and consumed via `events.gameExited` from `src/lib/bindings.ts`. Its payload includes `duration_seconds`; the backend (`record_playtime` in `src-tauri/src/patch.rs`) adds that to the game's accumulated `total_playtime_seconds` and stamps `last_played` on exit. The listener in `App.tsx` refreshes the installation so `GamePage` shows the updated playtime and last-played right away.
- `src/lib/bindings.ts` is generated by the `export_typescript_bindings` Rust unit test only. Debug auto-export is disabled because `specta-typescript` 0.0.12 emits TypeScript shapes (snake_case fields, `| null` optionals, Pascal event names) that drift from the frontend's source-of-truth types in `src/types/index.ts`. It is checked in because the CI/test environment cannot execute the Tauri runtime; refresh it by running the export test on a machine with the Tauri runtime, then reconcile any formatting/casing differences. It was last hand-edited for `GameExited.duration_seconds` because the export test could not run in this environment — it MUST be regenerated/verified on a Tauri-capable machine before the next release.
- The store is intentionally last priority; it is a grid of promotions that links out to the Pandawan Corp store website and is not wired to real purchases or accounts yet.
- In dev, if `VITE_CDN_ORIGIN` is not set, catalog/news/manifests are served from the bundled `examples/` folder via the local example server (`http://localhost:8765`). Run `examples/StartExampleServer.bat` to start it.
- The local example server is CORS-enabled so the launcher can use standard browser fetch for localhost URLs in dev, avoiding Tauri HTTP scope issues.
- As a dev-only fallback, if the remote/local catalog is unreachable, the launcher loads `examples/launcher/catalog.json` and the example manifests as static imports. This lets you test the catalog UI without any running server.
- If the remote catalog is unreachable, the launcher falls back to `public/catalog.json` (embedded) and shows a connectivity banner.
- The logger also appends entries as JSON lines to `launcher.log` in the app log dir (`$APPLOG`), rotated to `launcher.prev.log` at ~1 MB (single previous generation). File writes are fire-and-forget and failures are swallowed. Settings → About has an "Open logs folder" button; its fs permissions are scoped to `$APPLOG` and the shell `open` regex in `tauri.conf.json` only allows URLs and the app log dir.
- Tauri auto-updater:
  - Keys are generated by `npm run keys:generate`, which wraps **`tauri signer generate`**. Do not use the `minisign` CLI: it writes an empty-password key format that the Rust `minisign` crate Tauri uses rejects, and the two formats are not interchangeable.
  - The updater secret key belongs at `src-tauri/.secrets/updater.key` (gitignored, must never be committed). `tauri signer generate` writes it **base64-encoded**, and the Tauri CLI base64-decodes it before parsing — so pass the file contents verbatim and never re-encode or substitute raw minisign text.
  - `src-tauri/updater.pub` is the public key source of truth (committed); `npm run sync:updater-key` (or `tauri:dev`/`tauri:build`) writes `plugins.updater.pubkey` from it. That value is the **base64 of the whole PublicKeyBox** — the same content as `updater.pub` — because `verify_signature()` in tauri-plugin-updater base64-decodes it and then parses it with `minisign_verify::PublicKey::decode`. The inner raw key line does **not** work and breaks verification on every user's update check. Never hand-edit either form.
  - `bundle.createUpdaterArtifacts` must be `true` (it belongs under `bundle`, not `plugins.updater`) or no `.sig` files or `latest.json` are produced and the release silently ships unsigned.
  - `src-tauri/tests/updater_signing_tests.rs` reproduces the updater's own parse of `plugins.updater.pubkey` (base64-decode, then `minisign_verify::PublicKey::decode`), so a malformed key fails in CI instead of breaking every user's update check. `npm run keys:check` separately proves the secret key can actually sign.
  - CI secrets: `TAURI_SIGNING_PRIVATE_KEY` (verbatim contents of `updater.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (only if the key has a password; otherwise the CLI prompts and the build hangs).
  - The release workflow is triggered by semver tags like `v0.1.0`.
