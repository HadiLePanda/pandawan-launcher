# Release Checklist

Sticky-note guide for shipping a new Pandawan Launcher version.

## How a release moves

| Stage   | Who | What it does                                                                    |
| ------- | --- | ------------------------------------------------------------------------------- |
| Bump    | you | `npm run release` writes the version files, commits, tags and pushes            |
| Build   | CI  | `release.yml` builds the selected platforms and drafts the GitHub release       |
| Publish | CI  | merges `latest.json` into the bucket and refreshes the website's download index |

Windows is the exception. It is built on this machine (`npm run tauri:build`)
and published by `npm run release:local`, because a local build is faster than
CI and the signing key never leaves the machine.

## Files this touches

| File                        | What to change              |
| --------------------------- | --------------------------- |
| `package.json`              | `"version"`                 |
| `package-lock.json`         | `"version"` (top level)     |
| `src-tauri/Cargo.toml`      | `version` under `[package]` |
| `src-tauri/tauri.conf.json` | `"version"`                 |
| `src-tauri/Cargo.lock`      | `version` of the app crate  |

`npm run version:set -- 0.2.0` writes all five from `package.json`.
`npm run version:check` proves they agree, and CI runs the same check. The lock is in
the list because npm keeps a version of its own there and `npm ci` never rewrites it.

## Key files you must have

- `src-tauri/updater.pub` — minisign **public** key, committed to the repo.
- `src-tauri/.secrets/updater.key` — minisign **secret** key, **never committed**.
- GitHub Secrets:
  - `TAURI_SIGNING_PRIVATE_KEY` - the **verbatim contents of `updater.key`**:
    `gh secret set TAURI_SIGNING_PRIVATE_KEY < src-tauri/.secrets/updater.key`.
    `tauri signer generate` already writes that file base64-encoded and the Tauri
    CLI base64-decodes it, so do NOT re-encode it and do NOT paste raw minisign text.
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - only if the key has a password. Without
    it the CLI prompts interactively and the CI build hangs.

Never generate keys with the `minisign` CLI. The Rust `minisign` crate that Tauri
uses rejects the empty-password key format that `minisign -G` writes, so the two
formats are not interchangeable. Use `npm run keys:generate` (which wraps
`tauri signer generate`).

`npm run tauri:build` syncs `updater.pub` into `tauri.conf.json` before it
builds. CI builds from the committed file and does not sync, so run
`npm run sync:updater-key` and commit whenever `updater.pub` changes.

## Steps

1. **Make sure `main` is green** (CI passes).

2. **Cut the release from `main`.** A dry run is the default:

   ```bash
   npm run release -- minor            # preview: 0.3.0 -> 0.4.0
   npm run release -- minor --confirm  # do it
   ```

   The real run writes the version files listed above, commits only those files, tags
   `v<version>`, pushes the branch, then pushes the tag. With no level it bumps
   the patch version. It refuses a non-semver version, a branch other than
   `main`, a dirty tree (untracked files do not count) and a tag that already
   exists. The dry run reports the same refusals.

3. **Watch the build.** The tag push triggers `.github/workflows/release.yml`:

   - A plan job turns the `platforms` input into the build matrix. A tag push
     carries no input, so it builds macOS (universal) and Linux (`.deb`).
     Windows is off by default because it is built locally. Ask for it with
     `gh workflow run release.yml -f platforms=windows,macos,linux`.
   - Each leg builds and signs its bundle and drafts a GitHub release. The
     draft is a build record: its asset URLs point at R2, so nothing needs the
     GitHub copy public.
   - The `publish-updater` job rewrites `latest.json`'s asset URLs to the
     endpoint committed in `src-tauri/tauri.conf.json`, **merges** its entries
     into the manifest already on the bucket at the same version
     (`scripts/lib/latest-merge.mjs`), uploads the bundles under an immutable
     cache header and `latest.json` with no-store, then refreshes
     `launcher/downloads.json` with `publish-launcher.mjs --index-only`, which
     folds its platforms into the live index instead of replacing it.

4. **Publish Windows from this machine:**

   ```bash
   npm run tauri:build                      # signed NSIS bundle; needs updater.key
   npm run release:local                    # dry run: report what would upload
   npm run release:local -- --confirm
   ```

   The publisher takes the `_<version>_` installer (an older build's installer
   is refused by name), uploads it with its `.sig`, merges the Windows entries
   into the bucket's `latest.json`, and replaces only the Windows group in
   `downloads.json`, so the macOS and Linux entries CI wrote survive. The
   Releases page drives the same two steps under "build Windows on this
   machine".

5. **Nothing further is needed from you.** Players update from the endpoint in
   `src-tauri/tauri.conf.json` (the `launcher/latest.json` path on R2).

## Repairs

- **The tag's own commit is what failed:** move the tag onto the fix and
  rebuild the same version:

  ```bash
  npm run retag                # dry run
  npm run retag -- --confirm   # delete the remote tag, re-point it at HEAD, push
  ```

  It refuses a dirty tree and a tag already at HEAD, because a push of an
  unchanged ref fires no run. Re-tag only while nothing was published for that
  version: the bucket still serves the previous one, so the number is free to
  rebuild.

- **The build passed but the R2 upload failed:** publish from this machine:

  ```bash
  npm run release:publish -- --tag v0.4.0 --confirm
  ```

  It reads the signed assets off the draft release, so no rebuild happens.

- **Republish without rebuilding:**
  `gh workflow run release.yml -f publish_only=true -f tag=v0.4.0`.

- Every verb above has a button on **Launcher → Releases** in the dashboard
  (`npm run dashboard`). The page also shows the tag's CI status, the failed
  job names and the failure's own annotation (a runner billing block, a
  missing secret).

## Code signing

Two signatures, and only one exists today.

| Signature                       | Who checks it                              | State                       |
| ------------------------------- | ------------------------------------------ | --------------------------- |
| **Updater** (minisign)          | the launcher, before it installs an update | done (`npm run keys:check`) |
| **Code** (Authenticode / Apple) | Windows SmartScreen, macOS Gatekeeper      | **not configured**          |

Without the second, Windows shows "Unknown publisher" and refuses the install for anyone
who blocks unknown publishers, and macOS will not open the app at all. `npm run
tauri:build` prints the Windows installer's state after every build.

### Windows

Windows is built on this machine, so the certificate goes there.

1. Buy a code-signing certificate. OV clears the publisher prompt; EV also starts with
   SmartScreen reputation.
2. Import it into the build machine's certificate store:

   ```powershell
   Import-PfxCertificate -FilePath .\codesign.pfx -CertStoreLocation Cert:\CurrentUser\My
   ```

3. Put the thumbprint in `bundle.windows.certificateThumbprint` in
   `src-tauri/tauri.conf.json` and commit it.

### macOS (CI)

The bundler reads the Apple credentials from the environment, so this is secrets rather
than code. Add them in the repository settings and to the `env:` of the "Build and
release Tauri bundle" step in `.github/workflows/release.yml`:

```yaml
APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }} # base64 of the .p12
APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }} # Developer ID Application: ...
APPLE_ID: ${{ secrets.APPLE_ID }} # notarisation
APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }} # an app-specific password
APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

Nothing else changes: absent, the build is unsigned, which is what it is today. Do not
add them empty - an empty `APPLE_CERTIFICATE` is a certificate the bundler tries and
fails to import.

## Notes

- Tags must match `v<major>.<minor>.<patch>` with an optional prerelease
  suffix (e.g. `v0.2.0`, `v0.2.0-beta.1`) to trigger the workflow.
- The release stays a draft; it is the build record, not the download source.
- If `TAURI_SIGNING_PRIVATE_KEY` is missing, the build will fail — the workflow checks the public key exists first, but the secret itself must be set in GitHub.
