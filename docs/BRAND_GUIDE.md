# Pandawan Corp — Brand Color System

A living reference for all Pandawan Corp branding, including the Pandawan Launcher and any future products. This guide is the single source of truth for color choices, usage rules, and theme tokens.

---

## Brand Personality

Indie · Chill · Premium but Simple · Connected · Positive

Pandawan Corp is a small studio that makes games with craft and heart. The brand should feel clean, modern, and trustworthy — like a polished indie tool you actually want to use every day. The panda mascot gives us black and white; the bamboo forest gives us green; the hero references give us gold prestige and rare red energy.

This system uses **recognizable, standard colors** for UI semantics so the brand remains readable and familiar. The art direction is split into two modes:

- **Dark Mode = Technological Forest** — black and deep maroon as the forest floor, bamboo green and forest gold as accents.
- **Light Mode = Parchment & Stone** — warm off-white parchment and cool stone grey, with black ink and green/gold accents.

---

## The Duality

The brand is built on a panda/harmony duality:

| Mode      | Vibe                       | Foundation                       | Accents                   |
| --------- | -------------------------- | -------------------------------- | ------------------------- |
| **Dark**  | Tech forest at night       | near-black, subtle maroon shadow | bamboo green, forest gold |
| **Light** | Medieval parchment & stone | warm parchment, stone grey       | bamboo green, muted gold  |

Both modes use the same semantic colors so actions stay recognizable.

---

## Main Palette Summary

### Dark Mode Main Palette

| Token                | Hex                      | Role                                          |
| -------------------- | ------------------------ | --------------------------------------------- |
| **Background**       | `#0a0a0c`                | Deepest canvas — tech forest floor            |
| **Surface**          | `#1a1a20`                | Cards, panels, inputs                         |
| **Surface Hover**    | `#2f2f38`                | Hover / active surface                        |
| **Primary Text**     | `#f4f4f5`                | Clean white-grey                              |
| **Secondary Text**   | `#a1a1aa`                | Muted labels, icons                           |
| **Border**           | `rgba(255,255,255,0.08)` | Subtle, seamless dividers                     |
| **Primary Action**   | `#22c55e`                | Bamboo green — Install, Play, Launch, Confirm |
| **Secondary Accent** | `#d4af37`                | Forest gold — active selection, premium       |
| **Shadow**           | `#5a1a2a`                | Maroon forest depth, used sparingly           |
| **Error**            | `#ef4444`                | Ember red — errors only                       |

### Light Mode Main Palette

| Token                | Hex                   | Role                                  |
| -------------------- | --------------------- | ------------------------------------- |
| **Background**       | `#f7f5f0`             | Warm parchment                        |
| **Surface**          | `#ffffff`             | Cards, panels, inputs                 |
| **Surface Hover**    | `#e9e5dd`             | Hover / active surface                |
| **Primary Text**     | `#1c1917`             | Stone black ink                       |
| **Secondary Text**   | `#78716c`             | Stone grey labels                     |
| **Border**           | `rgba(28,25,23,0.08)` | Warm, subtle dividers                 |
| **Primary Action**   | `#16a34a`             | Bamboo green                          |
| **Secondary Accent** | `#b8860b`             | Dark gold — active selection, premium |
| **Shadow**           | `#8b5a2b`             | Warm stone shadow, used sparingly     |
| **Error**            | `#dc2626`             | Ember red — errors only               |

---

## Core Palette

| Name          | Dark      | Light     | Role                                 |
| ------------- | --------- | --------- | ------------------------------------ |
| Bamboo Green  | `#22c55e` | `#16a34a` | Primary action, success, growth      |
| Forest Gold   | `#d4af37` | `#b8860b` | Active selection, premium highlights |
| Ember Red     | `#ef4444` | `#dc2626` | Errors, destructive actions          |
| Panda Black   | `#0a0a0c` | `#1c1917` | Dark canvas / ink                    |
| Parchment     | `#f7f5f0` | `#f7f5f0` | Light canvas                         |
| Stone Grey    | `#a1a1aa` | `#78716c` | Secondary text, structure            |
| Maroon Shadow | `#5a1a2a` | `#8b5a2b` | Depth, forest/shadow accent          |

---

## Palette Hierarchy

- **PRIMARY** → Bamboo Green → Install, Play, Launch, Save, Confirm, success states
- **SECONDARY** → Forest Gold → Active tabs, selected items, badges, premium highlights
- **SEMANTIC** → Ember Red → Errors, destructive actions only
- **NEUTRAL** → Panda Black / Parchment / Stone Grey → Backgrounds, surfaces, text, borders

> Ember is used only for errors and destructive controls. It never appears as body text or decoration.

---

## Design Direction Rationale

This palette intentionally blends two recognizable ideas:

- **Dark mode is a tech forest**: deep black, maroon shadow, and glowing green/gold accents. The UI feels like a piece of futuristic bamboo hardware.
- **Light mode is parchment & stone**: warm off-white, cool stone grey, and black ink. The UI feels like a clean medieval ledger or modern dashboard.

Both modes use the same green action color so the brand stays recognizable across modes.

---

## Dark Mode Token Map

| Token                | Value                       | Usage                            |
| -------------------- | --------------------------- | -------------------------------- |
| `--canvas-default`   | `#0a0a0c`                   | App background                   |
| `--canvas-light`     | `#121216`                   | Elevated sidebar / panels        |
| `--canvas-elevated`  | `#19191e`                   | Modals, popovers                 |
| `--surface-default`  | `#1a1a20`                   | Cards, inputs, content panels    |
| `--surface-light`    | `#24242b`                   | Hover backgrounds                |
| `--surface-hover`    | `#2f2f38`                   | Active hover state               |
| `--surface-elevated` | `rgba(26, 26, 32, 0.85)`    | Glass panels                     |
| `--ink-default`      | `#f4f4f5`                   | Primary text                     |
| `--ink-muted`        | `#a1a1aa`                   | Secondary text                   |
| `--ink-dim`          | `#71717a`                   | Placeholder, meta                |
| `--ink-subtle`       | `#52525b`                   | Disabled, dividers               |
| `--action`           | `#22c55e`                   | Primary action buttons           |
| `--action-hover`     | `#4ade80`                   | Button hover                     |
| `--action-light`     | `#86efac`                   | Light green accent               |
| `--action-muted`     | `rgba(34, 197, 94, 0.15)`   | Subtle green tint                |
| `--action-glow`      | `rgba(34, 197, 94, 0.35)`   | Green glow                       |
| `--accent`           | `#d4af37`                   | Active selections, premium       |
| `--accent-hover`     | `#e6c65c`                   | Gold hover                       |
| `--accent-light`     | `#f3e5ab`                   | Light gold shimmer               |
| `--accent-muted`     | `rgba(212, 175, 55, 0.15)`  | Subtle gold tint                 |
| `--accent-glow`      | `rgba(212, 175, 55, 0.35)`  | Gold glow                        |
| `--silver`           | `#a1a1aa`                   | Code, metadata, structural icons |
| `--silver-muted`     | `rgba(161, 161, 170, 0.12)` | Subtle grey tint                 |
| `--silver-glow`      | `rgba(161, 161, 170, 0.18)` | Silver glow                      |
| `--shadow`           | `#5a1a2a`                   | Forest depth / maroon accent     |
| `--shadow-muted`     | `rgba(90, 26, 42, 0.15)`    | Maroon tint                      |
| `--ember`            | `#ef4444`                   | Error / danger                   |
| `--ember-muted`      | `rgba(239, 68, 68, 0.15)`   | Error tint                       |
| `--border-default`   | `rgba(255,255,255,0.08)`    | Subtle dividers                  |
| `--border-strong`    | `rgba(255,255,255,0.12)`    | Card outlines                    |
| `--border-accent`    | `rgba(212, 175, 55, 0.35)`  | Active/selected border           |
| `--border-action`    | `rgba(34, 197, 94, 0.35)`   | Action border                    |

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
| `--surface-elevated` | `rgba(255, 255, 255, 0.92)` | Glass panels                     |
| `--ink-default`      | `#1c1917`                   | Primary text                     |
| `--ink-muted`        | `#78716c`                   | Secondary text                   |
| `--ink-dim`          | `#a8a29e`                   | Placeholder, meta                |
| `--ink-subtle`       | `#d6d3d1`                   | Disabled, dividers               |
| `--action`           | `#16a34a`                   | Primary action buttons           |
| `--action-hover`     | `#15803d`                   | Button hover                     |
| `--action-light`     | `#22c55e`                   | Light green accent               |
| `--action-muted`     | `rgba(22, 163, 74, 0.10)`   | Subtle green tint                |
| `--action-glow`      | `rgba(22, 163, 74, 0.22)`   | Green glow                       |
| `--accent`           | `#b8860b`                   | Active selections, premium       |
| `--accent-hover`     | `#946c08`                   | Gold hover                       |
| `--accent-light`     | `#d4af37`                   | Light gold shimmer               |
| `--accent-muted`     | `rgba(184, 134, 11, 0.12)`  | Subtle gold tint                 |
| `--accent-glow`      | `rgba(184, 134, 11, 0.22)`  | Gold glow                        |
| `--silver`           | `#78716c`                   | Code, metadata, structural icons |
| `--silver-muted`     | `rgba(120, 113, 108, 0.10)` | Subtle grey tint                 |
| `--silver-glow`      | `rgba(120, 113, 108, 0.12)` | Silver glow                      |
| `--shadow`           | `#8b5a2b`                   | Warm stone shadow                |
| `--shadow-muted`     | `rgba(139, 90, 43, 0.10)`   | Shadow tint                      |
| `--ember`            | `#dc2626`                   | Error / danger                   |
| `--ember-muted`      | `rgba(220, 38, 38, 0.10)`   | Error tint                       |
| `--border-default`   | `rgba(28,25,23,0.08)`       | Subtle dividers                  |
| `--border-strong`    | `rgba(28,25,23,0.14)`       | Card outlines                    |
| `--border-accent`    | `rgba(184, 134, 11, 0.35)`  | Active/selected border           |
| `--border-action`    | `rgba(22, 163, 74, 0.30)`   | Action border                    |

---

## Semantic / Status Colors

| Status            | Dark      | Light     | Token                | Notes                  |
| ----------------- | --------- | --------- | -------------------- | ---------------------- |
| Ready / Installed | `#22c55e` | `#16a34a` | `status-ready`       | Same as primary action |
| Downloading       | `#d4af37` | `#b8860b` | `status-downloading` | Gold = in motion       |
| Installing        | `#e6c65c` | `#d4af37` | `status-installing`  | Gold shimmer           |
| Updating          | `#4ade80` | `#22c55e` | `status-updating`    | Soft green             |
| Error             | `#ef4444` | `#dc2626` | `status-error`       | Clean red              |

---

## Usage Rules

### Do ✅

- Use Bamboo Green for every positive action button (Install, Play, Launch, Save, Confirm).
- Use Forest Gold for active/selected states, badges, and premium details only.
- Use Stone Grey for secondary text, metadata, icons, dividers, and borders.
- Use Panda Black / Parchment as the foundation so the UI stays clean and readable.
- Use Ember Red only for errors and destructive actions.
- Keep the sidebar a distinct color from the main canvas in both modes.
- Prefer **transparent / seamless backgrounds** inside modals and cards for a clean, ASMR-like feel.

### Don't ❌

- Never use arbitrary blues, purples, or neon colors outside this palette.
- Never use pure black `#000000` or pure white `#ffffff` as text colors.
- Never use red for body text, labels, or decoration.
- Never use gold for default/inactive states.
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

> Clean, confident, and crafted. The UI is neutral and calm so the green actions feel purposeful, the gold accents feel earned, and the red errors feel rare. Dark mode feels like a futuristic forest; light mode feels like a clean stone workshop.

---

## Applying Tokens in Code

The launcher implements these tokens in `src/index.css`. CSS variables map to the tokens above, so future UI work should use the variables rather than raw hex values.

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

_Document version: 6.0 — Pandawan Corp Brand Color System (Duality: Tech Forest / Parchment & Stone)_
