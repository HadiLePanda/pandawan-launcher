# Pandawan Launcher

A lightweight, Battle.net-style game launcher built with **Tauri**, **React**, and **Rust**. Designed for indie game developers to distribute their games with automatic patching, resume-capable downloads, and a modern UI.

> A screenshot will be added here: `screenshot.png`

## Features

- ðŸŽ® **Game Library Management** - Install, update, and launch games from a central library
- ðŸ“¦ **Smart Patching** - Only downloads changed files using hash-based verification
- â¯ï¸ **Resume Downloads** - Interrupted downloads automatically resume from where they left off
- âš¡ **Parallel Downloads** - Download multiple files concurrently for faster installation
- ðŸ”„ **Auto-Updates** - Games automatically check for and install updates
- â¬†ï¸ **Launcher Self-Updates** - The launcher checks for, downloads, and installs its own updates
- â±ï¸ **Playtime Tracking** - Track total playtime and last-played date for every game
- ðŸ”” **OS Notifications** - Get notified when installs finish or launcher updates are available
- ðŸŒ **Multi-Language** - Available in English and French
- ðŸŽ¨ **Modern UI** - Neutral dark theme inspired by Steam and Battle.net
- ðŸ”§ **Configurable** - Customizable install paths, bandwidth limits, and behavior settings
- ðŸ–¥ï¸ **Cross-Platform** - Built with Tauri for Windows, macOS, and Linux support

## Tech Stack

| Layer       | Technology                           |
| ----------- | ------------------------------------ |
| Frontend    | React 19 + TypeScript + Tailwind CSS |
| Backend     | Rust + Tauri                         |
| State       | Zustand                              |
| HTTP Client | reqwest (Rust)                       |
| Icons       | Lucide React                         |

## Architecture

```
pandawan-launcher/
â”œâ”€â”€ src/                          # React frontend
â”‚   â”œâ”€â”€ components/               # UI components
â”‚   â”‚   â”œâ”€â”€ AppHeader.tsx        # TitleBar status bar + MainNav
â”‚   â”‚   â”œâ”€â”€ GamesBar.tsx         # Pinned games shortcuts bar
â”‚   â”‚   â”œâ”€â”€ FiltersPanel.tsx     # Game-grid filters on the overview
â”‚   â”‚   â”œâ”€â”€ GamesPage.tsx        # Game library layout
â”‚   â”‚   â”œâ”€â”€ GamesHome.tsx        # Default game grid view
â”‚   â”‚   â”œâ”€â”€ GamePage.tsx         # Selected game detail view
â”‚   â”‚   â”œâ”€â”€ News.tsx             # News feed view
â”‚   â”‚   â”œâ”€â”€ NewsArticleView.tsx  # Full news article view
â”‚   â”‚   â”œâ”€â”€ Settings.tsx         # Settings modal
â”‚   â”‚   â”œâ”€â”€ DownloadsPage.tsx    # Active downloads view
â”‚   â”‚   â”œâ”€â”€ DownloadsPopup.tsx   # Downloads popover
â”‚   â”‚   â”œâ”€â”€ NotificationsPanel.tsx # Notifications dropdown
â”‚   â”‚   â”œâ”€â”€ PinManagerModal.tsx  # Manage pinned games
â”‚   â”‚   â”œâ”€â”€ UpdateBanner.tsx     # Launcher self-update banner
â”‚   â”‚   â””â”€â”€ VerifyGameModal.tsx  # File-integrity verification
â”‚   â”œâ”€â”€ lib/                      # Utilities, services, and state
â”‚   â”‚   â”œâ”€â”€ store.ts             # Zustand state management
â”‚   â”‚   â”œâ”€â”€ catalog-service.ts   # Remote/local/embedded catalog loading
â”‚   â”‚   â”œâ”€â”€ cdn.ts               # CDN URL helpers and game info resolver
â”‚   â”‚   â”œâ”€â”€ game-service.ts      # Tauri command wrappers for install/launch
â”‚   â”‚   â”œâ”€â”€ news-service.ts      # News feed loader
â”‚   â”‚   â”œâ”€â”€ commands.ts          # Typed Tauri invoke helpers
â”‚   â”‚   â”œâ”€â”€ download-channel.ts  # Download progress event mapping
â”‚   â”‚   â”œâ”€â”€ updater-service.ts   # Launcher self-update flow (check/download/relaunch)
â”‚   â”‚   â”œâ”€â”€ notifications.ts     # OS notifications (install/update complete, update available)
â”‚   â”‚   â”œâ”€â”€ i18n.ts              # i18next setup and language switching
â”‚   â”‚   â”œâ”€â”€ utils.ts             # Shared helpers (e.g. playtime formatting)
â”‚   â”‚   â”œâ”€â”€ logger.ts            # Structured logging (+ launcher.log in app log dir)
â”‚   â”‚   â””â”€â”€ window.ts            # Custom title-bar window controls
â”‚   â”œâ”€â”€ locales/                 # i18next resources (en/fr.json)
â”‚   â”œâ”€â”€ types/
â”‚   â”‚   â””â”€â”€ index.ts             # TypeScript type definitions
â”‚   â”œâ”€â”€ App.tsx                  # Main app component
â”‚   â”œâ”€â”€ main.tsx                 # Entry point
â”‚   â””â”€â”€ index.css                # Global styles + CSS variables
â”œâ”€â”€ src-tauri/                    # Rust backend
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ main.rs              # Entry point
â”‚       â”œâ”€â”€ lib.rs               # Main library with Tauri commands
â”‚       â”œâ”€â”€ types.rs             # Shared types
â”‚       â”œâ”€â”€ download.rs          # Download manager
â”‚       â””â”€â”€ patch.rs             # Patching system
â””â”€â”€ package.json
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

### Testing

```bash
npm test          # Frontend unit tests (Vitest)
npm run lint      # ESLint
npm run build     # TypeScript + Vite production build
```

Rust tests (`cargo test` in `src-tauri/`) require a Tauri-capable environment and are
validated in CI; they may fail on local Windows hosts with dynamic-link errors.

## CDN Setup

To distribute your games, you'll need a CDN or web server. The expected structure:

```
cdn.yourdomain.com/
â””â”€â”€ games/
    â””â”€â”€ quirheim-online/
        â”œâ”€â”€ manifest.json          # Game manifest
        â”œâ”€â”€ files/                 # Game files
        â”‚   â”œâ”€â”€ game.exe
        â”‚   â”œâ”€â”€ data/
        â”‚   â””â”€â”€ ...
        â””â”€â”€ versions/
            â””â”€â”€ 1.0.0/
                â””â”€â”€ ...
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
  --cdn-origin "https://pub-789d1bb0f3da4a99ae1024d53ea305d3.r2.dev" \
  --channel stable \
  --input-dir "./Builds/StandaloneWindows64-v1.0.0" \
  --output "manifest.json"
```

## Tauri Commands

The launcher exposes these commands to the frontend:

| Command                               | Description                  |
| ------------------------------------- | ---------------------------- |
| `fetch_game_manifest(url)`            | Fetch game manifest from CDN |
| `install_game(manifest, baseUrl)`     | Install or update a game     |
| `launch_game(gameId)`                 | Launch an installed game     |
| `uninstall_game(gameId)`              | Remove a game installation   |
| `get_installed_games()`               | List all installed games     |
| `get_game_installation(gameId)`       | Get one game's installation  |
| `check_game_update(gameId, manifest)` | Check if update is available |
| `verify_game(manifest, installPath)`  | Verify game file integrity   |
| `get_settings()`                      | Get launcher settings        |
| `save_settings(settings)`             | Save launcher settings       |
| `select_install_folder()`             | Open folder picker dialog    |
| `cancel_operation()`                  | Cancel the active operation  |
| `get_app_data_dir()`                  | Get the app data directory   |

## Self-Updates

The launcher uses Tauri's built-in updater.

- **Public key** (committed): `src-tauri/updater.pub` is the single source of truth.
  - Sync it into `src-tauri/tauri.conf.json` with `npm run sync:updater-key`.
    This also runs automatically before `tauri:dev` and `tauri:build`.
- **Secret key** (gitignored): `src-tauri/.secrets/updater.key` signs bundles.
  It is ignored by Git and must never be committed.
- **CI secret**: `TAURI_SIGNING_PRIVATE_KEY` must be set in GitHub Secrets so the
  release workflow can sign bundles.

### Checking your keys

```bash
npm run keys:check
```

Verifies the secret key exists, that `updater.pub` really matches it, and that
the public key is synced into `tauri.conf.json`. Run this first if the updater
misbehaves.

```bash
npm run keys:generate
```

**Only for a brand-new setup.** It refuses to run when a secret key already
exists, because regenerating invalidates every bundle you have already signed.
If no key exists yet, it creates one and syncs it.

Install minisign first if prompted:

```bash
winget install jedisct1.minisign    # Windows
brew install minisign               # macOS
```

## Publishing a game build

One command uploads a build to R2 and makes it visible to the launcher:

```bash
npm run publish:game -- \
  --game-id pandawan-rising \
  --channel alpha \
  --version 1.2.0-alpha.3 \
  --build-number 102 \
  --executable "QuirheimOnline.exe" \
  --name "Pandawan Rising" \
  --input-dir ./Builds/StandaloneWindows64
```

It generates the manifest, uploads the game files, then uploads the manifest.
**Files go up first on purpose** â€” the manifest is what tells a player's
launcher a build exists, so publishing it early would let someone resolve a
manifest whose files are not there yet.

Optional: `--description`, `--patch-notes <file.json>`, `--icon-url`,
`--banner-url`, `--output <path>`.

`--channel` accepts `stable`, `beta`, or `alpha`; anything else is rejected so
a typo cannot ship a build mislabelled as stable.

### Credentials

Put your R2 credentials in a local `.env` file (gitignored) so you never have to
paste secrets into a shell. Copy the block from `.env.example` into `.env` and
fill in real values:

```bash
R2_ACCOUNT_ID=<Cloudflare dashboard â†’ R2 â†’ Account ID>
R2_BUCKET=<bucket name from the R2 dashboard>
R2_CDN_ORIGIN=https://pub-xxxxxxxxxxxx.r2.dev
R2_ACCESS_KEY_ID=<R2 â†’ Manage R2 tokens>
R2_SECRET_ACCESS_KEY=<same, shown once>
```

`R2_ACCOUNT_ID` is **not** the value inside the `r2.dev` URL â€” that subdomain
encodes the bucket, not the account. Both are shown in the R2 dashboard.

A value already present in the real environment wins over `.env`, so CI can
inject secrets without a file. Never put real values in `.env.example` or any
committed file.

Requires [minisign](https://jedisct1.github.io/minisign/), Python, and the
[AWS CLI](https://aws.amazon.com/cli/) (`aws s3` talks to R2 over the
S3-compatible API; you do not need an AWS account).

### Versioning

`build-number` must increase on every build, across **all** channels â€” it is the
only value the launcher compares. `version` is display text and is never
compared, so ordering never depends on it.

```
stable  1.2.0            -> build 100
beta    1.3.0-beta.1     -> build 101
alpha   1.4.0-alpha.1    -> build 102
stable  1.3.0            -> build 103
```

### Rolling back

Keep the previous build's files in the bucket. If a build turns out broken,
republish the earlier version's manifest (same `build-number`, same files) and
players who already downloaded the bad build can move back down.

### Publishing launcher updates to Cloudflare R2

The release workflow builds and signs bundles into a **draft** GitHub Release (a
build record only), then mirrors them to an R2 bucket that the launcher's
updater endpoint actually reads:

```
R2 bucket
â””â”€â”€ launcher/
    â”œâ”€â”€ latest.json                       # updater manifest (never cached)
    â”œâ”€â”€ Pandawan Launcher_0.1.0_x64_en-US.msi
    â”œâ”€â”€ Pandawan Launcher_0.1.0_x64_en-US.msi.sig
    â””â”€â”€ ...
```

This keeps the repository private while letting players download without
authentication. R2 egress is free, so bandwidth costs nothing.

`latest.json` generated by `tauri-action` points at GitHub Release URLs, which
are not readable from a private repo. The workflow rewrites those URLs to the
public bucket before upload. The base URL is read from the committed updater
endpoint in `src-tauri/tauri.conf.json`, so the published manifest can never
drift from the endpoint the launcher actually polls:

```bash
node scripts/rewrite-updater-urls.mjs latest.json \
  --from-config src-tauri/tauri.conf.json out.json
```

**Repository secrets**

| Name                        | Purpose                        |
| --------------------------- | ------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY` | Signs bundles (required)       |
| `R2_ACCESS_KEY_ID`          | R2 API token ID (required)     |
| `R2_SECRET_ACCESS_KEY`      | R2 API token secret (required) |

**Repository variables**

| Name            | Example          | Purpose                    |
| --------------- | ---------------- | -------------------------- |
| `R2_ACCOUNT_ID` | `abc123`         | Builds the S3 endpoint URL |
| `R2_BUCKET`     | `pandawan-games` | Target bucket              |

The base URL needs no variable because it is derived from `tauri.conf.json`.
Attach the secrets and variables to a `production` GitHub Environment so they
are only exposed to the release job.

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
- [ ] Cloud saves synchronization
- [ ] Friends list and multiplayer integration
- [ ] Achievements system
- [ ] Discord Rich Presence
- [ ] Mod support
- [ ] Linux and macOS builds

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

Built with â¤ï¸ by Pandawan Corp

Powered by [Tauri](https://tauri.app/), [React](https://react.dev/), and [Rust](https://www.rust-lang.org/)
