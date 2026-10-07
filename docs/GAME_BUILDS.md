# Game Build Naming & Layout

The contract a Unity build script (or an AI agent automating one) must follow so
its output can be published to the launcher. Complements
[GAME_CATALOG.md](./GAME_CATALOG.md), which covers the CDN side.

## One rule per axis

Four independent things identify a build. Never pack them into one string.

| Axis         | Where it lives                       | Example          |
| ------------ | ------------------------------------ | ---------------- |
| Game slug    | catalog `id`, manifest `game_id`     | `example-game`   |
| Version      | manifest `version`                   | `0.4.0-alpha.3`  |
| Channel      | manifest `channel`                   | `alpha`          |
| Build number | manifest `build_number`              | `102`            |
| Platform     | directory name, launcher self-update | `windows-x86_64` |

### Channel is derived from the version, never passed separately

```
0.4.0                 -> stable
0.4.0-beta.2          -> beta
0.4.0-alpha.3         -> alpha
```

Deriving it removes a parameter that could contradict the version string. The
launcher's `generate-manifest.py --channel` must receive the derived value.

### Platform keys match Tauri

Use Tauri's `latest.json` platform keys exactly, so one vocabulary covers game
builds and launcher updates:

```
windows-x86_64
macos-aarch64
macos-x86_64
macos-universal
linux-x86_64
```

## Naming rules

- Lowercase, hyphen-separated. **No spaces anywhere** — a space becomes `%20` in
  the URLs the launcher requests.
- Game slug matches `^[a-z0-9-]+$`.
- Version follows semver: `MAJOR.MINOR.PATCH` with an optional
  `-alpha.N` / `-beta.N` / `-rc.N` prerelease.
- `build_number` is a single integer that **only ever increases across all
  channels and versions**. It is the only value the launcher compares, so
  `1.0.0` may legitimately be a higher build than `0.9.9`.

## Output layout

Builds land under `builds/` in the game repository, version and platform split
into separate directory levels:

```
builds/
└── example-game/
    └── 0.4.0-alpha.3/
        ├── windows-x86_64/                      <- published to the launcher
        │   ├── example-game.exe
        │   └── example-game_Data/
        ├── example-game-0.4.0-alpha.3-windows-x86_64.zip   <- archive / manual sharing
        └── build-report.json
```

Two artifacts, two purposes:

- **The unzipped directory** is what `npm run publish:game -- --input-dir`
  consumes. It must stay unzipped because the launcher patches per file: it
  downloads only the files whose SHA256 changed. Publishing a zip would force a
  full re-download on every update.
- **The zip** is for archival and handing a build to someone directly. It is not
  what the launcher installs.

## Exclusions

Remove before archiving or publishing. Unity emits the first one into every
build and it must never ship:

```
*_BackUpThisFolder_ButDontShipItWithYourGame/
.git/
.vs/
.idea/
*.csproj
*.sln
*.apk
*.aab
```

`generate-manifest.py` also excludes the Unity backup folder independently, so a
missed exclusion cannot silently add dead weight to every install. The rest are
build-script responsibility.

## `build-report.json`

The build script writes this beside the artifacts so the launcher publisher does
not have to guess parameters:

```json
{
  "gameId": "example-game",
  "version": "0.4.0-alpha.3",
  "channel": "alpha",
  "buildNumber": 102,
  "platform": "windows-x86_64",
  "executable": "example-game.exe",
  "unityVersion": "6000.0.23f1",
  "gitCommit": "a1b2c3d",
  "builtAt": "2026-10-01T00:00:00Z",
  "totalBytes": 442000000
}
```

The publisher reads it instead of taking eight command-line arguments, so the
values cannot drift between the build and the manifest.

## Git

Tag the game repository so a build is traceable:

```
example-game-v0.4.0-alpha.3
```

Pattern: `<game-slug>-v<version>`. Never reuse a tag. Pushing is opt-in — leave
it to the developer unless asked.

## Publishing

From the launcher repository:

```bash
npm run publish:game -- \
  --game-id example-game --name "Example Game" \
  --channel alpha --version 0.4.0-alpha.3 --build-number 102 \
  --executable "example-game.exe" \
  --input-dir "C:\...\example-game\builds\example-game\0.4.0-alpha.3\windows-x86_64"

npm run publish:catalog
```

`publish:catalog` is required whenever a game is added or its channel changes.
Without it the launcher cannot discover the game.

## Rollback

Keep the previous build's files in the bucket. Rolling back means republishing
the older manifest at the same channel path. Do not delete the files of a build
until every client has had time to move off it.
