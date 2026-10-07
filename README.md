# Pandawan Launcher

A game launcher that distributes and updates games. It is built with Tauri, React, and
Rust.

The launcher resolves games at runtime from a CDN. It ships with no game list of its
own. Publishers upload builds to R2. The launcher finds them there.

## Features

- Hash-based patching. The launcher downloads only changed files.
- Resume-capable, parallel downloads.
- Release channels per game: `stable`, `beta`, `alpha`.
- Signed launcher self-updates.
- Playtime tracking and OS notifications.
- English and French.

## Stack

React 19, TypeScript, Tailwind CSS, Zustand, Tauri 2, Rust, and reqwest.

## Get started

You need Node 18 or later, Rust, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
npm install
npm run tauri:dev
```

On Windows, `run-launcher.bat` does the same work. It first checks that cargo and the
updater keys exist. A double-click opens the output in a console window that stays
open on exit, so you can read a failed run.

```bash
npm test          # Vitest
npm run lint      # ESLint
npm run build     # Typecheck and production frontend build
```

Rust tests need a Tauri-capable environment. They run in CI.

```bash
cd src-tauri && cargo test
```

`src/lib/bindings.ts` is generated from the Rust command and event definitions.
Regenerate and reconcile it:

```bash
npm run bindings:export
```

## Publish

Publishing writes to Cloudflare R2. Copy the block from `.env.example` into a
gitignored `.env`. A value that is already set in the environment wins, so CI can
inject secrets without a file.

```bash
npm run publish:game -- \
  --game-id example-game --channel alpha \
  --version 1.2.0-alpha.3 --build-number 102 \
  --executable "Example Game.exe" --name "Example Game" \
  --input-dir ./Builds/Windows

npm run publish:catalog   # make new and changed games visible
npm run publish:meta      # edit a game's name, genres and artwork
npm run prune:builds -- --game-id example-game --keep 3
```

`npm run dashboard` opens a local control panel for these commands. It binds to
127.0.0.1 and holds your R2 credentials. Never deploy it. Its Services tab opens the
launcher and the website. It runs `run-launcher.bat` or `run-website.bat`, so each
process gets its own console window instead of a truncated log panel.

### CDN layout

```
{origin}/launcher/catalog.json                  # which games exist
{origin}/launcher/news.json
{origin}/games/{id}/{channel}/manifest.json
{origin}/games/{id}/{channel}/latest.json       # current version per platform
{origin}/games/{id}/{channel}/{version}/{platform}/...
```

Build files live under a version-stamped path. A one-year immutable cache header is
then correct. The manifest and catalog are mutable, so they are never cached.

`latest.json` exists because platforms ship independently. A flat `manifest.json`
cannot say "Windows is on 1.2.0, but macOS is on 1.1.0".

### Metadata

Name, description, genres, icon and banner live in two places. The two places drift
apart:

- `catalog.json` holds the publisher's display fields. The launcher prefers them.
- `manifest.json` holds what the build shipped with.

`publish:meta` writes both. It does not re-upload game files. It changes only the
fields that you name. Every other field keeps its published value.

### Versioning

`build-number` must increase on every build, across all channels. The launcher
compares only this value. `version` is display text. The launcher never compares it.

### Credentials

```bash
R2_ACCOUNT_ID=<Cloudflare dashboard -> R2 -> Account ID>
R2_BUCKET=<bucket name>
R2_CDN_ORIGIN=https://pub-xxxxxxxxxxxx.r2.dev
R2_ACCESS_KEY_ID=<R2 -> Manage R2 tokens>
R2_SECRET_ACCESS_KEY=<shown once>
```

`R2_ACCOUNT_ID` is not the value inside the `r2.dev` URL. That subdomain encodes the
bucket. Both values are in the R2 dashboard.

Publishing needs Python and the [AWS CLI](https://aws.amazon.com/cli/). `aws s3`
talks to R2 over the S3-compatible API. No AWS account is necessary.

## Self-updates

Tag a release to cut it. CI builds, signs and publishes it.

- `src-tauri/updater.pub` is the source of truth for the public key.
  `npm run sync:updater-key` copies it into `tauri.conf.json`. It runs before every
  build.
- The secret key lives in `src-tauri/.secrets/updater.key`, which is gitignored. Give
  it to CI verbatim as `TAURI_SIGNING_PRIVATE_KEY`. Do not re-encode it.
- Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` only if the key has a password. Without it,
  CI prompts and hangs.

Never hand-edit `plugins.updater.pubkey`. It must be the base64 of the whole
PublicKeyBox. The updater decodes it before it parses. `npm run keys:check` proves the
keypair works. A Rust test fails CI on a malformed value.

## Configuration

Settings are stored in the platform app-data directory:

- Windows: `%LOCALAPPDATA%\com.pandawancorp.launcher\`
- macOS: `~/Library/Application Support/com.pandawancorp.launcher/`
- Linux: `~/.local/share/com.pandawancorp.launcher/`

## Unity integration

The launcher starts each game with `-launcher`. To detect it:

```csharp
var args = System.Environment.GetCommandLineArgs();
for (int i = 0; i < args.Length; i++)
{
    if (args[i] == "-launcher" && i + 1 < args.Length)
        Debug.Log($"Launched from Pandawan Launcher: {args[i + 1]}");
}
```

## License

Proprietary. All rights reserved. See [LICENSE](LICENSE).
