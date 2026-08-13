# Games Bar — "All Games" Slot Design

Date: 2026-08-13
Status: Approved (design), pending implementation

## Goal

Add an "All Games" entry to the games bar (`GamesBar`), Battle.net-style, so the
user can return to the games overview (grid + filters) directly from the bar
instead of only via the MainNav "Games" button.

## Current State

- `src/components/GamesBar.tsx` renders pinned game icons (44px tiles, dimmed
  when not installed, blue underline on selection) plus a `+` manage-pins button.
- The overview (`GamesHome` grid + `FiltersPanel`) renders when
  `selectedGameId === null` in `App.tsx`.
- The only existing path back to the overview is the MainNav "Games" button
  (`onGamesClick`), which clears the selection when already in the games view.

## Design

### Behavior

- New leftmost slot in the bar, rendered before the pinned game icons. The bar
  already scrolls horizontally (`overflow-x: auto`), so the slot simply stays
  first in flow.
- Click deselects the current game (`onSelect(null)`); `App.tsx` already routes
  this through `handleSelectGameIcon`, which sets `activeView: 'games'` and
  clears the selection, showing the overview grid + `FiltersPanel`.
- Active state: when `selectedGameId === null`, the slot shows the same blue
  underline as a selected game icon (`.games-bar-icon.selected`).
- The slot always renders at full opacity (reuses the `.installed` styling)
  since the library is always available.
- A thin vertical divider (1px × 24px, `--border-default`) separates the slot
  from the pinned icons; rendered only when at least one pinned game is visible.
- Hover tooltip reuses the existing `.games-bar-tip` pattern with the label
  "All Games" / "Tous les jeux".

### Code Changes

- `src/components/GamesBar.tsx`
  - New prop: `isOverviewSelected: boolean`.
  - Widen the `onSelect` prop type from `(gameId: string) => void` to
    `(gameId: string | null) => void` so the slot can deselect.
  - Render the slot as a `.games-bar-item` containing a `button.games-bar-icon
installed` (+ `.selected` when `isOverviewSelected`) with a `LayoutGrid`
    lucide icon (size 20), `aria-label` from i18n, and the `.games-bar-tip`
    tooltip span.
  - Click handler: `onSelect(null)` — no new callback prop needed.
  - Divider element after the slot when `visibleGames.length > 0`.
- `src/App.tsx`
  - Pass `isOverviewSelected={selectedGameId === null}` to `GamesBar`.
- `src/index.css`
  - New rule `.games-bar-divider` (1px wide, 24px tall, `background:
var(--border-default)`, `flex-shrink: 0`). All other styling reuses
    `.games-bar-icon`, `.installed`, `.selected`, `.games-bar-tip`.
- `src/locales/en.json` + `src/locales/fr.json`
  - New key `gamesBar.allGames`: "All Games" / "Tous les jeux".
  - `src/lib/i18n-coverage.test.ts` enforces key parity automatically.

### Out of Scope

- No change to keyboard navigation (`handleNavigate` still cycles pinned games
  only).
- No change to the `+` manage-pins button or `PinManagerModal`.
- No changes to Rust/backend.

## Testing

- No new component test: the project has no component tests, only colocated lib
  tests (Vitest). The i18n-coverage test validates the new locale key.
- Existing suite must stay green: `npm test`, `npm run lint`, `npm run build`,
  `npm run format:check`.

## Error Handling

None required — no IO, no fallible operations.
