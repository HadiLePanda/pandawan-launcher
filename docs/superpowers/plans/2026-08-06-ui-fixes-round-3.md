# Pandawan Launcher — UI Fix Round 3 (two-bar header, GamesBar redesign, pinning, filter rework)

## Goal

Fix the broken merged header (split back into a Windows title bar + a main nav bar), redesign
the horizontal games bar to match the Battle.net reference (background panel, tile icons,
overview grid button), turn the "Add game" modal into a pin-manager for the games bar with
persistence, and rework the filter panel to Battle.net's single-select list with counts,
accent line, and a heading above the cards.

**Execution model:** 5 sequential batches, ONE subagent per batch. Each batch subagent
implements AND self-verifies (runs `npm test`, `npx eslint src --ext .ts,.tsx`,
`npm run build`, and `npx prettier --write` on its own touched files) — there is NO separate
QA subagent. Each subagent commits its own batch with the given message. Dispatch batches in
order 1 → 5; later batches assume earlier ones are committed.

**Branch:** `dev`. Locales: `src/locales/en.json` + `src/locales/fr.json` only.
`src/lib/i18n-coverage.test.ts` enforces key parity AND rejects unused keys in `en.json` —
every key add/remove listed below is mandatory.

**Reference screenshots (already analyzed, do not re-request):**
- `170134.png` (old iteration): games bar = full-width row with its own surface background;
  icons are ~40px rounded-square tiles with a surface tile background; selected tile has a
  colored (green) outline; the "+" tile is a dashed-border square.
- `223641.png` (Battle.net): filter panel = search input on top, then a single-select list
  (Mes jeux / Installé / Favoris — separator — Tous les jeux / … — separator — MacOS) with a
  muted count number right-aligned on each row; the selected row has a blue LEFT vertical
  accent bar + highlighted background; a large heading with the selected filter's name sits
  above the card grid; card = art, name, genre directly underneath with tight spacing.

---

## Root-cause notes (hand these to the relevant subagents)

1. **Header anchoring bug:** `.app-topbar` is `display: flex` and `.app-topbar-row` is its
   child with no `width: 100%`/`flex: 1`, so the row shrinks to content width and the
   buttons + window controls land in the middle of the bar. The two-bar rewrite in Batch 1
   eliminates this — but any flex bar row MUST get `width: 100%`.
2. **Lingering icon on game details page:** `GameRail` (left icon rail) is rendered in
   `App.tsx` when `activeView === 'games' && selectedGameId`. Batch 4 deletes the component,
   its render branch, and its CSS.

---

## i18n key changes (en.json + fr.json, BOTH files)

Add:
| key | en | fr |
|---|---|---|
| `titleBar.serverUnreachable` | `Server unreachable` | `Serveur injoignable` |
| `gamesMenu.library` | `Library` | `Bibliothèque` |
| `gamesBar.overview` | `Overview` | `Vue d'ensemble` |
| `addGameModal.manageTitle` | `Manage games` | `Gérer les jeux` |
| `addGameModal.togglePin` | `Show in games bar` | `Afficher dans la barre de jeux` |
| `common.done` | `Done` | `Terminé` |

Remove (must be gone from both files or the coverage test fails):
- `app.connectionBanner` (replaced by the concise title-bar status)
- `gamesMenu.home`
- `filters.searchPlaceholder`
- `addGameModal.title`, `addGameModal.subtitle`, `addGameModal.install`
  (check no other references remain before deleting)

Keep unchanged: `filters.all`, `filters.installed`, `filters.reset`,
`gamesMenu.downloads`, `gamesBar.addGame`, `topBar.*`, `common.retry`, `common.cancel`.

Note: `filters.all` label should read `All games` / `Tous les jeux` (update the VALUES in
place — the key stays). `gamesBar.addGame` tooltip on the "+" button now means "manage
pinned games"; update VALUES to `Manage games` / `Gérer les jeux` if the subagent prefers,
or keep — pick ONE and be consistent between the two files.

---

## Batch 1 — Two-bar header (TitleBar + MainNav)

**Files:** `src/components/AppHeader.tsx` (rewrite), `src/components/WindowControls.tsx`
(read-only reference), `src/App.tsx`, `src/index.css`, `src/locales/en.json`,
`src/locales/fr.json`.

**Design (locked):**
- **TitleBar** (top, 32px, `data-tauri-drag-region`, `bg: var(--canvas-default)`):
  - Left: status zone. A 2px line across the very top of the bar
    (`box-shadow: inset 0 2px 0 0 transparent` default; `var(--ember)` when the catalog is
    unreachable). Next to it, only when unreachable: `ServerOff` icon 14px `var(--ember)` +
    concise text `t('titleBar.serverUnreachable')` (`font-size: .75rem`, `color:
    var(--ember)`) + a small ghost retry button (icon only, `RefreshCw` 12px). Nothing else
    on the left — the bar stays empty otherwise.
  - Right: `<WindowControls />` hard-anchored to the right edge
    (`margin-left: auto`, `height: 32px`).
  - Double-click on empty bar background toggles maximize; guard with
    `e.target.closest('button, a, input, .no-drag')`.
- **MainNav** (below TitleBar, 48px, `bg: var(--surface-default)`, no border-bottom):
  - Left: app logo + tabs (Games/News/Store) exactly as they are now (blue active tab,
    underline at `bottom: 6px`, no transforms).
  - Right: downloads button (conditional), notifications button, settings gear, profile
    avatar menu, in that order, `margin-left: auto`.
  - Downloads + notifications buttons get `min-width: 48px` (wider); other buttons keep
    `min-width: 40px`.
- Games tab dropdown: open delay reduced from 400ms to **120ms** (close grace stays 150ms);
  first item label becomes `t('gamesMenu.library')`.
- Connection banner moves OUT of the nav entirely — it now lives only in the TitleBar status
  zone. Delete the `ConnectionBanner` component and the flex-1 banner slot.
- Everything else in the current `AppHeader` (profile menu, downloads progress strip,
  `data-panel-trigger` pattern, badges, avatar) carries over unchanged into MainNav.

**Orders:**
1. Rewrite `AppHeader.tsx` to export two components: `TitleBar` (props:
   `catalogUnreachable`, `catalogSource`, `onRetry`, `onDoubleClick`) and `MainNav` (all the
   current nav props). Keep them in the same file.
2. `App.tsx`: render `<TitleBar ... />` then `<MainNav ... />` as the first two children;
   pass `onDoubleClick={() => windowTitlebarToggleMaximize()}` to TitleBar only.
3. CSS: replace `.app-topbar`/`.app-topbar-row` with `.title-bar` (32px, flex, `width:
   100%`, status line via `box-shadow`) and `.main-nav` (48px, flex, `width: 100%`,
   `padding: 0 12px`); add `.title-bar-status` (flex, align center, gap 6px, padding-left
   12px, min-width 0), `.title-bar-status-line` modifier classes `.status-ok` /
   `.status-error` toggling the `box-shadow` color; `.main-nav-right { margin-left: auto;
   display: flex; gap: 4px; }`; `.topbar-btn-wide { min-width: 48px; }`. Delete
   `.banner-inline` and `.window-controls-row` (fold into `.title-bar`).
4. Update `.notifications-panel` and `.downloads-popup` `top:` from `40px` to `80px`
   (32px title bar + 48px nav).
5. i18n: add `titleBar.serverUnreachable`, `gamesMenu.library`; remove
   `app.connectionBanner`, `gamesMenu.home`.
6. Self-verify, then commit: `refactor(header): split into TitleBar status bar and MainNav`.

**Guardrails:** do not touch `GamesBar`, `FiltersPanel`, `GamePage`, store, or pinning logic.
Notifications panel visuals stay pixel-identical.

---

## Batch 2 — GamesBar redesign + pinned-games state

**Files:** `src/components/GamesBar.tsx`, `src/lib/pinned-games.ts` (new), `src/lib/store.ts`,
`src/App.tsx`, `src/index.css`, `src/locales/en.json`, `src/locales/fr.json`.

**Design (locked):**
- Games bar gets its own panel background like the reference: `background:
  var(--surface-default)`, height 64px, `padding: 0 16px`, `gap: 10px`. Icons become tiles:
  44px rounded-square (`border-radius: 8px`) with a tile background `var(--surface-light)`
  behind the image (image covers the tile). Selected tile: 2px outline `var(--action)`
  (green, as in the reference) via `box-shadow: 0 0 0 2px var(--action)`. Uninstalled:
  `opacity .55` + `grayscale(60%)` on the tile. "+" tile: 44px square, dashed 1px
  `var(--border-strong)` border, transparent bg, `Plus` icon — NOT a circle anymore.
- New left-most button: overview grid (`LayoutGrid` lucide, 20px) in the same 44px tile
  style with a surface-light background; tooltip `t('gamesBar.overview')`; click =
  go to games overview (same behavior as clicking the Games tab while in games view:
  clear `selectedGameId`).
- Pinning: the bar shows ONLY pinned games. New module `src/lib/pinned-games.ts`:
  ```ts
  const STORAGE_KEY = 'pandawan.pinnedGameIds';
  export function loadPinnedIds(): string[] | null; // null = never saved
  export function savePinnedIds(ids: string[]): void;
  ```
  (JSON in localStorage, try/catch, return null on parse failure.)
- Store (`src/lib/store.ts`): add `pinnedIds: string[]` (default `[]`), plus actions
  `initPinnedIds(allIds: string[])` — reads `loadPinnedIds()`; if null, defaults to
  `allIds` and saves; if saved, intersects with `allIds` and saves the pruned list — and
  `togglePinnedId(id: string)` — flips membership and saves. Call `initPinnedIds` at the
  end of `loadCatalog()` (games list is stable between loads; this also satisfies "loaded
  before the splash hides" because `loadCatalog` already runs inside the splash-gated init
  in `App.tsx`). localStorage is synchronous — no async needed.
- `App.tsx`: pass `games.filter((g) => pinnedIds.includes(g.info.id))` to `GamesBar`.

**Orders:**
1. Create `src/lib/pinned-games.ts` as specced; add a colocated `pinned-games.test.ts`
   (load/save round-trip, null when unset, corrupt JSON → null; mock localStorage with a
   simple in-memory stub — check how other tests mock browser APIs first and match that
   pattern).
2. Store: add `pinnedIds`, `initPinnedIds`, `togglePinnedId`; wire `initPinnedIds` into
   `loadCatalog`.
3. `GamesBar.tsx`: new props `onOverview: () => void`; render overview tile first, then
   pinned game tiles (unchanged semantics), then the dashed "+" tile. Keep the 1s CSS
   tooltip pattern.
4. CSS: rework `.games-bar*` per the design above; add `.games-bar-tile`,
   `.games-bar-tile.selected`, `.games-bar-tile-add`, `.games-bar-tile-overview`; delete the
   old `.games-bar-icon*`/`.games-bar-add` rules.
5. `App.tsx`: overview handler `() => handleSelectGameIcon(null)` equivalent (clear
   selection, stay in games view); filter games by `pinnedIds` for the bar.
6. i18n: add `gamesBar.overview`.
7. Self-verify, then commit: `feat(gamesBar): panel redesign, overview tile, pinned games state`.

**Guardrails:** do not change `AddGameModal` yet (Batch 3), do not touch filters (Batch 4).
The bar still ignores `gameFilters` by design.

---

## Batch 3 — AddGameModal → pin manager

**Files:** `src/components/AddGameModal.tsx`, `src/App.tsx`, `src/index.css`,
`src/locales/en.json`, `src/locales/fr.json`.

**Design (locked):** the modal is now "which games appear in my games bar". It lists ALL
catalog games (installed or not) with a pin toggle per row. No install action, no footer
separator, no version, no developer name, no subtitle.

**Orders:**
1. Rewrite `AddGameModal.tsx`:
   - Props: `{ isOpen, onClose, games: GameInfo[], pinnedIds: string[], onTogglePin:
     (id: string) => void }`.
   - Title `t('addGameModal.manageTitle')`, close X. NO subtitle paragraph.
   - Search row: proper padding — container `padding: 16px 24px 0`; input with
     `padding-left: 38px` and a `Search` icon 16px absolutely positioned at `left: 12px`
     INSIDE a relative wrapper (fixes the icon/placeholder overlap); keep
     `t('addGameModal.searchPlaceholder')`.
   - List: one row per game (icon 32px, name, size via `formatBytes` — NO developer, NO
     version), and on the right a toggle: reuse the existing settings toggle-switch markup
     pattern (find the class used by `ToggleSetting` in `Settings.tsx` and reuse it) bound
     to `pinnedIds.includes(game.id)`, calling `onTogglePin(game.id)`, with
     `aria-label={t('addGameModal.togglePin')}`.
   - Footer: only a right-aligned `common.done` primary-ghost button closing the modal. Add
     class `pin-modal` on the modal root and CSS `.pin-modal .modal-footer { border-top:
     none; }` (scoped, like `settings-modal`; do NOT change the global rule).
   - Empty-search state: keep existing empty-state block.
2. `App.tsx`: pass ALL `games.map(g => g.info)`, `pinnedIds`, and
   `onTogglePin={togglePinnedId}`; delete the old `availableGames`/`onInstall` wiring for
   this modal. (`handleInstallGame` stays for GamePage installs.)
3. i18n: add `addGameModal.manageTitle`, `addGameModal.togglePin`, `common.done`; remove
   `addGameModal.title`, `addGameModal.subtitle`, `addGameModal.install` (grep first —
   remove only if unreferenced).
4. Self-verify, then commit: `feat(addGame): rework modal into pinned-games manager`.

**Guardrails:** Batch 2 must be committed first (store actions must exist). Do not touch the
GamesBar visuals or filters.

---

## Batch 4 — Filter rework + overview heading + GameRail removal

**Files:** `src/lib/game-filters.ts`, `src/lib/game-filters.test.ts`,
`src/components/FiltersPanel.tsx`, `src/components/GameRail.tsx` (delete), `src/App.tsx`,
`src/components/GamesHome.tsx`, `src/index.css`, `src/locales/en.json`,
`src/locales/fr.json`.

**Design (locked, per Battle.net reference):**
- **Single-select filter model.** `GameFilters` becomes
  `{ selection: 'all' | 'installed' | \`platform:${string}\`, search: string }`.
  Exactly one option is active at a time across the whole list. `emptyFilters =
  { selection: 'all', search: '' }`. `filterGames` predicates: `installed` → installedIds;
  `platform:x` → `supportedPlatforms` includes x; `search` narrows by name as today.
  `collectPlatforms` and `platformLabel` stay. Delete the `FilterOption`/`sections`
  discriminated-union complexity in `FiltersPanel.tsx` — a flat ordered list is enough.
  Keep the extensibility comment updated (adding a filter = new selection value + predicate
  + list entry).
- **Panel layout:** width 240px (Battle.net-like), `padding: 12px`. Search input: loupe
  `Search` icon 14px INSIDE on the left (`padding-left: 30px`), NO placeholder text
  (`placeholder` attribute removed entirely). Keep the adaptive `Filter`/`FilterX` reset
  button.
- **Option rows:** one per line, full width, `padding: 6px 10px`, `font-size: .8125rem`,
  `color: var(--ink-muted)`, transparent bg, `border-radius: 4px`, position relative.
  Selected: `background: var(--surface-hover)`, `color: var(--ink-default)`, plus a blue
  LEFT accent bar via `box-shadow: inset 2px 0 0 0 var(--blue)`.
- **Counts:** each row shows a right-aligned muted count
  (`margin-left: auto; color: var(--ink-dim); font-size: .75rem`) = number of games that
  option would show (ignoring the search text). Compute with `useMemo` keyed on `games` +
  `installedIds` (cache per games-list reference; the memo recomputes when the games array
  changes — that IS the "hook to games list change" requirement; do not build an event
  system).
- **Sections:** `All games`, `Installed` — one `.sidebar-separator` — platforms. No labels,
  tight spacing (options gap 2px, separator margin `6px 0`).
- **Heading above cards:** in the games overview body, render the selected filter's label
  as a heading (`font-size: 1.25rem`, `font-weight: 600`, `color: var(--ink-default)`,
  `padding: 0 24px`, `margin-bottom: 12px`) directly above the cards grid. The label comes
  from the same list data (All games → `t('filters.all')`, Installed →
  `t('filters.installed')`, platform → `platformLabel`).
- **Card density:** in `GamesHome.tsx` CSS, `.game-card-content` gap → `2px` (name/genre
  tighter).
- **GameRail removal:** delete `src/components/GameRail.tsx`, remove its import + render
  branch from `App.tsx`, delete `.game-rail*` CSS. Game details page left slot renders
  NOTHING (details content starts at the left edge).

**Orders:**
1. Rewrite `src/lib/game-filters.ts` per the model above; update
   `src/lib/game-filters.test.ts` (single-select semantics: selecting a platform deselects
   `all`; counts helper if exported — export a `countForSelection(games, installedIds,
   selection)` helper and test it).
2. Rewrite `src/components/FiltersPanel.tsx` per the layout above, including counts and the
   exported selected-label resolution (share it with App via a small exported helper
   `selectionLabel(selection, t)` in `game-filters.ts` — note: `platformLabel` is not
   translated, so the helper takes `t` only for `all`/`installed`).
3. `App.tsx`: delete GameRail import/branch; in the games-overview branch render the heading
   above `<GamesHome />` (wrap them in a flex column; heading from `selectionLabel`).
4. CSS: rework `.filters-panel`, `.filter-option` (+`.selected`, count span), search input
   icon padding; delete `.game-rail*`; adjust `.game-card-content` gap; add
   `.games-home-heading`.
5. i18n: update `filters.all` VALUES to `All games` / `Tous les jeux`; remove
   `filters.searchPlaceholder`.
6. Self-verify, then commit: `feat(filters): single-select list with counts, accent, heading; remove GameRail`.

**Guardrails:** `GamesHome` still receives `filteredGames`; the GamesBar keeps ignoring
filters; search text still applies WITHIN the selected filter.

---

## Batch 5 — Sweep, docs, final verification

**Files:** whatever the sweep finds, plus `AGENTS.md`.

**Orders:**
1. Run `npm test`, `npx eslint src --ext .ts,.tsx`, `npm run build`,
   `npm test -- i18n-coverage`, `npm run lint`, and
   `npx prettier --check "src/**/*.{ts,tsx,css}" "src/locales/*.json" AGENTS.md`. Fix every
   failure in place.
2. Grep for stale references: `GameRail`, `banner-inline`, `gamesMenu.home`,
   `app.connectionBanner`, `addGameModal.install`, `.games-bar-icon`, `.games-bar-add` —
   remove anything left behind (code or CSS).
3. Update `AGENTS.md`: header is now TWO bars (`TitleBar` status bar + `MainNav`); add
   `pinned-games.ts` + pinning behavior note; AddGameModal is a pin manager; filters are
   single-select with counts; GameRail removed.
4. Self-verify, then commit: `chore(sweep): stale references cleanup and AGENTS.md sync`.

---

## Explicit non-goals (tell every subagent)

- No Rust/backend changes, no bindings regeneration (pinning persists in localStorage).
- No new dependencies.
- No fullscreen gradient background, no themes, no splash changes.
- No contacts/friends panel (explicitly excluded by the user).
- Do not redesign anything outside the batch orders.
- Each subagent: one batch, one commit, self-verify only — no review agents.
