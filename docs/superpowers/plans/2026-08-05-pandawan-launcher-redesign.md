# Pandawan Launcher UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the Pandawan Launcher to a clean, minimal, Steam-like game launcher with a left sidebar (games + filters), flat neutral dark surfaces, green Play actions, blue Install/Download actions, and white selection states.

**Architecture:** Preserve the existing Tauri + React + Zustand architecture. The redesign is implemented as a visual refresh plus a few new surface components (sidebar, context menu, downloads page, notifications panel, news article view). State for filters/search persists in the Zustand store; downloads and notification badges derive from existing store state.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Zustand, Vitest (node environment), Lucide React.

---

## File Structure

**Create**

- `src/components/GameSidebar.tsx` — left sidebar with game icon list and filter/search panel.
- `src/components/GameContextMenu.tsx` — reusable context menu for game actions.
- `src/components/DownloadsPage.tsx` — downloads view with active/pending download rows.
- `src/components/NotificationsPanel.tsx` — slide-down notifications panel with unread badge.
- `src/components/NewsArticleView.tsx` — full news article view with back/close and optional banner.
- `src/lib/game-filters.ts` — pure filter/search logic for the games overview.
- `src/lib/game-context.ts` — pure logic for building context-menu items from a game.

**Modify**

- `index.html` — splash screen rewrite.
- `src/index.css` — token updates, remove gradient/glass utilities, adjust radius/animation.
- `src/App.tsx` — layout routing, sidebar visibility, downloads/notifications state.
- `src/components/TitleBar.tsx`, `src/components/AppTopBar.tsx` — Steam-like top bar.
- `src/components/GamesHome.tsx` — card grid using filters.
- `src/components/GamePage.tsx` — detail page with segmented action button and inline meta.
- `src/components/Settings.tsx` — reskin to new visual system.
- `src/lib/store.ts` — filter state, notifications state, downloads badge selectors.
- `src/locales/en.json`, `fr.json`, `de.json`, `es.json` — new labels.

**Remove / deprecate**

- `src/components/GameIconsBar.tsx` — superseded by `GameSidebar.tsx` (can be removed after migration).

---

### Task 1: Design Tokens & Global CSS Cleanup

**Files:**

- Modify: `src/index.css`

- [ ] **Step 1: Update theme tokens**

Replace the `@theme` and `:root` color declarations with the new neutral dark palette and remove purple-tinted values.

```css
@theme {
  --font-sans: 'Geist', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;

  --color-canvas: var(--canvas-default);
  --color-canvas-light: var(--canvas-light);
  --color-canvas-elevated: var(--canvas-elevated);
  --color-surface: var(--surface-default);
  --color-surface-light: var(--surface-light);
  --color-surface-hover: var(--surface-hover);
  --color-surface-elevated: var(--surface-elevated);
  --color-ink: var(--ink-default);
  --color-ink-muted: var(--ink-muted);
  --color-ink-dim: var(--ink-dim);
  --color-ink-subtle: var(--ink-subtle);

  --color-action: var(--action);
  --color-action-hover: var(--action-hover);
  --color-action-light: var(--action-light);
  --color-action-muted: var(--action-muted);
  --color-action-glow: var(--action-glow);

  --color-blue: var(--blue);
  --color-blue-hover: var(--blue-hover);
  --color-blue-muted: var(--blue-muted);

  --color-selection: var(--selection);

  --color-ember: var(--ember);
  --color-ember-muted: var(--ember-muted);

  --color-border: var(--border-default);
  --color-border-strong: var(--border-strong);

  --animate-fade-in: fadeIn 0.15s ease-out;
  --animate-slide-up: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  --animate-scale-in: scaleIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

:root {
  --canvas-default: #0e1013;
  --canvas-light: #14171b;
  --canvas-elevated: #1a1d22;
  --surface-default: #16191d;
  --surface-light: #1e2125;
  --surface-hover: #24282e;
  --surface-elevated: rgba(22, 25, 29, 0.95);
  --ink-default: #f4f4f5;
  --ink-muted: #9ca3af;
  --ink-dim: #6b7280;
  --ink-subtle: #4b5563;

  --action: #22c55e;
  --action-hover: #34d67a;
  --action-light: #6ee7a0;
  --action-muted: rgba(34, 197, 94, 0.14);
  --action-glow: rgba(34, 197, 94, 0.32);

  --blue: #3b82f6;
  --blue-hover: #60a5fa;
  --blue-muted: rgba(59, 130, 246, 0.14);

  --selection: #f4f4f5;

  --ember: #ef4444;
  --ember-muted: rgba(239, 68, 68, 0.14);

  --border-default: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.12);
  --border-selection: rgba(244, 244, 245, 0.6);

  --bg-gradient: none;
}

.light {
  color-scheme: light;
  --canvas-default: #f7f5f0;
  --canvas-light: #ffffff;
  --canvas-elevated: #efebe3;
  --surface-default: #ffffff;
  --surface-light: #f3f1ec;
  --surface-hover: #e9e5dd;
  --surface-elevated: rgba(255, 255, 255, 0.94);
  --ink-default: #1c1917;
  --ink-muted: #78716c;
  --ink-dim: #a8a29e;
  --ink-subtle: #d6d3d1;

  --action: #16a34a;
  --action-hover: #15803d;
  --action-light: #22c55e;
  --action-muted: rgba(22, 163, 74, 0.12);
  --action-glow: rgba(22, 163, 74, 0.22);

  --blue: #2563eb;
  --blue-hover: #1d4ed8;
  --blue-muted: rgba(37, 99, 235, 0.12);

  --selection: #1c1917;

  --ember: #dc2626;
  --ember-muted: rgba(220, 38, 38, 0.1);

  --border-default: rgba(28, 27, 25, 0.08);
  --border-strong: rgba(28, 27, 25, 0.14);
  --border-selection: rgba(28, 27, 25, 0.6);

  --bg-gradient: none;
}
```

- [ ] **Step 2: Remove gradient/glass utility classes**

Delete or comment out: `.glass`, `.glass-strong`, `.glass-subtle`, `.gradient-text`, `.gradient-text-accent`, `.shimmer`, `.btn-glow`, `.hover-glow-accent`, `.divider-gradient`, `.bg-gradient`, `.surface-gradient`, `.card-premium`, `.progress-bar-premium`, and any `bg-gradient` body background. Keep `.btn-press` and focus styles.

- [ ] **Step 3: Adjust radius and animation tokens**

Update component radius to `4px` (buttons), `6px` (cards/icons), `8px` (banners/modals). Remove `glowPulse` and `shimmer` keyframes; keep `fadeIn`, `slideUp`, `scaleIn`. Add a `breathe` keyframe for the splash logo.

```css
@keyframes breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.05);
    opacity: 0.75;
  }
}
```

- [ ] **Step 4: Run build to verify no CSS errors**

Run: `npm run build`
Expected: build succeeds with no PostCSS/Tailwind errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "refactor(css): simplify design tokens and remove gradient/glass utilities"
```

---

### Task 2: Splash Screen Rewrite

**Files:**

- Modify: `index.html`

- [ ] **Step 1: Replace splash markup and styles**

```html
<div id="splash">
  <style>
    #splash {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0e1013;
      font-family: 'Geist', system-ui, sans-serif;
      transition: opacity 0.3s ease;
    }
    .splash-mark {
      position: relative;
      width: 96px;
      height: 96px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .splash-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px solid transparent;
      border-top-color: #f4f4f5;
      opacity: 0.6;
      animation: spin 1.2s linear infinite;
    }
    .splash-logo {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      border: 2px solid #f4f4f5;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #f4f4f5;
      font-weight: 700;
      font-size: 32px;
      animation: breathe 2.5s ease-in-out infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @keyframes breathe {
      0%,
      100% {
        transform: scale(1);
        opacity: 1;
      }
      50% {
        transform: scale(1.05);
        opacity: 0.75;
      }
    }
  </style>
  <div class="splash-mark">
    <div class="splash-ring"></div>
    <div class="splash-logo">P</div>
  </div>
</div>
```

- [ ] **Step 2: Update splash removal script**

Keep the existing 12s failsafe and add a fade-out before removal.

```js
(function () {
  var splash = document.getElementById('splash');
  function hideSplash() {
    if (!splash) return;
    splash.style.opacity = '0';
    setTimeout(function () {
      splash.remove();
    }, 300);
  }
  window.hideSplash = hideSplash;
  setTimeout(hideSplash, 12000);
})();
```

- [ ] **Step 3: Run build to verify splash compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(splash): minimalist circle-P mark with breathing and spinner"
```

---

### Task 3: Top Bar & Title Bar Reskin

**Files:**

- Modify: `src/components/TitleBar.tsx`
- Modify: `src/components/AppTopBar.tsx`
- Modify: `src/components/WindowControls.tsx` (if needed for hover styles)

- [ ] **Step 1: Update TitleBar height and background**

```tsx
export function TitleBar() {
  return (
    <header className="titlebar drag-region">
      <div className="window-controls no-drag">
        <WindowControls />
      </div>
    </header>
  );
}
```

Update CSS `.titlebar`:

```css
.titlebar {
  height: 32px;
  background: var(--canvas-default);
  border-bottom: 1px solid var(--border-default);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 8px;
}
```

- [ ] **Step 2: Update AppTopBar layout and tabs**

```tsx
export function AppTopBar({
  activeView,
  onGamesClick,
  onNewsClick,
  onStoreClick,
  onSettingsClick,
  onPlayerClick,
  onDoubleClick,
}: AppTopBarProps) {
  const { t } = useTranslation();
  const { settings, setSettings } = useLauncherStore();
  const currentTheme = settings?.theme || 'adaptive';

  const navItems = [
    { id: 'games' as const, label: t('topBar.games'), onClick: onGamesClick },
    { id: 'news' as const, label: t('topBar.news'), onClick: onNewsClick },
    { id: 'store' as const, label: t('topBar.store'), onClick: onStoreClick },
  ];

  return (
    <div data-tauri-drag-region onDoubleClick={onDoubleClick} className="app-topbar">
      <div className="app-topbar-row">
        <div className="cluster cluster-md">
          <div className="app-logo">P</div>
          <nav className="cluster cluster-lg no-drag app-topbar-tabs">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={item.onClick}
                className={cn('nav-tab', activeView === item.id && 'nav-tab-active')}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="cluster cluster-sm no-drag">
          <TopBarButton icon={<SunMoon className="w-4 h-4" />} label={t('topBar.themeLabel')} />
          <TopBarButton
            icon={<Download className="w-4 h-4" />}
            label={t('topBar.downloads')}
            badge={downloadsBadge}
          />
          <TopBarButton
            icon={<Bell className="w-4 h-4" />}
            label={t('topBar.notifications')}
            badge={notificationsBadge}
          />
          <TopBarButton icon={<User className="w-4 h-4" />} label={t('topBar.playerProfile')} />
        </div>
      </div>
    </div>
  );
}
```

Add a reusable `TopBarButton` component in the same file or a new file:

```tsx
function TopBarButton({
  icon,
  label,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number | null;
  onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className="topbar-btn" aria-label={label} title={label}>
      <span className="relative">
        {icon}
        {badge != null && badge > 0 && <span className="topbar-badge">{badge}</span>}
      </span>
    </button>
  );
}
```

- [ ] **Step 3: Add CSS for top bar buttons and tabs**

```css
.app-topbar {
  height: 48px;
  background: var(--surface-default);
  border-bottom: 1px solid var(--border-default);
}
.app-topbar-row {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}
.app-logo {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid var(--ink-default);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-default);
}
.nav-tab {
  position: relative;
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0;
  font-size: 0.8125rem;
  color: var(--ink-muted);
  background: transparent;
  border: none;
  cursor: pointer;
}
.nav-tab-active {
  color: var(--ink-default);
  font-weight: 500;
}
.nav-tab-active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--selection);
  opacity: 0.6;
}
.topbar-btn {
  width: 28px;
  height: 22px;
  border-radius: 4px;
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--ink-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.topbar-btn:hover {
  background: var(--surface-hover);
  color: var(--ink-default);
}
.topbar-badge {
  position: absolute;
  top: -5px;
  right: -5px;
  background: var(--blue);
  color: #fff;
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 999px;
  line-height: 1;
}
```

- [ ] **Step 4: Run lint and build**

Run: `npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/TitleBar.tsx src/components/AppTopBar.tsx src/components/WindowControls.tsx src/index.css
git commit -m "feat(topbar): Steam-like top bar with tabs and rectangular action buttons"
```

---

## Task 4: GameSidebar + App.tsx wiring

**Files:**

- Create: `src/components/GameSidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`

Replaces `GameIconsBar` (deprecate, delete file + its CSS) with a 220px left sidebar shown only when `activeView === 'games'`.

- [ ] **Step 1: Create GameSidebar**

Vertical list of games: 32px icon button per game. Selected = full-white icon + 1px `var(--border-default)` border; installed & unselected = normal; not installed = `opacity: 0.55` + muted. Right-click (onContextMenu) opens `GameContextMenu` (component from Task 9 — for this task render it via a stub prop or local state wired to the same menu API). Below a hairline separator, host the filter panel from Task 5.

```tsx
// src/components/GameSidebar.tsx
interface GameSidebarProps {
  games: GameInfo[];
  installedIds: Set<string>;
  selectedGameId: string | null;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, gameId: string) => void;
  filters: React.ReactNode; // filter panel injected
}
```

CSS: `.game-sidebar { width: 220px; flex-shrink: 0; padding: 12px 8px; display: flex; flex-direction: column; gap: 8px; }`, `.game-sidebar-icon { width: 32px; height: 32px; border-radius: 6px; border: 1px solid transparent; opacity: 0.55; filter: grayscale(60%); }`, `.game-sidebar-icon.installed { opacity: 1; filter: none; }`, `.game-sidebar-icon.selected { border-color: var(--border-default); opacity: 1; filter: none; }`, `.sidebar-separator { height: 1px; background: var(--border-default); margin: 8px 0; }`.

- [ ] **Step 2: Wire App.tsx layout**

When `activeView === 'games'` and no `selectedGameId`... actually: sidebar shows on Games tab always (overview and detail), hidden on News/Store/Downloads/Settings. Layout: `<div class="app-body">` flex row: `<GameSidebar/>` + `<main>` content. Remove `GameIconsBar` render; delete `src/components/GameIconsBar.tsx` and its CSS block from index.css.

- [ ] **Step 3: Build**

Run: `npm run build`. Expected: success, no GameIconsBar references.

- [ ] **Step 4: Commit**

`git commit -m "feat(sidebar): vertical game sidebar with installed-state icons"`

---

## Task 5: Filter state + filter panel

**Files:**

- Create: `src/lib/game-filters.ts`
- Create: `src/lib/game-filters.test.ts`
- Modify: `src/lib/store.ts`
- Modify: `src/components/GameSidebar.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Failing test for pure filter logic**

```ts
// src/lib/game-filters.test.ts
import { describe, it, expect } from 'vitest';
import { filterGames, emptyFilters, isDefaultFilters, type GameFilters } from './game-filters';
```

Test cases: `emptyFilters` matches all games; status `'installed'` keeps only installed ids; platform single-select filters; genres multi-select (game matches if it has ANY selected genre); search narrows by name case-insensitively within already-filtered set; `isDefaultFilters` true only for emptyFilters. Use fixture `GameInfo` objects (id, name, genre, platforms: string[]).

Run: `npm run test -- game-filters` — Expected: FAIL (module does not exist).

- [ ] **Step 2: Implement `src/lib/game-filters.ts`**

```ts
export interface GameFilters {
  status: 'all' | 'installed';
  platform: string | null;
  genres: string[];
  search: string;
}
export const emptyFilters: GameFilters = { status: 'all', platform: null, genres: [], search: '' };
export function isDefaultFilters(f: GameFilters): boolean { ... }
export function filterGames(games: GameInfo[], installedIds: Set<string>, f: GameFilters): GameInfo[] { ... }
export function collectPlatforms(games: GameInfo[]): string[] { ... }
export function collectGenres(games: GameInfo[]): string[] { ... }
```

Run: `npm run test -- game-filters` — Expected: PASS.

- [ ] **Step 3: Store persistence**

Add `gameFilters: GameFilters` + `setGameFilters(partial)` to `useLauncherStore` (init `emptyFilters`). Filters persist across navigation naturally (store survives view changes); NOT persisted to disk.

- [ ] **Step 4: Filter panel UI in GameSidebar**

Search input on top; reset ↺ icon button beside it — `.filter-reset` is `opacity: 0.35; pointer-events: none` when `isDefaultFilters`, full ink + hover when active. Categories separated by hairlines: **Status** (All / Installed pills), **Platforms** (single-select pills), **Genres** (multi-select pills). Pills: `background: var(--surface-default); border: 1px solid var(--border-default); color: var(--ink-muted); border-radius: 4px;` selected pill: `color: var(--ink-default); border-color: var(--ink-muted); background: var(--surface-hover)`. No green, no yellow.

- [ ] **Step 5: Commit**

`git commit -m "feat(filters): sidebar search + status/platform/genre filters with persistent state"`

---

## Task 6: GamesHome overview cards

**Files:**

- Modify: `src/components/GamesHome.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Rewrite card grid**

Use `filterGames(games, installedIds, filters)` from store. Card = transparent (no background, no border): 3:4 image (`.games-card-art`, `border-radius: 6px`), name + genre below in muted small text. Uninstalled: `opacity: 0.55; filter: grayscale(60%)`; installed: full. Hover: image `transform: scale(1.04)` + brightness to 1 (`transition: transform 0.25s ease, opacity 0.2s ease, filter 0.2s ease`); uninstalled hover also lifts alpha to 1. Click → navigate to detail (`onSelect(game.id)`), NOT "select".

- [ ] **Step 2: Right-click on card**

onContextMenu → GameContextMenu (wired in Task 9; stub prop until then).

- [ ] **Step 3: Build + lint, commit**

`npm run lint && npm run build`, then `git commit -m "feat(games): transparent overview cards with hover scale and installed-state treatment"`

---

## Task 7: `formatPlaytimeDecimal` + `formatNewsDate` utils

**Files:**

- Modify: `src/lib/utils.ts`
- Modify: `src/lib/utils.test.ts` (create if missing)

- [ ] **Step 1: Failing tests**

```ts
expect(formatPlaytimeDecimal(360)).toBe('0.1h');
expect(formatPlaytimeDecimal(9000)).toBe('2.5h');
expect(formatPlaytimeDecimal(0)).toBe('0h');
expect(formatNewsDate('2026-06-03T10:00:00Z')).toMatch(/3 June 2026|June 3, 2026/); // locale-dependent; assert en-GB with day month year
```

`formatNewsDate` uses `toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })`. `formatPlaytimeDecimal` returns `(seconds/3600)` with 1 decimal + `h`, `0h` for 0.

Run: `npm run test -- utils` — FAIL → implement → PASS.

- [ ] **Step 2: Commit**

`git commit -m "feat(utils): decimal playtime and long-form news date formatters"`

---

## Task 8: GamePage detail redesign

**Files:**

- Modify: `src/components/GamePage.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Two-column layout**

`.game-detail { display: grid; grid-template-columns: 1fr 360px; gap: 24px; padding: 24px; }`. Left column: banner (16:9, max-height 420px, `border-radius: 8px`, bottom scrim gradient overlay with game title + installed/updated status text). Right column (360px fixed): Latest news list (moved from bottom), title "Latest News", compact rows (thumb 64×36, title 2-line clamp, date muted) clicking → NewsArticleView.

- [ ] **Step 2: Action panel below banner (left column)**

`.action-panel { display: flex; align-items: center; gap: 24px; padding: 16px; background: var(--surface-default); border: 1px solid var(--border-default); border-radius: 8px; }`

Segmented primary button: Play (green `#22c55e` bg when installed) / Install (blue `#3b82f6` when not) / Downloading… (blue, progress % inside). Height 44px, min-width 180px, radius 6px left side only; immediately attached ⋮ button sharing the SAME background color, radius right side only, separated by `1px solid rgba(0,0,0,0.25)` divider — opens GameContextMenu.

Meta sections after buttons, in order, each label-above-value: **Game size** (only when not installed, `formatBytes`, hard-drive icon), **Last played** (getTimeAgo), **Play time** (clock icon + `formatPlaytimeDecimal` e.g. `42.3h`). Labels: 11px uppercase muted; values: 14px ink. Settings gear button pushed far right (`margin-left: auto`).

- [ ] **Step 3: Remove description, old news section, old layout CSS**

Delete game description block and bottom news section + their CSS. Remove any purple/gradient/glass classes on this page.

- [ ] **Step 4: Build + commit**

`npm run lint && npm run build`; `git commit -m "feat(game-page): Steam-style banner, segmented action panel, right news column"`

---

## Task 9: GameContextMenu

**Files:**

- Create: `src/lib/game-context.ts`
- Create: `src/lib/game-context.test.ts`
- Create: `src/components/GameContextMenu.tsx`
- Modify: `src/App.tsx` (single menu instance + state)
- Modify: `src/index.css`

- [ ] **Step 1: Failing test for menu item derivation**

```ts
import { deriveMenuItems } from './game-context';
// installed game → [Play, Verify, Patch notes, Game news, Game info, Uninstall]
// not installed → [Install, Game news, Game info]
// downloading → [Cancel download, Game info]
```

Run: `npm run test -- game-context` — FAIL → implement `deriveMenuItems(gameState)` returning `{ id, labelKey, danger? }[]` (labelKeys are i18n keys) → PASS.

- [ ] **Step 2: Context menu component**

Fixed-position menu at cursor, closes on outside click / Escape / item click. `.context-menu { position: fixed; min-width: 180px; background: var(--surface-default); border: 1px solid var(--border-default); border-radius: 6px; padding: 4px; z-index: 100; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }`, items 32px rows, hover `var(--surface-hover)`, danger item (Uninstall) `color: #ef4444` on hover only. Clamp position to viewport.

- [ ] **Step 3: Single menu state in App.tsx**

`const [ctxMenu, setCtxMenu] = useState<{gameId: string; x: number; y: number} | null>(null)`; pass opener down to GameSidebar, GamesHome, GamePage ⋮ button (⋮ opens at button rect). Wire actions: Play/Install call existing game-service; Verify opens VerifyGameModal; Uninstall existing flow; Game news → news view filtered; Patch notes / Game info → detail page (or no-op with TODO if not available).

- [ ] **Step 4: Build + commit**

`git commit -m "feat(context-menu): shared right-click/⋮ game context menu"`

---

## Task 10: NewsArticleView

**Files:**

- Create: `src/components/NewsArticleView.tsx`
- Modify: `src/App.tsx`, `src/index.css`

- [ ] **Step 1: Article view**

Route state: `newsArticle: { gameId, articleId } | null` in App (or store). Layout: header row with ← back (top-left) and ✕ close (top-right), both `.topbar-btn`-style ghost icons. Optional banner image at very top (render only if `article.banner` exists — no empty placeholder space). Then game icon (20px) + game name small muted, article title (28px, ink), date via `formatNewsDate` in JetBrains Mono muted directly under title, divider, body content.

- [ ] **Step 2: Wire entry points**

News rows in GamePage right column and News page click → open NewsArticleView.

- [ ] **Step 3: Build + commit**

`git commit -m "feat(news): article view with back/close chrome and optional banner"`

---

## Task 11: DownloadsPage + topbar badge

**Files:**

- Create: `src/components/DownloadsPage.tsx`
- Modify: `src/App.tsx`, `src/components/AppTopBar.tsx`, `src/index.css`

- [ ] **Step 1: Downloads view**

`activeView` gains `'downloads'`. Full-width view (sidebar hidden). Rows per `activeDownloads` entry: game icon+name, progress bar (blue fill), `overallProgress` %, `speed`, files `completedFiles/totalFiles`, cancel button (calls existing `cancelOperation`). Empty state: download icon muted + "No active downloads" text.

**Constraint:** no pause/resume backend exists (`cancel_operation` only) — omit pause entirely; note in code comment.

- [ ] **Step 2: Topbar downloads button states**

Badge count = `activeDownloads.size` (blue `#3b82f6` badge). Icon: Download (idle, muted) / animated DownloadCloud or pulsing when active (blue). Define in AppTopBar:

```tsx
const activeDownloads = useLauncherStore((s) => s.activeDownloads);
const downloadsBadge = activeDownloads.size;
const notificationsBadge = useLauncherStore((s) => s.unreadNotifications); // Task 12
```

(This fixes the Task 3 snippet: `downloadsBadge`/`notificationsBadge` are store selectors in AppTopBar.)

- [ ] **Step 3: Build + commit**

`git commit -m "feat(downloads): downloads page with live progress rows and topbar badge"`

---

## Task 12: NotificationsPanel + unread state

**Files:**

- Create: `src/components/NotificationsPanel.tsx`
- Modify: `src/lib/store.ts`, `src/components/AppTopBar.tsx`, `src/index.css`

- [ ] **Step 1: Store**

`notifications: LauncherNotification[]` (`{ id, title, body, date, read }`), `unreadNotifications` derived count, `markAllRead()`, `clearNotifications()`, `pushNotification()`. Local state only (no persistence this iteration). Hook `src/lib/notifications.ts` install/update-complete events to also `pushNotification` so the panel has real data.

- [ ] **Step 2: Panel**

Dropdown anchored under notifications button, 320px wide, `position: absolute; top: 100%; right: 0;` — toggle on button click, close on outside click (useEffect document listener) and Escape. Header "Notifications" + mark-all-read + clear. Rows: title, body (2-line clamp), date muted; unread row = `border-left: 2px solid var(--blue)`. Badge = unread count, hidden when 0.

- [ ] **Step 3: Build + commit**

`git commit -m "feat(notifications): dropdown panel with unread badge and local store"`

---

## Task 13: Settings reskin

**Files:**

- Modify: `src/components/Settings.tsx`, `src/index.css`

- [ ] **Step 1: Reskin only**

Replace glass/gradient/purple classes with token palette: sections on `var(--surface-default)` + `var(--border-default)`, radius 8px, controls radius 4–6px. No behavior changes.

- [ ] **Step 2: Build + commit**

`git commit -m "refactor(settings): reskin to neutral token palette"`

---

## Task 14: Locale keys (en/fr/de/es)

**Files:**

- Modify: `src/locales/en.json`, `fr.json`, `de.json`, `es.json`

- [ ] **Step 1: Add keys**

All new UI strings: `nav.games/news/store/downloads`, `filters.*` (search placeholder, status/platform/genre labels, all, installed, reset), `game.play/install/downloading/size/lastPlayed/playTime`, `contextMenu.*` (play, install, verify, patchNotes, gameNews, gameInfo, uninstall, cancelDownload), `news.latest/back/close`, `downloads.title/empty/cancel`, `notifications.title/markAllRead/clear/empty`. Every key in ALL four files, same `{{placeholders}}` as en. FR/DE/ES informal register; French NBSP before `? ! ; :`.

- [ ] **Step 2: Replace any hardcoded strings** in components from Tasks 3–13 with `t()` calls.

- [ ] **Step 3: Verify + commit**

Run: `npm run test -- i18n-coverage` — PASS. `git commit -m "feat(i18n): locale keys for redesigned UI"`

---

## Task 15: Final verification

- [ ] **Step 1:** `npm run test` — all PASS (game-filters, game-context, utils, i18n-coverage, existing suites).
- [ ] **Step 2:** `npm run lint` — clean.
- [ ] **Step 3:** `npm run build` — success.
- [ ] **Step 4:** Manual smoke via `npm run tauri:dev`: splash (no text, breathing+spinner), topbar tabs underline animation, sidebar filters persist across navigation, overview card hover, detail page segmented button + right news, context menu right-click + ⋮, downloads badge, notifications outside-click close.
- [ ] **Step 5:** Add `.superpowers/` to `.gitignore` if not present.
- [ ] **Step 6:** Final commit: `git commit -m "chore: finalize launcher redesign"`

---

## Self-review notes

- Badge naming resolved: Task 11/12 define `downloadsBadge`/`notificationsBadge` as store selectors inside AppTopBar, matching the Task 3 snippet.
- Filter state fields (`status/platform/genres/search`) used identically in Tasks 5, 6, 14.
- No pause/resume invented (backend lacks it) — Task 11 constraint.
- `formatPlaytimeDecimal` (Task 7) is what Task 8's meta panel consumes; existing `formatPlaytime` ("42.3 h") stays for other surfaces.
- Every UI task ends with build/lint; logic tasks are TDD (node-env Vitest, no DOM).
- Deferred: fullscreen gradient background + theme swapping (spec §15).
