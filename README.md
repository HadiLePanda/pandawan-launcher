# Pandawan Launcher

A lightweight, Battle.net-style game launcher built with **Tauri**, **React**, and **Rust**. Designed for indie game developers to distribute their games with automatic patching, resume-capable downloads, and a modern UI.

> A screenshot will be added here: `screenshot.png`

## Features

- 🎮 **Game Library Management** - Install, update, and launch games from a central library
- 📦 **Smart Patching** - Only downloads changed files using hash-based verification
- ⏯️ **Resume Downloads** - Interrupted downloads automatically resume from where they left off
- ⚡ **Parallel Downloads** - Download multiple files concurrently for faster installation
- 🔄 **Auto-Updates** - Games automatically check for and install updates
- 🎨 **Modern UI** - Dark theme with glass morphism inspired by Battle.net
- 🔧 **Configurable** - Customizable install paths, bandwidth limits, and behavior settings
- 🖥️ **Cross-Platform** - Built with Tauri for Windows, macOS, and Linux support

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Backend | Rust + Tauri |
| State | Zustand |
| HTTP Client | reqwest (Rust) |
| Icons | Lucide React |

## Architecture

```
pandawan-launcher/
├── src/                          # React frontend
│   ├── components/               # UI components
│   │   ├── TitleBar.tsx         # Frameless window title bar
│   │   ├── AppTopBar.tsx        # Navigation tabs + game icons
│   │   ├── GamesPage.tsx        # Game library layout
│   │   ├── GamesHome.tsx        # Default game grid view
│   │   ├── GamePage.tsx         # Selected game detail view
│   │   ├── News.tsx             # News feed view
│   │   ├── Settings.tsx         # Settings page
│   │   └── AddGameModal.tsx     # Manual game install modal
│   ├── lib/                      # Utilities, services, and state
│   │   ├── store.ts             # Zustand state management
│   │   ├── catalog-service.ts   # Remote/local/embedded catalog loading
│   │   ├── cdn.ts               # CDN URL helpers and game info resolver
│   │   ├── game-service.ts      # Tauri command wrappers for install/launch
│   │   ├── news-service.ts      # News feed loader
│   │   ├── commands.ts          # Typed Tauri invoke helpers
│   │   ├── download-channel.ts  # Download progress event mapping
│   │   ├── logger.ts            # Lightweight structured logging
│   │   └── window.ts            # Custom title-bar window controls
│   ├── types/
│   │   └── index.ts             # TypeScript type definitions
│   ├── App.tsx                  # Main app component
│   ├── main.tsx                 # Entry point
│   └── index.css                # Global styles + CSS variables
├── src-tauri/                    # Rust backend
│   └── src/
│       ├── main.rs              # Entry point
│       ├── lib.rs               # Main library with Tauri commands
│       ├── types.rs             # Shared types
│       ├── download.rs          # Download manager
│       └── patch.rs             # Patching system
└── package.json
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) 1.70+

### Installation

1. Clone the repository:
```bash
git clone https://github.com/pandawancorp/pandawan-launcher.git
cd pandawan-launcher
```

2. Install dependencies:
```bash
npm install
```

3. Run in development mode:
```bash
npm run tauri:dev
```

4. Build for production:
```bash
npm run tauri:build
```

## CDN Setup

To distribute your games, you'll need a CDN or web server. The expected structure:

```
cdn.yourdomain.com/
└── games/
    └── quirheim-online/
        ├── manifest.json          # Game manifest
        ├── files/                 # Game files
        │   ├── game.exe
        │   ├── data/
        │   └── ...
        └── versions/
            └── 1.0.0/
                └── ...
```

### Game Manifest Format

Create a `manifest.json` for each game version:

```json
{
  "game_id": "quirheim-online",
  "name": "Quirheim Online",
  "version": "1.0.0",
  "build_number": 100,
  "description": "An epic MMORPG adventure",
  "icon_url": "https://cdn.example.com/games/quirheim-online/icon.png",
  "banner_url": "https://cdn.example.com/games/quirheim-online/banner.jpg",
  "executable": "QuirheimOnline.exe",
  "files": [
    {
      "path": "QuirheimOnline.exe",
      "hash": "sha256_hash_here",
      "size": 15000000,
      "url": "files/QuirheimOnline.exe"
    },
    {
      "path": "data/config.ini",
      "hash": "sha256_hash_here",
      "size": 1024,
      "url": "files/data/config.ini"
    }
  ],
  "launch_args": ["-launcher"]
}
```

### Generating Manifests

Use the included Python script to generate manifests from your build output:

```bash
python scripts/generate-manifest.py \
  --game-id quirheim-online \
  --name "Quirheim Online" \
  --version 1.0.0 \
  --build-number 100 \
  --executable "QuirheimOnline.exe" \
  --cdn-origin "https://cdn.pandawancorp.com" \
  --channel stable \
  --input-dir "./Builds/StandaloneWindows64-v1.0.0" \
  --output "manifest.json"
```

## Tauri Commands

The launcher exposes these commands to the frontend:

| Command | Description |
|---------|-------------|
| `fetch_game_manifest(url)` | Fetch game manifest from CDN |
| `install_game(manifest, baseUrl)` | Install or update a game |
| `launch_game(gameId)` | Launch an installed game |
| `uninstall_game(gameId)` | Remove a game installation |
| `get_installed_games()` | List all installed games |
| `check_game_update(gameId, manifest)` | Check if update is available |
| `verify_game(manifest, installPath)` | Verify game file integrity |
| `get_settings()` | Get launcher settings |
| `save_settings(settings)` | Save launcher settings |
| `select_install_folder()` | Open folder picker dialog |

## Self-Updates

The launcher uses Tauri's built-in updater. `src-tauri/updater.pub` is the single source of truth for the public key; `src-tauri/tauri.conf.json` is kept in sync automatically.

Before shipping a release you must:

1. Generate a minisign keypair:
   ```bash
   # Install minisign (https://jedisct1.github.io/minisign/)
   minisign -G -W -s updater.key -p src-tauri/updater.pub
   ```
   - Keep `updater.key` secret (store it as a CI secret, never commit it).
   - `src-tauri/updater.pub` can be committed.
2. Sync the public key into Tauri's config:
   ```bash
   npm run sync:updater-key
   ```
   This is also run automatically by `npm run tauri:dev` and `npm run tauri:build`.
3. Sign your update bundles and host the resulting `.sig` files alongside the update manifest.
4. Keep `updater.key` secret — store it in a CI secret, never commit it.

## Configuration

Settings are stored in:

- **Windows**: `%LOCALAPPDATA%\\com.pandawancorp.launcher/`
- **macOS**: `~/Library/Application Support/com.pandawancorp.launcher/`
- **Linux**: `~/.local/share/com.pandawancorp.launcher/`

## Unity Integration

To detect if your game was launched from the launcher in Unity:

```csharp
using UnityEngine;

public class LauncherIntegration : MonoBehaviour
{
    void Start()
    {
        string[] args = System.Environment.GetCommandLineArgs();
        
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "-launcher" && i + 1 < args.Length)
            {
                string launcherId = args[i + 1];
                Debug.Log($"Launched from Pandawan Launcher: {launcherId}");
                
                // Report playtime, check for updates, etc.
                break;
            }
        }
    }
}
```

## Roadmap

- [ ] Delta patching (bsdiff/xdelta) for large files
- [ ] Automatic update notifications
- [ ] Cloud saves synchronization
- [ ] Friends list and multiplayer integration
- [ ] Achievements system
- [ ] Discord Rich Presence
- [ ] Mod support
- [ ] Linux and macOS builds

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

Built with ❤️ by Pandawan Corp

Powered by [Tauri](https://tauri.app/), [React](https://react.dev/), and [Rust](https://www.rust-lang.org/)
