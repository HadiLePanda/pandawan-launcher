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
- The dashboard UI is a **React app in `scripts/dashboard/app/`**, built by its own
  Vite config and served by `dashboard.mjs`. Two Vite builds exist on purpose:
  the repo-root one produces `dist/` (the launcher, ships to players) and this one
  produces `scripts/dashboard/app/dist/` (local admin tool, never ships). The
  separate `outDir` is what makes the ship guarantee structural rather than a
  convention — do not point this build at the launcher's `dist/`, and do not add
  a `bundle.resources` entry for it.
  - `npm run dashboard:build` builds it (typecheck, then Vite), and CI runs the
    same command — the repo's own `tsc` only sees the launcher's `src/`, so
    without that step nothing type-checks this app. It is the **only** dashboard
    client: the hand-written `index.html` / `app.js` / `style.css` it replaced are
    gone. A request for a page when no build is present gets an explicit 503
    naming the build command, not a 404 that reads like a broken route.
  - Adding navigation is a three-step procedure, and it starts by asking **which
    level** the thing belongs to. There is no `panel: true` flag any more: the
    split is enforced by the type system instead.
    - **A level-1 section** (Games / Launcher / Website / Services / Commands) goes
      in `src/components/sections/registry.tsx`. It takes **no props** and renders
      with no rail and no game selection. If the thing you are building acts on a
      game, it is not a section.
    - **A game tab** (inside Games only) goes in
      `src/components/tabs/registry.tsx`, takes `GameTabProps` (gameId, channel,
      scope, onPublished) and is unreachable without a selection. A panel flag was
      removed because "pick a game first" is not a useful thing to say to someone
      who came to publish a launcher or stop a dev server.
    - **A Launcher sub-section** goes in `LAUNCHER_SUBS` in the same sections
      registry, and reuses the game tab's strip.
  - The level-1 section is in `location.hash` (`#games`, `#website`), so a reload
    lands where you were and a section is linkable. `sectionFromHash` is tolerant
    of `/games`, `games?x=1` and a bad percent escape, and falls back rather than
    rendering a missing component. The level-2 sub-tabs stay in localStorage.
  - The dashboard is **not centred on games**. Games is one top-level section; a
    published launcher version and the public website are separate ones with their
    own lifecycles and their own repositories. The hierarchy is two levels deep and
    the distinction is load-bearing:
    - **Top level**: Games · Launcher · Website · Services · Commands.
    - **Inside a game**: Metadata · Artwork · Builds · News · Prune. All scoped to
      the selected game, none of them reachable by typing an id.
    - **Launcher** owns the launcher app's own releases AND the game catalog, since
      the catalog is the launcher's game index — publishing a launcher build and
      registering a game are both "what the launcher shows". It has no game
      selection: it is about the app, not about one game. Its **Catalog** sub-section
      only **registers** games (id and channel) and lists each one's display facts
      read-only, with a link that selects the game and opens its Metadata tab — the
      display fields have exactly one editable home, on the game page, and a second
      editable copy in the catalog is how the two drift apart.
    - **Website** owns `pandawan-launcher-site`, a **separate repository** deployed
      to Cloudflare Pages. It is a sibling checkout, not a subfolder of this one,
      and it must never be edited from here. Its content comes from R2
      (`downloads.json`, written by `publish-launcher.mjs`) proxied through Pages
      Functions, because R2 sends no CORS header — so the site's data and this
      repo's publisher are coupled through the bucket, not through the filesystem.
  - Anything that touches the site repo must fail cleanly when it is absent: it is a
    sibling checkout that a developer may simply not have. Report that as "site
    repo not found at <path>" and disable the action, never as a failure.
- Reads are cached server-side with **two** TTLs, chosen by what is being read.
  Anything that is a round trip to somebody else's infrastructure — a recursive
  bucket listing, a CDN document, a `git`/`wrangler` subprocess, a GitHub release
  list — is cached for **one hour** (`CACHE_TTL_ONLINE_MS`, override
  `DASHBOARD_CACHE_TTL_MS`). These change rarely and the user asked for them not
  to refetch. Only `/api/services` gets the **short** one, `CACHE_TTL_LOCAL_MS` =
  30 s (`DASHBOARD_CACHE_TTL_LOCAL_MS`), because a TCP port probe is a live fact:
  an hour-long cache would report a dev server you just stopped as still running.
  `/api/launcher/status` is deliberately **uncached** so it is always current.
  - `CACHE_TTL_BY_PATH` is the single registry: an endpoint that is not listed is
    not cached at all, so the failure mode of adding a route is "slower", never
    "wrong answer". Adding a cached endpoint means choosing its TTL there.
  - Both TTLs honour **0 as "cache nothing"**. An earlier version used
    `Number(x) > 0 ? … : default`, which silently ignored `=0` — the one value
    that exists to disable caching and tell a caching bug apart from a real one.
  - Cached GETs send `x-cache: hit|miss|stale` and `x-cache-age-ms`. An expired
    entry is **served as `stale` with its true age** while a replacement loads in
    the background; it is never presented as a fresh hit. `?refresh=1` always does
    a real read, including for a value still well inside its TTL — otherwise the
    one button meant to prove the cache is not lying would be answered by the cache.
  - There is deliberately **no polling**; Services' client interval is 10 s and
    the 30 s server cache absorbs it.
  - **Every write invalidates the reads that consume the document it rewrites**,
    on request acceptance and never on child exit, and **a dry run invalidates
    too** — one extra read is cheaper than a panel that lies. Under-invalidation at
    a one-hour TTL costs an hour of a wrong panel, so the blast radius is the rule:
    publish-game rewrites `manifest.json`/`latest.json` and can ship artwork, so it
    drops inventory + meta + art; publish-catalog also re-uploads `news.json`, so
    it drops news too; catalog create/delete change `launcher/catalog.json`, which
    `readGameMetadata` resolves, so they drop meta as well.
- **Editing the dashboard is now three codebases, not one.** The React app lives
  in `scripts/dashboard/app/src/` and must not import from `src/` (that is the
  launcher) or from `scripts/lib/*.mjs` (those are Node modules holding R2
  credentials and use `node:` imports). Contracts that both sides need travel in
  API response instead — the news and metadata field lists are served
  (`NEWS_FIELDS` / `FIELD_SPEC`), never hand-copied.
- A dashboard service with a `bat` field is **opened**, not spawned: `start ""` gives it its own console
  window and the dashboard captures no output from it. A service with `command`/`args` is spawned with
  piped output and keeps a 1500-char `tail`. Do not convert a `bat` service back to a spawn because its
  logs look useful here — truncating `tauri:dev` output to 1500 chars is why the launcher moved to a real
  window. The consequence to respect: an opened service has `pid: null`, so `persist()` filters it out of
  the reap manifest and `stop()` cannot kill it (it only stops offering to reopen one). `forceStop` still
  works because it kills whatever holds the port.
- **Closing the dashboard window stops what it started.** Nothing inside the process runs on an X-close —
  Windows delivers no signal and no `exit` event — so `scripts/dashboard-watchdog.mjs` does the killing: it
  is spawned detached and windowless, holds the write end of the dashboard's stdin, and reaps the manifest
  the moment that pipe closes. The manifest (`%TEMP%\pandawan-dashboard-services.json`, each pid with its
  process start time) also carries **in-flight publish scripts**, so a dashboard that dies mid-upload does
  not leave the upload running with nothing on screen to stop it; the next launch reaps the same file for
  whatever a hard kill stranded, and `run-dashboard.bat stop` reaps it on the spot with `--now` because a
  stranded tree holds no port to find it by. The kill/manifest rules live once in
  `scripts/lib/service-reaper.mjs`, shared by the dashboard and the watchdog.
- The dashboard has two invariants that broke silently once and are now guarded by tests. Respect them
  rather than working around them.
  - **No CSS rule may be nested inside another rule.** A missing `}` in a hand-written stylesheet once
    swallowed 24 following rules into `.svc-log`, which only renders when a dev service dies — so the
    entire game-metadata and news editor shipped unstyled (no padding, no border, the "changed" badge as
    bare text) and nothing looked broken enough to report. `scripts/dashboard/app/styles.test.ts` walks
    the postcss AST of `app/src/styles.css` and fails on any rule that has a rule ancestor, so this
    cannot come back silently. A CSS-only selector is not automatically dead: the same file also checks
    for classes present in the CSS but in no source file under `app/src/`.
  - **The client must handle every SSE event the server emits.** `runScript` in `dashboard.mjs` sends
    `output`, `error` and `done`; `streamScript` in `app/src/lib/api.ts` must consume all three. When it
    matched only `output`, a publisher that exited non-zero rendered identically to one that succeeded —
    the log just stopped mid-sentence. `scripts/dashboard/app/client-contract.test.ts` asserts the event
    sets match and that every `/api/...` path the client calls exists in `dashboard.mjs`.
- **Dashboard design rules.** Every page is the same skeleton and one reference page fixes the look.
  - **The reference is Launcher → Catalog.** Match its structure and styling; when a page looks off, compare it to Catalog rather than inventing a variant.
  - **Skeleton: header → tabs → content.** The header is the title, its facts and refresh; then the tab strip; then content. Exactly **one heading per page**, and no wrapper that restates context — a panel wrapper plus a page heading plus a scope paragraph plus an inner heading is four levels of framing for one header and a form. A page with "News" in its tab and "News" above the form says it twice.
  - **One control kit.** Use the primitives in `app/src/panels/ui.tsx` (`Button`/`Card`/`Field`/`TextInput`/`Select`/`TextArea`) and the ladder pieces in `panels/ladder.tsx`; do not hand-write `dw-button`/`dw-input` markup per page. A change to a control must be one edit, not one per tab.
  - **One media picker.** Icon, banner and screenshots all go through `panels/MediaPicker.tsx`; **no form prints a picture grid inline**. A new media slot is a prop, not a new component (`multiple` only where the field is a list). Upload stays on the single `/api/art/stage` path — never add a second.
  - **Artwork delete refuses while in use.** Artwork is content-addressed and its URLs are referenced by `catalog.json`/`manifest.json`, so deleting a referenced object breaks a live store page. Before offering delete the server re-derives references and either refuses with the field names that hold it or the entry is labelled in-use; deletion is opt-in and its `window.confirm` names the object. Never delete something in use silently.
  - **Prose budget.** Count the on-screen words and treat the count as a ceiling. **Delete** paragraphs, do not shorten them; what survives is labels, values, status words, and exactly one line where a sentence prevents a real mistake. Explanations move behind the info icon so the form scans.
  - **Drawing rules.** Mono only for literal identifiers (versions, build numbers, SHAs, paths, commands, URLs), never ordinary labels; an icon-only control carries an `aria-label` naming its target plus a `title`; colour is never the only signal (pair it with a word or glyph); large surfaces read by fill, not a 1px outline; every action whose effect leaves the machine is opt-in and confirmed by name. An undefined Tailwind v4 token emits no CSS at all, so run the repo's token check before restyling — a missing token presents as a taste complaint.
- The Games section has five sub-tabs (`metadata` / `artwork` / `builds` / `news` / `prune`), declared once in
  `GAME_TABS` (`components/tabs/registry.tsx`) and `GAME_TAB_IDS` (`store/session.ts`) so a tab cannot be
  reachable in one list and unreachable in the other. Metadata is first (the editor people live in) and Prune
  last (the only tab that deletes builds). The open tab persists through the session store and a stale
  persisted id is re-validated against the ids rather than trusted.
- Metadata and news edits keep a local draft under `pandawan.draft.<panel>.<target>`, so a reload mid-edit
  is recoverable, and a `beforeunload` guard warns before losing one. Draft keys are declared once in
  `app/src/lib/storage.ts` (`DRAFT_KEYS`). Dry run stays the **default** for every publish verb, and the diff review screen
  ("Review") is what you read before unticking it — the review is built from the same dirty-tracking
  predicates the publish payload uses (`metaDirtyFlags` / `newsDirtyFields`), so what it shows and what
  gets sent cannot disagree. Two rules that must survive: an emptied **list** field is not a change (a
  comma list cannot express "no genres", and writing `[]` would erase the field), and an image field
  changed only by a staged file must not also resend its unchanged URL.

## Coding Style

### Comments

Rare, and only where the code cannot say it: an invariant, a non-obvious
constraint, a pitfall, a workaround and its reason. Never restate the line below
it, and never narrate the change that produced it.

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
- Glass: `glass` or `glass-strong` for backdrop blur

### Stylesheet layout

- `src/index.css` is the Tailwind entry and nothing else: the import plus six `@import` lines.
  The stylesheet itself is `src/styles/*.css`, and the imports are in the order the blocks were
  written because the cascade depends on it - move a block between files and you change what wins.
- `src/lib/styles.test.ts` guards it: it fails on a rule nested inside another rule, on a class no
  markup file uses, and on a file under `src/styles/` that `index.css` never imports. A mention of a
  class in a doc or a comment does **not** count as usage, which is how 74 dead classes once stayed
  alive here.

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

## Dependency Policy

- **Stay current.** Check what is actually installed against the registry rather
  than trusting the `package.json` range — `npm view <pkg> version` for each, or
  `npm outdated`. A range like `^5.0.14` says nothing about what is on disk.
- **Verify a dist-tag is a real release before adopting it.** `npm view <pkg>
dist-tags` separates `latest` from `next`/`beta`. Only `latest` is a stable
  release; a version that looks alarming (a major jump) is sometimes just a
  prerelease tag and vice versa.
- **Do not bundle a major-version bump with unrelated work.** A red test after
  bumping TypeScript, ESLint or Vitest cannot be attributed if the same commit
  also rewrote a UI. Land majors on their own, with the suite as the safety net.
  `npm audit fix` is different: it stays inside each package's existing major, so
  it is safe to apply alongside feature work — verify with `npm audit --dry-run`
  first that nothing crosses a major boundary.
- **Run `npm audit` and treat production hits as real.** Transitive dev-only
  advisories are much lower priority, but a production dependency carrying a
  known CVE is not. As of this writing `react-router-dom` (CSRF bypass in RSC
  mode), `postcss` (arbitrary `.map` read) and `sharp` (libheif) were all
  production-reachable and have been fixed; keep it at 0.

## System tray

- The tray (`src-tauri/src/tray.rs`) is built in Rust, never from the frontend. **Left click focuses the window** (`on_tray_icon_event`, matched on `MouseButtonState::Up` like Steam and Battle.net); the menu is on right click, which Tauri raises without routing through that handler. Only `on_menu_event` was registered before, so every click opened the menu and the fastest way back from the tray took two clicks. Its menu is Open, a Stop item per running game (labelled with the game's name, reusing the close path), Check for updates and Quit; the tooltip reflects state (plain, a game running, an update available). A state-dependent icon is deliberately absent — it would need image compositing, so the tooltip carries the state.
- `close_to_tray` is the **one** tray setting, and it governs closing only. Minimising always goes to the taskbar, the way Steam and Battle.net do it: `minimize_to_tray` was removed rather than kept as a second switch, because two switches for one tray behaviour is how they drift apart. The rule is the pure `close_action(close_to_tray)` in `src-tauri/src/window_behavior.rs`, returning `CloseAction::Dock` or `CloseAction::Quit`. It defaults to **on**, so the opt-out is "quit on close".
- **A running game no longer vetoes a close.** The old rule docked whatever `close_to_tray` said, which made the toggle a lie — turning it off mid-session still refused to close. Now a close with `close_to_tray` off quits, and the quit path stops each game through the waiter that owns its process (`stop_all_games`), so playtime is still recorded and no game is orphaned. That needs the frontend's confirmation, so the close handler emits `EVENT_QUIT_REQUESTED` and `prevent_close`s; declining leaves the window open rather than closing it behind a cancel.
- `RunningProcess` pairs the kill sender with a `done` receiver that resolves after the waiter writes playtime. Nothing else can prove the write landed, and `app.exit` does not wait for tasks — without the handshake a quit can kill the process mid-write.
- The close policy is mirrored into a `std::sync::Mutex` (`TrayState`) because the `CloseRequested` handler is synchronous and cannot await the tokio mutex the settings live behind.
- Update-available state comes from the frontend: the JS updater store calls `set_launcher_update_available` when it finds, downloads or installs an update, since the plugin is JS-side.
- The one-time tray hint fires on the **first real dock**, not on first run, and is delivered as a real OS notification: the window is hidden at that moment, so an in-app popup would be invisible exactly when it matters. The copy names the Windows 11 icon overflow (`^`) so it does not teach a place the user cannot see. If the notification is denied or fails, the in-app popover is kept for the next time the window is opened. `tray_hint_shown` is set only once the hint was actually delivered, and lives in settings (not the webview store) so clearing webview storage cannot resurrect it.
- `tauri-plugin-single-instance` must be registered **first** (Tauri's requirement) and restores the possibly tray-hidden window, so a second launch never starts a second process that would fight over `settings.json` and the log. It exposes no IPC commands, so it needs no capability entry.
- Tray menu and tooltip strings are English-only in Rust; they sit outside the webview i18n system.

## Important Notes

- Window is frameless with custom title bar (`AppHeader` component)
- Downloads support resume via HTTP Range requests
- Patching uses SHA256 hash comparison
- Settings persist to JSON in app data directory
- Games are expected to have `-launcher` arg passed
- The `game-exited` event is typed through Tauri Specta and consumed via `events.gameExited` from `src/lib/bindings.ts`. Its payload includes `duration_seconds`; the backend (`record_playtime` in `src-tauri/src/patch.rs`) adds that to the game's accumulated `total_playtime_seconds` and stamps `last_played` on exit. The listener in `App.tsx` refreshes the installation so `GamePage` shows the updated playtime and last-played right away.
- `src/lib/bindings.ts` is regenerated with `npm run bindings:export`, which runs the `export-bindings` binary in its own package (`src-tauri/export-bindings/`). It calls `create_specta_builder()` directly instead of launching the app, so it works on any machine with cargo — the earlier in-binary auto-export needed the Tauri runtime and could not run in CI. It is a separate package because the app crate must declare exactly one binary: the macOS bundler copies every binary it finds, and `--target universal-apple-darwin` never produces this one, so keeping it in `src/bin/` failed the whole macOS release with `export-bindings does not exist`. The raw output still needs reconciling: `specta-typescript` 0.0.12 emits tabs, double quotes, snake_case fields, and `| null` where the frontend uses optional. `bindings-parity.test.ts` proves the command list survived that reconciliation; it was last hand-edited for `GameExited.duration_seconds`.
- News images never resolve to nothing. `resolveNewsImage` in `src/lib/cdn.ts` picks the item's own image, else the game's banner, else the game's icon, else `public/placeholder-news.svg`, and never returns an empty string — so the four call sites render an `<img>` unconditionally instead of guarding. `handleImageError` catches a URL that is present but dead, which is the browser's broken-image glyph rather than a placeholder.
- Game artwork has the same three-step fallback in two places, and it must stay a fallback _chain_, not
  two independent picks. On a grid card `CardArt` in `src/components/GamesHome.tsx` holds an index into
  `[bannerUrl, iconUrl]` in `useState` and advances it in `onError`, ending on a gamepad glyph. The state
  is the point: `bannerUrl ? ... : ...` cannot tell "no banner configured" from "the banner 404ed", because
  both are a falsy string, and only the second should fall through to the icon. `GamesBar` pins icons too
  small for a visible chain to be worthwhile, so it hides the image and sets `data-art-failed="true"` on
  the slot, which is the only thing that reveals `.games-bar-icon-fallback`; the default there is
  `display: none`, because a visible-by-default overlay would sit on top of every working icon.
- `.games-grid` uses fixed-width tracks - `repeat(auto-fill, clamp(150px, 16vw, 210px))` - with
  `justify-content: start`, so cards are one size and the row is left aligned. Do not use
  `minmax(…, 1fr)`: a flexible track grows with the window, so a library of two games stretches into
  two very wide cards instead of two cards and some space. `.games-grid > *` is pinned to `width: 100%`
  so a card cannot set its own width and break the equal-column guarantee that keeps the last row
  aligned while the window is dragged.
- The store is intentionally last priority; it is a grid of promotions that links out to the Pandawan Corp store website and is not wired to real purchases or accounts yet.
- `VITE_CDN_ORIGIN` (in `.env`) is the only thing that decides where the CDN is read from; there is no dev-only default. Without it the launcher uses the public R2 bucket. Point it at another bucket or a local static server to develop against something else.
- **Uploading must not re-send what is already published.** `publish-game` reads the _published_ manifest for the version it is writing (one GET) and uploads only the paths whose hash differs, with `uploadFiles` (one `s3 cp` each). A 404 means nothing is published yet, so everything goes up and a first publish is unchanged; the read is safe to trust because the manifest is uploaded **last**, so a version it describes is a version whose files are all there. The flat path has no per-platform list to diff, so `uploadDir` (`cp --recursive`) sends the tree whole. Neither `aws s3 sync` — which diffs the destination — nor re-uploading a 948 MB build is worth it: a republish that changes three files should send three files.
- **An `aws` probe against R2 must pass `--endpoint-url`.** The endpoint is derived from `R2_ACCOUNT_ID` (`https://<account>.r2.cloudflarestorage.com`) and is not in `.env`. Without it the CLI talks to real AWS S3, which answers `AccessDenied` for a bucket these credentials can in fact list — a wrong endpoint and a missing permission are indistinguishable from the output.
- Game _metadata_ (name, description, genres, icon, banner) lives in two places that drift independently: `catalog.json` holds the publisher's display fields and the launcher prefers them, while `manifest.json` holds what the build shipped with. `npm run publish:meta` (`scripts/publish-metadata.mjs`) edits both without re-uploading a single game file, and only touches fields it is given — an unset flag keeps the published value. The dashboard's Games tab drives the same script.
  - The shared field contract is `scripts/lib/metadata-fields.mjs` (`FIELDS`, `CHANNELS`, `IMAGE_FIELDS`); the form, the publisher and the tests all import it so they cannot drift apart. `scripts/lib/apply-metadata.mjs` holds the write decision and `scripts/lib/game-metadata.mjs` the read/merge, both extracted so they are testable without R2 credentials.
  - The field contract is **served** in the API response, the way `/api/news` serves `NEWS_FIELDS`: `FIELD_SPEC` (flag/catalog/label/list/image/long, derived from `FIELDS` + `IMAGE_FIELDS`) travels on both `/api/meta` and `/api/catalog`, and the forms render from it in order. The old client-side copy `scripts/dashboard/app/src/panels/catalog-contract.ts` was deleted — a hand-typed field list drifts silently from the publisher's, which is exactly what the "do not hand-copy a contract" rule above forbids.
  - Display fields have exactly **one editable home**: Games → Metadata. The Launcher → Catalog page only **registers** games (id and channel) and shows each one's display facts read-only, with a link that selects the game and opens its Metadata tab; it must never offer a second editable copy of name/description/developer/genres/icon/banner/screenshots.
  - Screenshots are catalog-only (`manifest: null` in the contract, so they are never written to the manifest) and edited as an **ordered library picker** over the artwork listing (`artwork.mjs` owns the listing, drag-to-reorder is the UI's job). The value stays the comma-joined URL list `catalog-edit.mjs` and the publisher already split, so no new format is needed. A new image reaches the library through the existing artwork upload (`/api/art/stage`); do not add a second upload path.
  - A field is written when _either_ document differs from the requested value. Comparing only the catalog is a real bug: the catalog gets fixed by hand, the manifest keeps the stale name, and every client resolving a build without the catalog renders the old one.
  - Artwork is **content-addressed**: `icon-<hash8>.<ext>`, not `icon.png`. A stable name cannot be cached for long (a client holding it can never learn the file changed), which forced `NO_CACHE` and re-downloaded megabytes of art on every launch; hashing the bytes puts a changed image on a new URL so the old one stays valid forever under the immutable header. Consequences to respect: replacing art never overwrites, superseded objects **accumulate** and cost storage, and the bucket records no mapping from object to field — so the dashboard derives that from the URLs the form loaded. `scripts/lib/artwork.mjs` owns the naming, the extension rules, the upload validation and the listing; `publish-metadata.mjs` imports `artworkObjectName` from it rather than keeping its own copy.
  - The dashboard's artwork picker posts the bytes to `/api/art/stage` and the server writes them to `dist/artwork-staging/`, handing back an absolute path that the **existing** `--icon-file` flow then uploads. Do not add a second upload path. The declared `sizeBytes` is only a pre-filter; the limit is enforced against the decoded bytes, and `safeLocalName` strips everything but the basename so a chosen filename cannot escape the staging directory. SVG is rejected: artwork renders through `<img>` from a remote origin, where an SVG can carry script — the SVG placeholders are safe only because they ship inside the app bundle.
  - `news.json` lives at `public/news.json` (it ships in the bundle as an offline fallback) and is uploaded by `publish:catalog.mjs`. Because of that, `scripts/publish-news.mjs` writes **both** copies: the CDN document _and_ `public/news.json`. Editing only the CDN copy would let the next `npm run publish:catalog` silently revert every news edit. `catalog.json` had the same trap and is now **fixed**: `publish-catalog.mjs` merges additively instead of overwriting. The CDN entry wins for any game it already lists, `public/catalog.json` may only add games the CDN does not have, and a game missing locally is never deleted — so it can no longer revert a `publish:meta` edit. The Games → Catalog button is no longer dangerous. The decision is `mergeCatalog` in `scripts/lib/catalog-merge.mjs` (pure, no R2 imports, covered by `catalog-merge.test.ts`); `validateCatalog` keeps the entry checks and an unreadable remote still refuses to publish rather than writing a catalog that drops every game. `--force` lets the local copy win for games both sides know but still never deletes; there is deliberately no flag that can make a live game vanish. `--dry-run` changes nothing. `news.json` is now guarded by the same rule: `publish-catalog.mjs` reads the CDN feed before uploading and **refuses** when the local copy would remove an item the CDN has (`droppedNewsIds` in `scripts/lib/news-merge.mjs`, covered by `news-merge.test.ts`), because that upload is the last place a news edit made by another route could be silently reverted. `--force-news` overrides it.
  - News editing is `scripts/lib/news-fields.mjs` (the contract) + `scripts/lib/apply-news.mjs` (the ops engine) + `scripts/publish-news.mjs` (the publisher), with the dashboard's News tab driving the last one. Ops are `update`/`create`/`delete`/`move`; `applyNewsOps` never aborts a batch on one bad op but the publisher **fails the whole run** when any op errored, so a rejected edit is never published alongside the accepted ones.
  - The dashboard client cannot import the server's `.mjs` contract modules (they hold R2 credentials and use `node:` imports), so the news field list travels in the `/api/news` response and the form renders from that; do not add a hand-typed copy under `scripts/dashboard/app/`. New-item ids are derived server-side by `uniqueNewsId` for the same reason — the client cannot call the slugger, and a client-chosen id could collide with a published item and merge two announcements.
  - News and game selection now live beside the form they edit (master–detail, `.split`), not behind an id box: typing an id that does not exist fails deep inside a publishing script, which is the failure mode the visual editor exists to remove.
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
  - The launcher's own version lives in four files. `package.json` is the source of truth and `npm run version:set -- <x.y.z>` writes the rest from it, preserving everything around the field; `npm run version:check` runs in CI so they cannot drift. A mismatch ships an app whose About panel and updater document both disagree with the binary, which is how an updater ends up re-offering an update forever.
  - `npm run release -- minor` bumps, commits, tags and pushes; the tag is what starts the signed three-platform build. A dry run is the default and the tree must be clean — **untracked files do not count**, because `git commit` cannot include one, and counting them refused every real release while a dry run passed.
  - One installer per platform, and the **updater** decides which one. Windows ships **NSIS only**: the Tauri updater installs through the NSIS setup, so the `.msi` is a second WiX pass over the same app that nothing here uses — the MSI looks like the "native" choice and is the wrong one to keep. Linux ships `.deb` only. macOS keeps `app` plus `dmg`: the updater's macOS artifact is the `.app.tar.gz`, and a tar.gz is not something a person downloads by hand. Dropping to one bundle type per platform takes a WiX pass off the slowest job, which is where most of the ~15 minutes goes.
