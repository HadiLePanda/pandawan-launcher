# Pandawan Launcher

A game launcher for distributing and updating games, built with Tauri, React, and Rust.

Games are resolved at runtime from a CDN, so the launcher ships with no game list of
its own. Publishers upload builds to R2 and the launcher picks them up.

## Features

- Hash-based patching: only changed files are downloaded
- Resume-capable and parallel downloads
- Release channels (`stable`, `beta`, `alpha`) per game
- Signed launcher self-updates
- Playtime tracking and OS notifications
- English and French

## Stack

React 19, TypeScript, Tailwind CSS, Zustand, Tauri 2, Rust, reqwest.

## Getting started

Requires Node 18+, Rust, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your platform.

```bash
npm install
npm run tauri:dev
```

On Windows, `run-launcher.bat` does the same thing after checking that cargo and
the updater keys are present. Double-clicking it opens the output in a console
window that stays open on exit, so a failed run can be read.

```bash
npm test          # Vitest
npm run lint      # ESLint
npm run build     # Typecheck + production frontend build
```

Rust tests need a Tauri-capable environment and run in CI:

```bash
cd src-tauri && cargo test
```

`src/lib/bindings.ts` is generated from the Rust command and event definitions.
Regenerate and reconcile it with:

```bash
npm run bindings:export
```

## Publishing

Publishing targets Cloudflare R2. Copy the block from `.env.example` into a gitignored
`.env`; a value already set in the real environment wins, so CI can inject secrets
without a file.

```bash
npm run publish:game -- \
  --game-id example-game --channel alpha \
  --version 1.2.0-alpha.3 --build-number 102 \
  --executable "Example Game.exe" --name "Example Game" \
  --input-dir ./Builds/Windows

npm run publish:catalog   # make new/changed games visible
npm run publish:meta      # edit a game's name, genres and artwork
npm run prune:builds -- --game-id example-game --keep 3
```

`npm run dashboard` opens a local control panel for all of these. It binds to
127.0.0.1, holds your R2 credentials, and must never be deployed. Its Services tab
opens the launcher and website by running `run-launcher.bat` / `run-website.bat`,
so each gets a real console window to print into instead of a truncated log
panel.

### CDN layout

```
{origin}/launcher/catalog.json                  # which games exist
{origin}/launcher/news.json
{origin}/games/{id}/{channel}/manifest.json
{origin}/games/{id}/{channel}/latest.json       # per-platform current version
{origin}/games/{id}/{channel}/{version}/{platform}/...
```

Build files live under a version-stamped path so a one-year immutable cache header is
truthful. The manifest and catalog are mutable and never cached.

`latest.json` exists because platforms ship independently: a flat `manifest.json`
cannot say "Windows is on 1.2.0 but macOS is still on 1.1.0".

### Metadata

Name, description, genres, icon and banner live in **two** places that drift apart:
`catalog.json` (the publisher's display fields, which the launcher prefers) and
`manifest.json` (whatever the build shipped with). `publish:meta` writes both without
re-uploading any game files, and only touches the fields you name — everything else
keeps its published value.

### Versioning

`build-number` must increase on every build across all channels; it is the only value
the launcher compares. `version` is display text and is never compared.

### Credentials

```bash
R2_ACCOUNT_ID=<Cloudflare dashboard -> R2 -> Account ID>
R2_BUCKET=<bucket name>
R2_CDN_ORIGIN=https://pub-xxxxxxxxxxxx.r2.dev
R2_ACCESS_KEY_ID=<R2 -> Manage R2 tokens>
R2_SECRET_ACCESS_KEY=<shown once>
```

`R2_ACCOUNT_ID` is not the value inside the `r2.dev` URL — that subdomain encodes the
bucket. Both are in the R2 dashboard.

Publishing needs Python and the [AWS CLI](https://aws.amazon.com/cli/) (`aws s3` talks
to R2 over the S3-compatible API; no AWS account required).

## Self-updates

Releases are cut by tagging; CI builds, signs and publishes them.

- `src-tauri/updater.pub` is the source of truth for the public key. `npm run
sync:updater-key` copies it into `tauri.conf.json` and runs before every build.
- The secret key lives in `src-tauri/.secrets/updater.key` (gitignored). Supply it to CI
  verbatim as `TAURI_SIGNING_PRIVATE_KEY` — do not re-encode it.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only if the key has a password; otherwise CI
  prompts and hangs.

Never hand-edit `plugins.updater.pubkey`. It must be the base64 of the whole
PublicKeyBox, which the updater decodes before parsing. `npm run keys:check` proves the
keypair works, and a Rust test fails CI on a malformed value.

## Configuration

Settings are stored in the platform app-data directory:

- Windows: `%LOCALAPPDATA%\com.pandawancorp.launcher\`
- macOS: `~/Library/Application Support/com.pandawancorp.launcher/`
- Linux: `~/.local/share/com.pandawancorp.launcher/`

## Unity integration

Games are launched with `-launcher`. To detect it:

```csharp
var args = System.Environment.GetCommandLineArgs();
for (int i = 0; i < args.Length; i++)
{
    if (args[i] == "-launcher" && i + 1 < args.Length)
        Debug.Log($"Launched from Pandawan Launcher: {args[i + 1]}");
}
```

## License

MIT — see [LICENSE](LICENSE).
