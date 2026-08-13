# Pandawan Launcher — UI Redesign Spec

<!-- impeccable:surface-brief games / operate -->

## 1. Goal & Mode

**Mode:** Operate. The visitor is a player trying to get into a game.

**Goal:** Replace the current generated-looking UI with a clean, professional, minimal game launcher that feels authored — like a refined mix of Steam’s restraint and Battle.net’s game-first layout. The redesign keeps the existing feature set, adds a Downloads page and notifications panel, and tightens every surface so the app gets out of the player’s way.

## 2. Design Principles

1. **Player-first.** The shortest path to “Play” is always visible and obvious.
2. **Content first.** Game artwork, names, and statuses are the heroes; chrome recedes.
3. **Restraint.** One primary action color, one selection accent, flat surfaces, no decorative gradients or glow.
4. **Clarity through state.** Install status is readable at a glance from color, alpha, and icon treatment.
5. **Native craft.** Rectangular Steam-style header buttons, crisp borders, consistent spacing, purposeful motion.

## 3. Global Visual System

### 3.1 Color

Dark mode is the default; light mode mirrors the same structure with inverted values.

| Role            | Dark                     | Light                 | Usage                                                       |
| --------------- | ------------------------ | --------------------- | ----------------------------------------------------------- |
| Canvas          | `#0e1013`                | `#f7f5f0`             | App background                                              |
| Surface         | `#16191d`                | `#ffffff`             | Cards, panels, sidebars, inputs                             |
| Surface hover   | `#1e2125`                | `#f3f1ec`             | Hover backgrounds                                           |
| Border          | `rgba(255,255,255,0.08)` | `rgba(28,27,25,0.08)` | 1px hairlines                                               |
| Border strong   | `rgba(255,255,255,0.12)` | `rgba(28,27,25,0.14)` | Active/focused cards                                        |
| Ink             | `#f4f4f5`                | `#1c1917`             | Primary text                                                |
| Ink muted       | `#9ca3af`                | `#78716c`             | Secondary text                                              |
| Ink dim         | `#6b7280`                | `#a8a29e`             | Placeholders, disabled                                      |
| Action green    | `#22c55e`                | `#16a34a`             | Play / Launch / Confirm / installed status                  |
| Action blue     | `#3b82f6`                | `#2563eb`             | Install / Update / Download actions (user-pinned exception) |
| Selection white | `#f4f4f5`                | `#1c1917`             | Active tab underline, selected icon border                  |
| Error red       | `#ef4444`                | `#dc2626`             | Errors, destructive actions                                 |

**Rules**

- No gradient backgrounds, no glass blur, no glow shadows.
- Selection states use white/ink, not yellow.
- Blue is reserved for the Install/Update/Download action family.
- Green is reserved for the Play/Launch action family and installed-state indicators.

### 3.2 Typography

- **UI:** Geist Sans, weights 400/500/600/700.
- **Mono:** JetBrains Mono for versions, sizes, playtime, dates.
- **Scale:**
  - Page title: `1.75rem` / 700
  - Section title: `1rem` / 600
  - Body: `0.875rem` / 400
  - Caption / meta: `0.75rem` / 500
  - Tiny label: `0.6875rem` / 600 / uppercase / letter-spacing `0.06em`
- No gradient text.
- No all-caps labels except tiny section headers.

### 3.3 Spacing & Shape

- Base unit: `4px`.
- Border radius: `4px` for buttons, `6px` for cards/icon buttons, `8px` for banners/modals, `50%` for avatars/mark.
- 1px borders everywhere; no shadow except for modals and menus (`0 8px 32px rgba(0,0,0,0.35)` dark / `0 8px 32px rgba(0,0,0,0.08)` light).
- Page padding: `24px`.
- Section gap: `24px`.

### 3.4 Motion

- View transitions: fade `150ms` ease.
- Card image hover scale: `transform: scale(1.04)` over `250ms` ease-out.
- Button press: `transform: scale(0.97)` over `80ms`.
- Progress bars: width transition `200ms` linear.
- Splash logo: breathing loop `2.5s` ease-in-out (scale `1.0 → 1.05`, alpha `1.0 → 0.7`).
- Spinner: continuous rotation `1.2s` linear.
- No pulsing glows, no shimmer, no animated shine.

## 4. Layout Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Title bar (drag region)                                    │
├─────────────────────────────────────────────────────────────┤
│  Top bar: logo | Games News Store | buttons                 │
├─────────────────────────────────────────────────────────────┤
│  Game icon bar (Games tab only)                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Main content area                                          │
│  - Games overview with filter bar + cards                   │
│  - Game detail page (banner + action panel | news)          │
│  - News list / article                                      │
│  - Store placeholder                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.1 Title Bar

- Frameless window drag region.
- Height: `32px`.
- Background: same as canvas.
- Window controls (minimize / maximize / close) on the right.
- No logo, no text.

### 4.2 Top Bar

- Height: `48px`.
- Background: surface color (`#12131a` dark / `#ffffff` light).
- Bottom border: 1px border color.
- Left cluster:
  - Circle-P mark: `22px`, circular outline, ink color.
  - Nav tabs: Games, News, Store. Active tab is full white (`#f4f4f5`) with a `2px` white/ink underline; inactive tabs are ink-muted / grayish. No yellow accent.
- Right cluster (rectangular Steam-style buttons, `28px × 22px`, border radius `4px`, hover surface-hover):
  - Theme toggle icon.
  - Downloads button with badge.
  - Notifications button with badge.
  - Profile button.

### 4.3 Left Sidebar (Games tab only)

- Width: `220px`.
- Background: surface color with right border.
- Top section: vertical stack of game icon buttons (`36px` rounded `6px`) with small game name labels.
  - Selected: full white icon, `1px` ink/white border, ink name.
  - Installed inactive: full ink icon, ink name.
  - Not installed: ink-muted icon at `0.55` alpha, ink-muted name.
- “Add game” button at the bottom of the icon list: dashed border, plus icon.
- Right-click on any icon opens the context menu for that game.
- Bottom section: filter/search panel (see §6.2), separated from the icon list by a horizontal line.
- Hidden in News/Store tabs.
- Remains visible when a game detail page is open so the player can switch games.

### 4.4 Main Content Area

- Background: canvas color.
- Scrollable independently.
- Padding: `24px`.

## 5. Splash Screen

- Full-screen fixed overlay, canvas background.
- Centered content:
  - Circle-P mark: `72px`, circular outline, ink color.
  - Thin circular spinner around the mark: `1.5px` accent-gold line, rotating.
- Breathing animation on the mark: subtle scale + alpha pulse.
- No app name, no company name, no progress bar.
- Fades out over `300ms` once React is ready.
- Failsafe removal after 12s.

## 6. Games Tab

### 6.1 Games Overview

- Layout: responsive grid of cards below a compact filter bar.
- Card structure:
  - Card image (3:4, rounded `6px`, object-fit cover).
  - Below image: game name (body, 600) and genre (caption, muted).
- Card background: transparent.
- Hover:
  - Not installed: card image brightens slightly (`brightness(1.1)`), image scales up `1.04`.
  - Installed: image scales up `1.04` only.
- State treatment:
  - Installed: ink name, full-alpha image.
  - Not installed: ink-muted name, image at `0.7` alpha.
- Clicking a card navigates to that game’s detail page (does not merely select).

### 6.2 Filter Panel

- Located in the left sidebar below the game icon list, separated by a horizontal line.
- **Search input** at the top: filters cards by game name in real time.
- **Reset button** (↺ icon) next to the search input:
  - Clearly visible when any filter or search text is active.
  - Discrete (muted, no border) when everything is default.
  - Clicking clears search and resets all filters.
- Filter categories stacked vertically, each separated by a thin horizontal line:
  1. **Status:** All, Installed, Not installed (single-select pills).
  2. **Platforms:** Windows, macOS, Linux (Windows active; macOS/Linux disabled/roadmap).
  3. **Genres:** Multi-select pills derived from catalog.
- Selected filters: ink text + surface background + border; do not use aggressive green.
- Filter + search state persists while navigating into and back from a game detail page.

### 6.3 Game Detail Page

- Layout: two-column.
  - Left main column: `minmax(0, 1fr)` contains the banner and the action panel.
  - Right news column: fixed `360px`.
  - Gap: `24px`.
- **Hero banner:** `16:9` aspect ratio, rounded `8px`, cover image, max-height `420px`. Bottom scrim gradient only for text legibility. Title and status row overlaid at bottom-left.
- **Action panel (below banner, integrated with the page, minimal background):**
  - Left side: segmented button group.
    - Primary action button: wide rectangular button (`height: 48px`, `padding: 0 36px`, border-radius `4px` on the left only).
      - Installed → green “Play” button.
      - Not installed → blue “Install” button.
      - Update available → blue “Update” button.
      - Downloading/updating → blue progress button with cancel icon.
      - Running → green disabled “Playing…” button.
    - Vertical three-dots button attached to the primary button (same background color as the primary button, border-radius `4px` on the right only, separated by a `1px` divider).
  - Right side: horizontal meta sections separated by generous whitespace. Each section stacks a small muted label above the value:
    1. **Game size** (if not installed): hard-drive icon + formatted size.
    2. **Last played**: muted text value.
    3. **Playtime**: clock icon + hours with one decimal (e.g., `0.1h`, `2500.3h`).
  - Far right: gear icon button for game settings/options (verify files, open install folder).
- **Below the action panel:** reserved empty space for future content (achievements, screenshots, etc.).
- No game description text.
- **Latest News (right column):**
  - Fixed-width panel.
  - Shows latest news items for the selected game.
  - Each item: category badge, title, excerpt, date.
  - Clicking opens the news article view.

### 6.4 Context Menu

- Triggered by:
  - Vertical three-dots button on the detail-page action panel.
  - Right-click on a game icon in the left sidebar.
  - Right-click on a game card in the Games overview.
- Items (context-aware):
  - Install (if not installed)
  - Play / Launch (if installed)
  - Verify files (if installed)
  - Patch notes
  - Game news
  - Game info
  - Uninstall (danger, red text)
- Menu style: surface background, 1px border, rounded `8px`, subtle shadow.

## 7. News Tab & Article View

### 7.1 News List

- Grid of news cards.
- Each card: optional image, category badge, title, excerpt, date.
- Clicking opens the article view.

### 7.2 News Article View

- Full-page overlay or route within News tab.
- Header:
  - Back arrow icon top-left.
  - X icon top-right to close.
- Optional banner image at the very top, rounded `12px`. If absent, it is omitted with no reserved empty space.
- Below the banner (or at the top if no banner): small game icon + game name.
- Title: page-title style.
- Date below title: `3 June 2026` format, ink-muted, JetBrains Mono.
- Body: body text, muted.

## 8. Downloads Page

- Accessible from the top-right Downloads button from any tab.
- Opens as a full-page view in the main content area, hiding the Games left sidebar.
- Button states:
  - Empty: outline icon, muted color.
  - Downloading: solid blue icon, blue badge with active count.
  - Paused: outline icon, gold badge.
- Page content:
  - List of active/pending downloads.
  - Each row: game icon + name, progress bar, percentage, speed, ETA, pause/resume/cancel actions.
  - Completed downloads shown briefly with “Open” action, then auto-removed.

## 9. Notifications Panel

- Triggered by clicking the Notifications button in the top bar.
- Closes when clicking outside the panel or clicking the button again.
- Panel: surface background, 1px border, rounded `12px`, width `320px`, anchored below the button.
- Button shows badge with unread count.
- Notification items:
  - Game update available
  - Download complete
  - Launcher update available
  - News/events (placeholder field, no backend yet)
- Each item: icon, title, message, timestamp, dismiss action.
- Mark-all-read and clear actions at bottom.

## 10. Settings Modal

- Keep current modal structure but reskin to match new visual system.
- Sidebar tabs: General, Downloads, Notifications, About.
- Flat surfaces, 1px borders, no glass.
- Toggles: simple track + thumb, green when active.
- Inputs/selects: surface background, 1px border, accent focus ring.

## 11. Iconography

- Use Lucide React.
- No icon backgrounds except for profile avatar.
- Header buttons: rectangular hit area with hover surface.
- Action icons: `20–24px`.
- Context icons: `16px`.

## 12. Responsive Rules

- Minimum window size: `1000px × 680px`.
- On smaller widths, hide the right news column and show news below the description.
- Left sidebar is `220px` wide in Games tab; on very narrow widths it may collapse to icon-only (`64px`) with tooltips.

## 13. Accessibility

- All interactive elements have focus rings (`2px` accent-gold outline, `2px` offset).
- Color is not the only indicator of state: installed games also show status text/badges.
- Right-click menus are also reachable via keyboard/menu buttons.
- Splash mark has `aria-hidden` and a hidden live region for screen-reader status.

## 14. Assets Needed

- A clean circle-P mark in SVG (Capsule Corp inspired) for splash screen, top bar, and optionally game-fallback icons.
- Game banners and icons from the CDN (existing).
- Optional news banner images (existing).

## 15. Future Considerations

- **Fullscreen gradient background:** Add a subtle, Battle.net-style fullscreen gradient that sits behind the app and can be swapped by theme. Not part of this redesign.

## 16. Implementation Scope Notes

This redesign touches the following areas:

- `index.html` splash screen rewrite.
- `src/index.css` token simplification and removal of gradients/glass utilities.
- `src/components/TitleBar.tsx`, `AppTopBar.tsx`, `GameIconsBar.tsx` layout and style changes (vertical sidebar + icon list).
- `src/components/GamesHome.tsx` card redesign and new left filter/search panel.
- `src/components/GamePage.tsx` layout split, integrated action panel, context menu.
- New `src/components/DownloadsPage.tsx` or panel.
- New notifications panel component.
- New context-menu component reused across sidebar and detail page.
- `src/App.tsx` routing/state updates for Downloads view, notifications panel, and persistent filter/search state while navigating between overview and detail.
- Locale updates for new labels.
