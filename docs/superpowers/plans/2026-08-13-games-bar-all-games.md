# Games Bar "All Games" Slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Battle.net-style "All Games" slot at the left of the games bar that returns the user to the games overview (grid + filters).

**Architecture:** Pure frontend change. `GamesBar` gains an `isOverviewSelected` prop and a fixed leftmost slot that calls the existing `onSelect(null)` path; `App.tsx` passes the prop; one new CSS rule for the divider; one new i18n key in both locales.

**Tech Stack:** React 19 + TypeScript, Tailwind/CSS custom properties, i18next, Vitest, lucide-react.

**Spec:** `docs/superpowers/specs/2026-08-13-games-bar-all-games-design.md`

---

### Task 1: Add the `gamesBar.allGames` locale key (en + fr)

**Files:**

- Modify: `src/locales/en.json:40-42`
- Modify: `src/locales/fr.json:40-42`
- Test: `src/lib/i18n-coverage.test.ts` (existing — no changes)

- [ ] **Step 1: Add the key to `en.json`**

In `src/locales/en.json`, change:

```json
  "gamesBar": {
    "managePins": "Manage pinned games"
  },
```

to:

```json
  "gamesBar": {
    "managePins": "Manage pinned games",
    "allGames": "All Games"
  },
```

- [ ] **Step 2: Add the key to `fr.json`**

In `src/locales/fr.json`, change:

```json
  "gamesBar": {
    "managePins": "Gérer les jeux épinglés"
  },
```

to:

```json
  "gamesBar": {
    "managePins": "Gérer les jeux épinglés",
    "allGames": "Tous les jeux"
  },
```

(No non-breaking-space rule applies — no `?`, `!`, `;`, or `:` in the string.)

- [ ] **Step 3: Run the i18n coverage test and verify it FAILS**

Run: `npx vitest run src/lib/i18n-coverage.test.ts`
Expected: FAIL — the coverage test rejects unused keys in `en.json`, and
`gamesBar.allGames` is not referenced by any component yet. This is the
failing-test-first step; Task 2 makes it pass.

### Task 2: Add the All Games slot to `GamesBar.tsx`

**Files:**

- Modify: `src/components/GamesBar.tsx` (full replacement, 64 → ~85 lines)

- [ ] **Step 1: Rewrite `GamesBar.tsx` with the new slot**

Replace the entire file with:

```tsx
import { useTranslation } from 'react-i18next';
import { Gamepad2, LayoutGrid, Plus } from 'lucide-react';
import { isGamePinned } from '@/lib/pins';
import type { GameInfo } from '@/types';

export interface GamesBarProps {
  games: GameInfo[];
  installedIds: Set<string>;
  unpinnedGameIds: string[];
  selectedGameId: string | null;
  isOverviewSelected: boolean;
  onSelect: (gameId: string | null) => void;
  onContextMenu: (e: React.MouseEvent, gameId: string) => void;
  onOpenPins: () => void;
}

export function GamesBar({
  games,
  installedIds,
  unpinnedGameIds,
  selectedGameId,
  isOverviewSelected,
  onSelect,
  onContextMenu,
  onOpenPins,
}: GamesBarProps) {
  const { t } = useTranslation();

  const visibleGames = games.filter((g) => isGamePinned(g.id, unpinnedGameIds));

  return (
    <div className="games-bar no-scrollbar" data-testid="games-bar">
      <div className="games-bar-item">
        <button
          type="button"
          className={['games-bar-icon', 'installed', isOverviewSelected ? 'selected' : ''].join(
            ' '
          )}
          aria-label={t('gamesBar.allGames')}
          onClick={() => onSelect(null)}
        >
          <LayoutGrid size={20} />
        </button>
        <span className="games-bar-tip">{t('gamesBar.allGames')}</span>
      </div>
      {visibleGames.length > 0 && <div className="games-bar-divider" aria-hidden="true" />}
      {visibleGames.map((game) => (
        <div key={game.id} className="games-bar-item">
          <button
            type="button"
            className={[
              'games-bar-icon',
              installedIds.has(game.id) ? 'installed' : '',
              selectedGameId === game.id ? 'selected' : '',
            ].join(' ')}
            aria-label={game.name}
            onClick={() => onSelect(game.id)}
            onContextMenu={(e) => onContextMenu(e, game.id)}
          >
            {game.iconUrl ? (
              <img src={game.iconUrl} alt="" className="w-full h-full object-cover rounded-[6px]" />
            ) : (
              <Gamepad2 size={20} />
            )}
          </button>
          <span className="games-bar-tip">{game.name}</span>
        </div>
      ))}
      <button
        type="button"
        className="games-bar-add"
        aria-label={t('gamesBar.managePins')}
        title={t('gamesBar.managePins')}
        onClick={onOpenPins}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
```

Notes on what changed (for review, not extra work):

- `onSelect` prop widened from `(gameId: string) => void` to
  `(gameId: string | null) => void`.
- New `isOverviewSelected: boolean` prop.
- New leftmost `.games-bar-item` with a `LayoutGrid` icon; always carries
  `.installed` (full opacity) and gets `.selected` (blue underline) when the
  overview is showing.
- `.games-bar-divider` rendered only when at least one pinned game is visible.

- [ ] **Step 2: Run the i18n coverage test and verify it PASSES**

Run: `npx vitest run src/lib/i18n-coverage.test.ts`
Expected: PASS — `gamesBar.allGames` is now referenced.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS (all existing tests; no component tests exist for GamesBar).

Note: `npm run build` (tsc) will FAIL at this point because `App.tsx` does not
yet pass the required `isOverviewSelected` prop. That is expected and fixed in
Task 3 — do not commit yet.

### Task 3: Wire `isOverviewSelected` in `App.tsx`

**Files:**

- Modify: `src/App.tsx:407-417`

- [ ] **Step 1: Pass the new prop**

In `src/App.tsx`, change:

```tsx
{
  activeView === 'games' && (
    <GamesBar
      games={pinnedGames}
      installedIds={installedIds}
      unpinnedGameIds={unpinnedGameIds}
      selectedGameId={selectedGameId}
      onSelect={handleSelectGameIcon}
      onContextMenu={handleContextMenu}
      onOpenPins={() => setIsPinsOpen(true)}
    />
  );
}
```

to:

```tsx
{
  activeView === 'games' && (
    <GamesBar
      games={pinnedGames}
      installedIds={installedIds}
      unpinnedGameIds={unpinnedGameIds}
      selectedGameId={selectedGameId}
      isOverviewSelected={selectedGameId === null}
      onSelect={handleSelectGameIcon}
      onContextMenu={handleContextMenu}
      onOpenPins={() => setIsPinsOpen(true)}
    />
  );
}
```

No other change needed: `handleSelectGameIcon` already accepts
`string | null` and routes `null` to the overview (`setActiveView('games')` +
clear selection), and `GamesBar` only renders when `activeView === 'games'`,
so `isOverviewSelected` is true exactly when the overview is showing.

- [ ] **Step 2: Verify the typecheck/build passes**

Run: `npm run build`
Expected: PASS (`tsc && vite build` both succeed).

### Task 4: Add the `.games-bar-divider` CSS rule

**Files:**

- Modify: `src/index.css:324-331` (insert after the `.games-bar-item` block)

- [ ] **Step 1: Add the rule**

In `src/index.css`, immediately after this block:

```css
.games-bar-item {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
```

insert:

```css
.games-bar-divider {
  width: 1px;
  height: 24px;
  background: var(--border-default);
  flex-shrink: 0;
}
```

(`--border-default` already exists — it is used by `.games-bar-tip`.)

- [ ] **Step 2: Verify formatting**

Run: `npm run format:check`
Expected: PASS. If it fails, run `npm run format` and re-check.

### Task 5: Full verification and commit

- [ ] **Step 1: Run the full verification suite**

Run each and confirm green:

```bash
npm test
npm run lint
npm run build
npm run format:check
```

Expected: all four pass.

- [ ] **Step 2: Manual smoke check (frontend only)**

Run: `npm run dev`, open the app, and verify:

- The bar shows a grid icon at the far left with the blue underline active on
  startup (overview is the default view).
- Hovering it for ~1s shows the "All Games" tooltip.
- Clicking a game icon shows the game page (underline moves to that game);
  clicking the grid icon returns to the overview grid + filters panel.
- With all games unpinned, no divider line appears between the grid icon and
  the `+` button.
- Switching to French (Settings) shows "Tous les jeux" as the tooltip.

- [ ] **Step 3: Commit**

```bash
git add src/locales/en.json src/locales/fr.json src/components/GamesBar.tsx src/App.tsx src/index.css
git commit -m "feat(games-bar): add All Games slot to return to overview"
```
