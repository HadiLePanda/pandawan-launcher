# Pandawan Launcher - Setup Guide

## Prerequisites

Before you begin, ensure you have the following installed:

1. **Node.js** (v18 or higher)
   - Download from: https://nodejs.org/
   - Verify: `node --version`

2. **Rust** (v1.70 or higher)
   - Install via: https://rustup.rs/
   - Verify: `rustc --version`

3. **Windows SDK** (Windows only)
   - Install Visual Studio Build Tools with "Desktop development with C++" workload

## Installation

### 1. Install Dependencies

```bash
npm install
```

This will install:

- React 18 + TypeScript
- Vite (build tool)
- Tailwind CSS
- Tauri CLI and APIs
- Zustand (state management)
- Lucide React (icons)

### 2. Install Tauri Dependencies

```bash
cd src-tauri
cargo fetch
cd ..
```

Or let Tauri handle it automatically on first build.

## Development

### Run Development Server

```bash
npm run tauri:dev
```

This will:

1. Start the Vite dev server on port 1420
2. Compile and launch the Tauri application
3. Enable hot-reload for both frontend and backend

### Frontend-Only Development (Faster)

```bash
npm run dev
```

This runs only the web frontend without the Rust backend. Note that Tauri-specific features won't work.

## Building for Production

### Build Release

```bash
npm run tauri:build
```

This creates optimized binaries in `src-tauri/target/release/`.

### Build Output

- **Windows**: `src-tauri/target/release/Pandawan Launcher.exe` + `.msi` installer
- **macOS**: `src-tauri/target/release/bundle/macos/`
- **Linux**: `src-tauri/target/release/bundle/deb/` or `appimage/`

## Project Structure Explained

```
pandawan-launcher/
â”œâ”€â”€ src/                          # Frontend (React + TypeScript)
â”‚   â”œâ”€â”€ components/               # React components
â”‚   â”‚   â”œâ”€â”€ Header.tsx           # Navigation bar with tabs
â”‚   â”‚   â”œâ”€â”€ GameCard.tsx         # Game tile in library
â”‚   â”‚   â”œâ”€â”€ GameDetail.tsx       # Full game page
â”‚   â”‚   â”œâ”€â”€ Library.tsx          # Main library view
â”‚   â”‚   â”œâ”€â”€ Settings.tsx         # Settings page
â”‚   â”‚   â”œâ”€â”€ Store.tsx            # Store/browse page
â”‚   â”‚   â”œâ”€â”€ News.tsx             # News feed page
â”‚   â”‚   â””â”€â”€ WindowControls.tsx   # Minimize/maximize/close buttons
â”‚   â”œâ”€â”€ lib/
â”‚   â”‚   â”œâ”€â”€ store.ts             # Zustand state management
â”‚   â”‚   â””â”€â”€ utils.ts             # Helper functions (formatBytes, etc.)
â”‚   â”œâ”€â”€ types/
â”‚   â”‚   â””â”€â”€ index.ts             # TypeScript type definitions
â”‚   â”œâ”€â”€ App.tsx                  # Main app component
â”‚   â”œâ”€â”€ main.tsx                 # React entry point
â”‚   â”œâ”€â”€ index.css                # Global styles + Tailwind
â”‚   â””â”€â”€ vite-env.d.ts            # Vite type declarations
â”‚
â”œâ”€â”€ src-tauri/                    # Backend (Rust)
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ main.rs              # Entry point
â”‚       â”œâ”€â”€ lib.rs               # Tauri commands + state
â”‚       â”œâ”€â”€ types.rs             # Shared data structures
â”‚       â”œâ”€â”€ download.rs          # Download manager (HTTP + progress)
â”‚       â””â”€â”€ patch.rs             # Patching system (hash verification)
â”‚   â”œâ”€â”€ Cargo.toml               # Rust dependencies
â”‚   â”œâ”€â”€ tauri.conf.json          # Tauri configuration
â”‚   â””â”€â”€ build.rs                 # Build script
â”‚
â”œâ”€â”€ scripts/
â”‚   â””â”€â”€ generate-manifest.py     # Python script to create game manifests
â”‚
â”œâ”€â”€ package.json                  # Node dependencies
â”œâ”€â”€ tsconfig.json                # TypeScript configuration
â””â”€â”€ vite.config.ts               # Vite configuration
```

## Key Features

### 1. Smart Patching System

- Only downloads files that have changed (using SHA256 hashes)
- Verifies file integrity after download
- Removes orphaned files no longer in manifest

### 2. Resume-Capable Downloads

- Uses HTTP Range headers to resume interrupted downloads
- Stores partial downloads and continues from last byte
- Multiple parallel connections for faster downloads

### 3. Modern UI

- Battle.net-inspired design
- Dark theme with glass morphism effects
- Smooth animations and transitions
- Frameless window with custom controls

### 4. Unity Integration

- Launches games with `-launcher` argument
- Games can detect launcher presence
- Playtime tracking support

## Configuration Files

### Game Manifest (CDN)

Each game needs a `manifest.json` hosted on your CDN:

```json
{
  "game_id": "quirheim-online",
  "name": "Quirheim Online",
  "version": "1.0.0",
  "build_number": 100,
  "description": "Game description...",
  "icon_url": "https://cdn.example.com/icon.png",
  "banner_url": "https://cdn.example.com/banner.jpg",
  "executable": "QuirheimOnline.exe",
  "files": [
    {
      "path": "QuirheimOnline.exe",
      "hash": "sha256_hash_here",
      "size": 52428800,
      "url": "files/QuirheimOnline.exe"
    }
  ]
}
```

Generate manifests using:

```bash
python scripts/generate-manifest.py \
  --game-id quirheim-online \
  --name "Quirheim Online" \
  --version 1.0.0 \
  --build-number 100 \
  --executable "QuirheimOnline.exe" \
  --cdn-origin "https://pub-789d1bb0f3da4a99ae1024d53ea305d3.r2.dev" \
  --channel stable \
  --input-dir "./Builds/StandaloneWindows64-v1.0.0" \
  --output "manifest.json"
```

### Launcher Settings

Stored in:

- Windows: `%LOCALAPPDATA%\com.pandawancorp.launcher\`
- macOS: `~/Library/Application Support/com.pandawancorp.launcher/`
- Linux: `~/.local/share/com.pandawancorp.launcher/`

## Tauri Commands (Frontend â†’ Backend)

| Command                                    | Description                       |
| ------------------------------------------ | --------------------------------- |
| `fetch_game_manifest(url)`                 | Download game manifest from CDN   |
| `install_game(manifest, baseUrl, onEvent)` | Install/update game with progress |
| `launch_game(gameId)`                      | Launch installed game             |
| `uninstall_game(gameId)`                   | Remove game files                 |
| `get_installed_games()`                    | List all installed games          |
| `check_game_update(gameId, manifest)`      | Check if update available         |
| `get_settings()`                           | Get launcher settings             |
| `save_settings(settings)`                  | Save launcher settings            |
| `select_install_folder()`                  | Open folder picker                |

## Troubleshooting

### Build Errors

1. **Rust not found**

   ```
   error: could not find `cargo`
   ```
   - Install Rust: https://rustup.rs/
   - Restart terminal after installation

2. **MSVC not found (Windows)**

   ```
   error: linker link.exe not found
   ```
   - Install Visual Studio Build Tools
   - Or use `cargo install cargo-tauri` with MinGW

3. **Tauri CLI not found**
   ```bash
   npm install -g @tauri-apps/cli
   ```

### Development Issues

1. **Port already in use**
   - Vite uses port 1420 by default
   - Change in `vite.config.ts` if needed

2. **Hot reload not working**
   - Ensure `tauri.conf.json` has correct `devUrl`
   - Check firewall isn't blocking localhost

### Runtime Issues

1. **Game won't launch**
   - Check executable path in installation
   - Verify game files weren't quarantined by antivirus
   - Run launcher as administrator (if needed)

2. **Downloads fail**
   - Check CDN URL is accessible
   - Verify SSL certificates
   - Check firewall/proxy settings

## Next Steps

1. **Set up your CDN**: Upload game files and manifest
2. **Update game list**: Add your games in `src/components/Library.tsx`
3. **Customize UI**: Modify theme tokens in `src/index.css` (Tailwind v4 uses CSS-based configuration)
4. **Add more features**: Check Tauri plugins for notifications, auto-updater, etc.

## Resources

- [Tauri Documentation](https://v2.tauri.app/)
- [React Documentation](https://react.dev/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [Rust Book](https://doc.rust-lang.org/book/)
