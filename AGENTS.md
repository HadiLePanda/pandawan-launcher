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

## Layout

Read the tree when you need it — `ls`, the file explorer, or search. It is
deliberately not duplicated here: a copied listing goes stale the moment a file is
added or removed, and a stale listing is worse than none because it gets trusted.

The few things worth knowing without looking:

- `src/lib/` holds the logic worth reading first — `cdn.ts` (URL building and the
  news-image fallback), `catalog-service.ts` (catalog resolution), `store.ts`.
- `src-tauri/src/lib.rs` is where every Tauri command is defined; the frontend
  wrappers in `src/lib/bindings.ts` are generated from it.
- `scripts/` is local tooling and never ships. `scripts/dashboard.mjs` is the
  control panel for the publish verbs; the `scripts/publish-*.mjs` scripts are
  those verbs. `src-tauri/tests/bundle_contents_tests.rs` fails the build if any
  of it ever reaches a bundle.
- A dashboard service with a `bat` field is **opened**, not spawned: `start ""` gives it its own console
  window and the dashboard captures no output from it. A service with `command`/`args` is spawned with
  piped output and keeps a 1500-char `tail`. Do not convert a `bat` service back to a spawn because its
  logs look useful here — truncating `tauri:dev` output to 1500 chars is why the launcher moved to a real
  window. The consequence to respect: an opened service has `pid: null`, so `persist()` filters it out of
  the reap manifest and `stop()` cannot kill it (it only stops offering to reopen one). `forceStop` still
  works because it kills whatever holds the port.

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

Every command is defined with #[tauri::command] in src-tauri/src/lib.rs and
exported through the generated src/lib/bindings.ts. Treat those two as the source
of truth instead of any table written here - a hand-maintained command list omits
commands the moment one is added, and the omission is invisible until something
fails to resolve at runtime.

All commands are wrapped by Tauri Specta in a discriminated result union on the
frontend: { status: "ok"; data: T } | { status: "error"; error: LauncherError }.
Use unwrapResult() in src/lib/errors.ts to convert this into a plain promise
that throws CommandError.

## Development Workflow

1. **Run the launcher**: `npm run tauri:dev`, or `run-launcher.bat` on Windows
2. **Build**: `npm run tauri:build`

There is no browser mode in the workflow. `npm run dev` still exists for Vite's
own sake, but the app is never meant to be opened in a browser: it calls Tauri
commands that only exist inside the webview, so a browser load fails at the first
IPC call. Do not add a frontend-only path to the dashboard's service list.

## Important Notes

- Window is frameless with custom title bar (`AppHeader` component)
- Downloads support resume via HTTP Range requests
- Patching uses SHA256 hash comparison
- Settings persist to JSON in app data directory
- Games are expected to have `-launcher` arg passed
- The `game-exited` event is typed through Tauri Specta and consumed via `events.gameExited` from `src/lib/bindings.ts`. Its payload includes `duration_seconds`; the backend (`record_playtime` in `src-tauri/src/patch.rs`) adds that to the game's accumulated `total_playtime_seconds` and stamps `last_played` on exit. The listener in `App.tsx` refreshes the installation so `GamePage` shows the updated playtime and last-played right away.
- `src/lib/bindings.ts` is regenerated with `npm run bindings:export`, which runs the `export-bindings` binary (`src-tauri/src/bin/export-bindings.rs`). It calls `create_specta_builder()` directly instead of launching the app, so it works on any machine with cargo — the earlier in-binary auto-export needed the Tauri runtime and could not run in CI. The raw output still needs reconciling: `specta-typescript` 0.0.12 emits tabs, double quotes, snake_case fields, and `| null` where the frontend uses optional. `bindings-parity.test.ts` proves the command list survived that reconciliation; it was last hand-edited for `GameExited.duration_seconds`.
- News images never resolve to nothing. `resolveNewsImage` in `src/lib/cdn.ts` picks the item's own image, else the game's banner, else the game's icon, else `public/placeholder-news.svg`, and never returns an empty string — so the four call sites render an `<img>` unconditionally instead of guarding. `handleImageError` catches a URL that is present but dead, which is the browser's broken-image glyph rather than a placeholder.
- Game artwork has the same three-step fallback in two places, and it must stay a fallback *chain*, not
  two independent picks. On a grid card `CardArt` in `src/components/GamesHome.tsx` holds an index into
  `[bannerUrl, iconUrl]` in `useState` and advances it in `onError`, ending on a gamepad glyph. The state
  is the point: `bannerUrl ? ... : ...` cannot tell "no banner configured" from "the banner 404ed", because
  both are a falsy string, and only the second should fall through to the icon. `GamesBar` pins icons too
  small for a visible chain to be worthwhile, so it hides the image and sets `data-art-failed="true"` on
  the slot, which is the only thing that reveals `.games-bar-icon-fallback`; the default there is
  `display: none`, because a visible-by-default overlay would sit on top of every working icon.
- `.games-grid` uses `repeat(auto-fit, minmax(clamp(150px, 16vw, 210px), 1fr))`, not `auto-fill`. With
  `auto-fill` the empty tracks are kept, so a library of two games renders two 160px cards against a
  window 1000px wide and the page reads as broken rather than empty. `auto-fit` collapses them and the
  cards stretch. `.games-grid > *` is pinned to `width: 100%` so a card cannot set its own width and
  break the equal-column guarantee that keeps the last row aligned while the window is dragged.
- The store is intentionally last priority; it is a grid of promotions that links out to the Pandawan Corp store website and is not wired to real purchases or accounts yet.
- `VITE_CDN_ORIGIN` (in `.env`) is the only thing that decides where the CDN is read from; there is no dev-only default. Without it the launcher uses the public R2 bucket. Point it at another bucket or a local static server to develop against something else.
- Game _metadata_ (name, description, genres, icon, banner) lives in two places that drift independently: `catalog.json` holds the publisher's display fields and the launcher prefers them, while `manifest.json` holds what the build shipped with. `npm run publish:meta` (`scripts/publish-metadata.mjs`) edits both without re-uploading a single game file, and only touches fields it is given — an unset flag keeps the published value. The dashboard's Games tab drives the same script.
  - The shared field contract is `scripts/lib/metadata-fields.mjs` (`FIELDS`, `CHANNELS`, `IMAGE_FIELDS`); the form, the publisher and the tests all import it so they cannot drift apart. `scripts/lib/apply-metadata.mjs` holds the write decision and `scripts/lib/game-metadata.mjs` the read/merge, both extracted so they are testable without R2 credentials.
  - A field is written when _either_ document differs from the requested value. Comparing only the catalog is a real bug: the catalog gets fixed by hand, the manifest keeps the stale name, and every client resolving a build without the catalog renders the old one.
  - `news.json` lives at `public/news.json` (it ships in the bundle as an offline fallback) and is uploaded by `publish:catalog.mjs`.
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
