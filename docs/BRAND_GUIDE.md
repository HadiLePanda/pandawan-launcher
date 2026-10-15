# Pandawan Corp — Brand Color System

A living reference for all Pandawan Corp branding, including the Pandawan Launcher and any future products. This guide is the single source of truth for color choices, usage rules, and theme tokens.

---

## Brand Personality

Indie · Chill · Premium but Simple · Connected · Positive

Pandawan Corp is a small studio that makes games with craft and heart. The brand should feel clean, modern, and trustworthy — like a polished indie tool you actually want to use every day. The panda mascot gives us black and white; the bamboo forest gives us green; the hero references give us gold prestige and rare red energy.

This system uses **recognizable, standard colors** for UI semantics so the brand remains readable and familiar. The art direction is split into two modes:

- **Dark Mode = Technological Forest** — near-black and deep maroon as the forest floor, bamboo green and blue as accents.
- **Light Mode = Parchment & Stone** — warm off-white parchment and cool stone grey, with black ink, green and blue accents.

---

## The Duality

The brand is built on a panda/harmony duality:

| Mode      | Vibe                       | Foundation                       | Accents            |
| --------- | -------------------------- | -------------------------------- | ------------------ |
| **Dark**  | Tech forest at night       | near-black, subtle maroon shadow | bamboo green, blue |
| **Light** | Medieval parchment & stone | warm parchment, stone grey       | bamboo green, blue |

Both modes use the same semantic colors so actions stay recognizable.

---

## Main Palette Summary

### Dark Mode Main Palette

| Token                | Hex                      | Role                                          |
| -------------------- | ------------------------ | --------------------------------------------- |
| **Background**       | `#0e1013`                | Deepest canvas — tech forest floor            |
| **Surface**          | `#16191d`                | Cards, panels, inputs                         |
| **Surface Hover**    | `#24282e`                | Hover / active surface                        |
| **Primary Text**     | `#f4f4f5`                | Clean white-grey                              |
| **Secondary Text**   | `#9ca3af`                | Muted labels, icons                           |
| **Border**           | `rgba(255,255,255,0.08)` | Subtle, seamless dividers                     |
| **Primary Action**   | `#22c55e`                | Bamboo green — Install, Play, Launch, Confirm |
| **Secondary Accent** | `#3b82f6`                | Blue — active selection, links, badges        |
| **Shadow**           | `#3a1f2a`                | Maroon forest depth, used sparingly           |
| **Error**            | `#ef4444`                | Ember red — errors only                       |

### Light Mode Main Palette

| Token                | Hex                   | Role                                   |
| -------------------- | --------------------- | -------------------------------------- |
| **Background**       | `#f7f5f0`             | Warm parchment                         |
| **Surface**          | `#ffffff`             | Cards, panels, inputs                  |
| **Surface Hover**    | `#e9e5dd`             | Hover / active surface                 |
| **Primary Text**     | `#1c1917`             | Stone black ink                        |
| **Secondary Text**   | `#78716c`             | Stone grey labels                      |
| **Border**           | `rgba(28,27,25,0.08)` | Warm, subtle dividers                  |
| **Primary Action**   | `#16a34a`             | Bamboo green                           |
| **Secondary Accent** | `#2563eb`             | Blue — active selection, links, badges |
| **Shadow**           | `#5a3a2a`             | Warm stone shadow, used sparingly      |
| **Error**            | `#dc2626`             | Ember red — errors only                |

---

## Core Palette

| Name          | Dark      | Light     | Role                               |
| ------------- | --------- | --------- | ---------------------------------- |
| Bamboo Green  | `#22c55e` | `#16a34a` | Primary action, success, growth    |
| Blue          | `#3b82f6` | `#2563eb` | Active selection, secondary accent |
| Ember Red     | `#ef4444` | `#dc2626` | Errors, destructive actions        |
| Panda Black   | `#0e1013` | `#1c1917` | Dark canvas / ink                  |
| Parchment     | `#f7f5f0` | `#f7f5f0` | Light canvas                       |
| Stone Grey    | `#9ca3af` | `#78716c` | Secondary text, structure          |
| Maroon Shadow | `#3a1f2a` | `#5a3a2a` | Depth, forest/shadow accent        |

---

## Palette Hierarchy

- **PRIMARY** → Bamboo Green → Install, Play, Launch, Save, Confirm, success states
- **SECONDARY** → Blue → Active tabs, selected items, links, badges
- **SEMANTIC** → Ember Red → Errors, destructive actions only
- **NEUTRAL** → Panda Black / Parchment / Stone Grey → Backgrounds, surfaces, text, borders

> Ember is used only for errors and destructive controls. It never appears as body text or decoration.

---

## Design Direction Rationale

This palette intentionally blends two recognizable ideas:

- **Dark mode is a tech forest**: near-black, maroon shadow, and glowing green/blue accents. The UI feels like a piece of futuristic bamboo hardware.
- **Light mode is parchment & stone**: warm off-white, cool stone grey, and black ink. The UI feels like a clean medieval ledger or modern dashboard.

Both modes use the same green action color so the brand stays recognizable across modes.

---

## Dark Mode Token Map

| Token                | Value                       | Usage                            |
| -------------------- | --------------------------- | -------------------------------- |
| `--canvas-default`   | `#0e1013`                   | App background                   |
| `--canvas-light`     | `#14171b`                   | Elevated sidebar / panels        |
| `--canvas-elevated`  | `#1a1d22`                   | Modals, popovers                 |
| `--surface-default`  | `#16191d`                   | Cards, inputs, content panels    |
| `--surface-light`    | `#1e2125`                   | Hover backgrounds                |
| `--surface-hover`    | `#24282e`                   | Active hover state               |
| `--surface-elevated` | `rgba(22, 25, 29, 0.95)`    | Glass panels                     |
| `--ink-default`      | `#f4f4f5`                   | Primary text                     |
| `--ink-muted`        | `#9ca3af`                   | Secondary text                   |
| `--ink-dim`          | `#6b7280`                   | Placeholder, meta                |
| `--ink-subtle`       | `#4b5563`                   | Disabled, dividers               |
| `--action`           | `#22c55e`                   | Primary action buttons           |
| `--action-hover`     | `#34d67a`                   | Button hover                     |
| `--action-light`     | `#6ee7a0`                   | Light green accent               |
| `--action-muted`     | `rgba(34, 197, 94, 0.14)`   | Subtle green tint                |
| `--action-glow`      | `rgba(34, 197, 94, 0.32)`   | Green glow                       |
| `--blue`             | `#3b82f6`                   | Secondary accent                 |
| `--blue-hover`       | `#60a5fa`                   | Blue hover                       |
| `--blue-muted`       | `rgba(59, 130, 246, 0.14)`  | Subtle blue tint                 |
| `--accent`           | `var(--blue)`               | Legacy alias of the blue accent  |
| `--accent-hover`     | `var(--blue-hover)`         | Legacy alias of `--blue-hover`   |
| `--accent-light`     | `var(--blue-hover)`         | Legacy alias of `--blue-hover`   |
| `--accent-muted`     | `var(--blue-muted)`         | Legacy alias of `--blue-muted`   |
| `--accent-glow`      | `rgba(59, 130, 246, 0.32)`  | Blue glow                        |
| `--silver`           | `#9ca3b0`                   | Code, metadata, structural icons |
| `--silver-muted`     | `rgba(156, 163, 176, 0.10)` | Subtle grey tint                 |
| `--silver-glow`      | `rgba(156, 163, 176, 0.16)` | Silver glow                      |
| `--shadow`           | `#3a1f2a`                   | Forest depth / maroon accent     |
| `--shadow-muted`     | `rgba(58, 31, 42, 0.14)`    | Maroon tint                      |
| `--ember`            | `#ef4444`                   | Error / danger                   |
| `--ember-muted`      | `rgba(239, 68, 68, 0.14)`   | Error tint                       |
| `--border-default`   | `rgba(255,255,255,0.08)`    | Subtle dividers                  |
| `--border-strong`    | `rgba(255,255,255,0.12)`    | Card outlines                    |
| `--border-accent`    | `rgba(59, 130, 246, 0.32)`  | Active/selected border           |
| `--border-action`    | `rgba(34, 197, 94, 0.32)`   | Action border                    |

---

## Light Mode Token Map

| Token                | Value                       | Usage                            |
| -------------------- | --------------------------- | -------------------------------- |
| `--canvas-default`   | `#f7f5f0`                   | App background                   |
| `--canvas-light`     | `#ffffff`                   | Elevated sidebar / panels        |
| `--canvas-elevated`  | `#efebe3`                   | Modals, popovers                 |
| `--surface-default`  | `#ffffff`                   | Cards, inputs, content panels    |
| `--surface-light`    | `#f3f1ec`                   | Hover backgrounds                |
| `--surface-hover`    | `#e9e5dd`                   | Active hover state               |
| `--surface-elevated` | `rgba(255, 255, 255, 0.94)` | Glass panels                     |
| `--ink-default`      | `#1c1917`                   | Primary text                     |
| `--ink-muted`        | `#78716c`                   | Secondary text                   |
| `--ink-dim`          | `#a8a29e`                   | Placeholder, meta                |
| `--ink-subtle`       | `#d6d3d1`                   | Disabled, dividers               |
| `--action`           | `#16a34a`                   | Primary action buttons           |
| `--action-hover`     | `#15803d`                   | Button hover                     |
| `--action-light`     | `#22c55e`                   | Light green accent               |
| `--action-muted`     | `rgba(22, 163, 74, 0.12)`   | Subtle green tint                |
| `--action-glow`      | `rgba(22, 163, 74, 0.22)`   | Green glow                       |
| `--blue`             | `#2563eb`                   | Secondary accent                 |
| `--blue-hover`       | `#1d4ed8`                   | Blue hover                       |
| `--blue-muted`       | `rgba(37, 99, 235, 0.12)`   | Subtle blue tint                 |
| `--accent`           | `var(--blue)`               | Legacy alias of the blue accent  |
| `--accent-hover`     | `var(--blue-hover)`         | Legacy alias of `--blue-hover`   |
| `--accent-light`     | `#3b82f6`                   | Light blue accent                |
| `--accent-muted`     | `var(--blue-muted)`         | Legacy alias of `--blue-muted`   |
| `--accent-glow`      | `rgba(37, 99, 235, 0.22)`   | Blue glow                        |
| `--silver`           | `#6e7480`                   | Code, metadata, structural icons |
| `--silver-muted`     | `rgba(110, 116, 128, 0.12)` | Subtle grey tint                 |
| `--silver-glow`      | `rgba(110, 116, 128, 0.14)` | Silver glow                      |
| `--shadow`           | `#5a3a2a`                   | Warm stone shadow                |
| `--shadow-muted`     | `rgba(90, 58, 42, 0.10)`    | Shadow tint                      |
| `--ember`            | `#dc2626`                   | Error / danger                   |
| `--ember-muted`      | `rgba(220, 38, 38, 0.10)`   | Error tint                       |
| `--border-default`   | `rgba(28,27,25,0.08)`       | Subtle dividers                  |
| `--border-strong`    | `rgba(28,27,25,0.14)`       | Card outlines                    |
| `--border-accent`    | `rgba(37, 99, 235, 0.32)`   | Active/selected border           |
| `--border-action`    | `rgba(22, 163, 74, 0.28)`   | Action border                    |

---

## Semantic / Status Colors

| Status            | Value     | Tailwind token       | Notes                  |
| ----------------- | --------- | -------------------- | ---------------------- |
| Ready / Installed | `#22c55e` | `status-ready`       | Same as primary action |
| Downloading       | `#3b82f6` | `status-downloading` | Secondary blue         |
| Installing        | `#60a5fa` | `status-installing`  | Blue, one step lighter |
| Updating          | `#34d67a` | `status-updating`    | Action-hover green     |
| Error             | `#ef4444` | `status-error`       | Clean red              |

Those five are Tailwind tokens in `@theme`, so they read the same in both
modes. The `--status-ok` / `--status-warn` / `--status-bad` trio carries the
same three states as a text color or a fill, changes with the mode, and has a
`-muted` tint beside it.

| Fill    | Dark      | Light     | Token           |
| ------- | --------- | --------- | --------------- |
| Ok      | `#34d399` | `#059669` | `--status-ok`   |
| Warning | `#fbbf24` | `#b45309` | `--status-warn` |
| Bad     | `#f87171` | `#dc2626` | `--status-bad`  |

---

## Usage Rules

### Do ✅

- Use Bamboo Green for every positive action button (Install, Play, Launch, Save, Confirm).
- Use Blue for active/selected states, links, and badges only.
- Use Stone Grey for secondary text, metadata, icons, dividers, and borders.
- Use Panda Black / Parchment as the foundation so the UI stays clean and readable.
- Use Ember Red only for errors and destructive actions.
- Keep the sidebar a distinct color from the main canvas in both modes.
- Prefer **transparent / seamless backgrounds** inside modals and cards for a clean, ASMR-like feel.

### Don't ❌

- Never use a second blue, purples, or neon colors outside this palette.
- Never use pure black `#000000` or pure white `#ffffff` as text colors.
- Never use red for body text, labels, or decoration.
- Never use the accent for default or inactive states.
- Never make dark mode surfaces look inverted or muddy.
- Avoid heavy black boxes in light mode — use white, parchment, or transparent surfaces instead.
- No per-game color theming.

---

## Typography (Reference)

| Role            | Font           | Weight        |
| --------------- | -------------- | ------------- |
| UI / Body       | Geist Sans     | 400, 500, 600 |
| Code / Metadata | JetBrains Mono | 400           |
| Brand Mark      | Geist Sans     | 700           |

---

## Brand Voice in Color

> Clean, confident, and crafted. The UI is neutral and calm so the green actions feel purposeful, the blue accents feel earned, and the red errors feel rare. Dark mode feels like a futuristic forest; light mode feels like a clean stone workshop.

---

## Applying Tokens in Code

The launcher implements these tokens in `src/styles/base.css`, which
`src/index.css` imports first. CSS variables map to the tokens above, so future
UI work should use the variables rather than raw hex values. The same file also
holds the spacing (`--space-*`), type (`--text-*`), weight (`--weight-*`),
radius (`--radius-*`) and motion (`--motion-*`) scales.

```css
/* Dark mode is default */
background: var(--canvas-default);
color: var(--ink-default);

/* Action buttons */
background: var(--action);
background: var(--action-hover); /* on hover */

/* Active selections / premium highlights */
color: var(--accent);
border-color: var(--border-accent);

/* Metadata / code / structure */
color: var(--silver);
background: var(--silver-muted);

/* Errors / destructive actions */
color: var(--ember);
background: var(--ember-muted);

/* Seamless inputs */
background: transparent;
border-color: var(--border-default);
```

---

## References

- Panda mascot: black and white, clean and recognizable.
- Lord Grim (King's Avatar): earned gold on dark gear.
- Naofumi (The Rising of the Shield Hero): green, silver, and red used with restraint.
- Bamboo forest: green growth, calm confidence.
- Medieval parchment & stone: warm off-white, black ink, cool grey stone.
- Modern software design: Tailwind, shadcn/ui, Steam, Battle.net, Epic, Xbox.

---

_Document version: 7.0 — Pandawan Corp Brand Color System (Duality: Tech Forest / Parchment & Stone); token tables verified against `src/styles/base.css`._
