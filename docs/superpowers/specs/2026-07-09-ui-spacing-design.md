# UI Spacing & Padding Overhaul — Design Spec

## Goal

Make the Pandawan Launcher UI feel properly spaced, balanced, and premium by applying a consistent 4/8-point spacing scale, fixing cramped or misaligned regions, and replacing arbitrary layout values with intentional grid/flex patterns.

## Current Pain Points

1. **Title bar overflow** — `WindowControls` buttons use `p-3` inside a `h-7` bar, so controls exceed the bar height.
2. **Arbitrary panel margins** — `GamePage` right cover uses `m-4`, leaving the left and right panels visually unbalanced.
3. **Flex-math layout** — `GamePage` uses `lg:max-w-[55%] xl:max-w-[58%]` instead of a CSS Grid ratio.
4. **Inconsistent content padding** — settings header/content/footer use `p-6`, sidebar uses `p-4`, footer uses `p-4`.
5. **Small card gaps/padding** — game grid uses `gap-4` and cards use `p-3`, which feels tight for a launcher.
6. **Game-icon selected indicator** — absolute `-bottom-2` pip risks clipping and sits outside the icon row.
7. **App root uses `h-screen`** — can cause viewport issues; better to fill parent with `h-full`/`min-h-full`.

## Design Decisions

### Spacing Scale

- Base unit: **4px / `0.25rem`** (Tailwind default).
- Primary increments: `2 (8px)`, `3 (12px)`, `4 (16px)`, `6 (24px)`, `8 (32px)`.
- Avoid one-off values like `ml-2`, `mb-3`, `px-2 py-2` where a standard increment communicates the same intent.

### Global Layout

- App root: `h-full flex flex-col` so it always fills the Tauri window.
- Content areas: `p-8` (32px) outer padding as the default.
- Section gaps: `gap-6` or `gap-8`.
- Max content width: keep `max-w-6xl` / `max-w-4xl` but align padding.

### Component-Specific Changes

#### TitleBar / WindowControls

- Increase bar height to `h-9` (36px).
- Make each control button `h-full px-3` so it fills the bar vertically and stays centered.
- Keep `no-drag` wrapper.

#### AppTopBar

- Outer container stays `px-8`.
- Row 1 (`h-20`): right controls `gap-2`, remove `ml-2` on profile; rely on gap.
- Row 2 game-icon panels: `px-3 py-2`, remove `mb-3`; rely on content padding below.
- Selected indicator moved inside the icon button to avoid overflow/clipping.

#### GamesHome

- Grid: `gap-6`.
- Card: `p-5`, internal `gap-4`.
- Status row: `mt-3`.

#### GamePage

- Layout: CSS Grid `grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-8 p-8`.
- Left panel: flex column, scroll area takes remaining space; bottom action bar spans full width.
- Right panel: no arbitrary margin; image fills rounded container.
- Patch-note bullets: use `gap-3` with a centered bullet, remove magic `mt-2`.

#### News

- Container: `space-y-6`.
- Article card: `p-8`, image/content gap `gap-8`.
- Internal title/description spacing: `mb-3`, `mb-4`.

#### Settings

- Sidebar, header, content, footer all use `p-6` consistently.
- Content area can breathe with `space-y-8` between setting groups.
- Toggle rows use `py-3`.

#### AddGameModal

- Game grid: `gap-5`.
- Game card: `p-5`, internal `gap-5`.
- Footer action buttons aligned in height.

## Non-Goals

- No color palette changes.
- No font changes.
- No new dependencies.
- No functional logic changes.
- No icon library swap (Lucide stays).

## Verification

- `npm run build` must pass (TypeScript + Vite).
- UI must render without overflow/clipping in the main views (GamesHome, GamePage, News, Settings, AddGameModal).
