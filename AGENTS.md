# Pandawan Launcher - Agent Guidelines

## Project Overview

This is a Tauri-based game launcher for Pandawan Corp games, built with React and Rust.

### Architecture
- **Frontend**: React 18 + TypeScript + Tailwind CSS + Zustand
- **Backend**: Rust + Tauri
- **Design**: Battle.net-inspired dark theme with glass morphism

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

## File Structure

```
src/                          # React frontend
├── components/               # React components
├── lib/                      # Utilities and store
├── types/                    # TypeScript types
├── App.tsx                   # Main app
└── main.tsx                  # Entry point

src-tauri/                    # Rust backend
└── src/
    ├── lib.rs                # Main library with commands
    ├── types.rs              # Shared types
    ├── download.rs           # Download manager
    └── patch.rs              # Patching system
```

## Coding Style

### TypeScript/React
- Use functional components with hooks
- Type all props and state explicitly
- Use `@/` path aliases for imports
- Tailwind classes should follow: layout -> sizing -> spacing -> colors -> effects

### Rust
- Use `?` operator for error propagation
- Prefer `Arc<Mutex<T>>` for shared state
- Commands should return `Result<T, String>` for frontend compatibility

## Design System

### Colors
- Canvas: `#0a0a0b` (main background)
- Surface: `#1a1a1c` (cards/elevated)
- Accent: `#e85d3f` (orange-red, primary actions)
- Ink: `#fafafa` (primary text)
- Ink Muted: `#a1a1a3` (secondary text)

### Typography
- Primary: Geist (sans-serif)
- Mono: JetBrains Mono (code/metadata)

### Components
- Cards: `rounded-2xl bg-surface border border-border`
- Buttons: `btn-press` class for tactile feedback
- Glass: `glass` or `glass-strong` for backdrop blur

## Tauri Commands

Available commands are defined in `src-tauri/src/lib.rs`:

| Command | Args | Returns |
|---------|------|---------|
| fetch_game_manifest | url: String | GameManifest |
| install_game | manifest, baseUrl, onEvent | GameInstallation |
| launch_game | gameId: String | LaunchResult |
| get_installed_games | - | GameInstallation[] |
| etc... | | |

## Development Workflow

1. **Frontend only**: `npm run dev`
2. **With Tauri**: `npm run tauri:dev`
3. **Build**: `npm run tauri:build`

## Important Notes

- Window is frameless with custom title bar (Header component)
- Downloads support resume via HTTP Range requests
- Patching uses SHA256 hash comparison
- Settings persist to JSON in app data directory
- Games are expected to have `-launcher` arg passed
