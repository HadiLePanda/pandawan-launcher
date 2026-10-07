# Game Catalog & CDN

This launcher is data-driven: it ships with only a catalog URL and resolves games, manifests, and news at runtime.

## CDN layout

```
{origin}/launcher/catalog.json                  # game index (id, channel, display overrides)
{origin}/launcher/news.json                     # global news feed
{origin}/games/{id}/{channel}/manifest.json     # current build for the channel
{origin}/games/{id}/{channel}/latest.json       # per-platform current version
{origin}/games/{id}/{channel}/icon.png
{origin}/games/{id}/{channel}/banner.png
{origin}/games/{id}/{channel}/{version}/{platform}/...   # build bytes
```

Build bytes live under a version-stamped path so a one-year immutable cache header
is truthful — the bytes at a given URL never change. The manifest and catalog are
mutable and never cached.

`latest.json` exists because platforms ship independently: one `manifest.json`
cannot say "Windows is on 1.2.0 but macOS is still on 1.1.0". It maps each platform
to the version it is pinned at, and the launcher reads its own entry before
fetching that version's manifest.

### Artwork names are content-addressed

Uploaded art is stored as `<stem>-<sha256[:8]>.<ext>` — `icon-a4bcd7b8.png`, not
`icon.png`. A stable name cannot be cached for long, because a client that already
has it can never learn the file changed; that previously forced `no-cache` and
re-downloaded megabytes of artwork on every launch. Hashing the bytes puts a
changed image on a **new URL**, so the old object stays valid forever under the
one-year immutable header and clients pick up new art only by reading a document
that names it.

The consequences are worth stating plainly:

- Replacing artwork does **not** overwrite. The previous object stays on the bucket
  and keeps costing storage. `npm run prune:builds` does not touch these, so
  removing superseded art is a deliberate manual step. The dashboard's "Published
  artwork" list exists to make that visible, marking unreferenced objects.
- The bucket records nothing about which field an object belongs to. The dashboard
  derives that by comparing published URLs against the field values it loaded.
- Relative URLs work everywhere. `resolveCdnUrl()` in `src/lib/cdn.ts` resolves
  `/games/{id}/{channel}/icon-a4bcd7b8.png` against the CDN origin, so prefer
  relative paths in the catalog; absolute URLs pass through untouched.
- Accepted upload types are png/jpg/jpeg/webp/gif, capped at 12 MB. SVG is
  rejected: artwork renders through `<img>` from a remote origin, where an SVG can
  carry script. The bundled SVG placeholders are safe only because they ship inside
  the app rather than being fetched from the bucket.
- Upload through the dashboard's Games tab, or directly:
  `npm run publish:meta -- --game-id example-game --channel alpha --icon-file ./art/icon.png`.
  The script rewrites both `catalog.json` and `manifest.json` to point at the new
  object, so a client resolving a build without the catalog sees the same art.

## Editing news

The feed at `{origin}/launcher/news.json` is edited item by item from the
dashboard's **News** tab, or from the command line:

```bash
node scripts/publish-news.mjs --create --id spring-event --title "Spring Event" --category Event
node scripts/publish-news.mjs --update spring-event --excerpt "Now live."
node scripts/publish-news.mjs --move spring-event --up
node scripts/publish-news.mjs --delete spring-event --dry-run
```

Add `--dry-run` to any of them to see the diff without touching the bucket.

An item's fields are `title` and `excerpt` (both shown in the launcher), plus the
optional `content`, `date`, `category`, `gameId`, `url` and `imageUrl`. Only `id`
and `title` are actually required — that is what `news-service.ts` checks before
rendering, and the publisher refuses to write an item that would be dropped.

### An item has two copies, and both are written

`publish-news.mjs` updates the CDN document **and** `public/news.json` in the repo.
The second is not a convenience: `public/news.json` ships inside the app as the
offline fallback, and `publish-catalog.mjs` uploads that local file over the CDN one.
An edit that touched only the CDN copy would be reverted by the next catalog
publish, without any error.

> The same trap still exists for `catalog.json` and is not yet addressed:
> `publish-catalog.mjs` uploads `public/catalog.json`, so running the Games →
> **Publish catalog** button after a `publish:meta` game edit reverts that edit too.
> If you use the dashboard, edit games through the metadata panel and avoid the
> catalog button.

### Ordering

The array order in the feed is display order — the launcher renders it as-is, so
the first item is the newest shown at the top. `--move` reorders without rewriting
the items.

## Metadata lives in two places

Name, description, genres, icon and banner are described **twice**, and the two
copies drift:

- `catalog.json` — the publisher's display fields. The launcher prefers these.
- `manifest.json` — whatever the build shipped with. This is what a client sees
  when it resolves a build without the catalog.

`npm run publish:meta` (`scripts/publish-metadata.mjs`) writes both without
re-uploading a single game file, and only touches the fields you name; anything
unset keeps its published value. It writes a field when _either_ document differs,
so a catalog fixed by hand does not leave a stale name behind in the manifest.

## `catalog.json`

Minimal game index. It intentionally does **not** contain versions, manifest URLs, or news — those are resolved at runtime.

```json
{
  "schemaVersion": "1.0.0",
  "lastUpdated": "2026-07-08T00:00:00Z",
  "games": [
    {
      "id": "{id}",
      "channel": "stable",
      "name": "Game Name",
      "description": "Short description.",
      "developer": "Pandawan Corp",
      "genre": ["Action RPG"],
      "iconUrl": "https://pub-example.r2.dev/games/{id}/stable/icon.png",
      "bannerUrl": "https://pub-example.r2.dev/games/{id}/stable/banner.png",
      "supportedPlatforms": ["windows"]
    }
  ]
}
```

The manifest URL is derived from the catalog entry at runtime:

```
https://pub-example.r2.dev/games/{id}/{channel}/manifest.json
```

The launcher reads the latest version, file list, and patch notes from that manifest.

## `manifest.json`

Generated by `scripts/generate-manifest.py` (snake_case to match the Rust backend).

```json
{
  "game_id": "{id}",
  "name": "Game Name",
  "version": "1.0.0",
  "build_number": 1,
  "executable": "Game.exe",
  "description": "...",
  "icon_url": "https://pub-example.r2.dev/games/{id}/stable/icon.png",
  "banner_url": "https://pub-example.r2.dev/games/{id}/stable/banner.png",
  "release_date": "2026-07-08T00:00:00Z",
  "size_bytes": 2147483648,
  "patch_notes": [
    {
      "version": "1.0.0",
      "date": "2026-07-08",
      "notes": ["Initial release", "Added co-op mode"]
    }
  ],
  "files": [
    {
      "path": "Game.exe",
      "hash": "sha256...",
      "size": 123456,
      "url": "Game.exe",
      "compress": null
    }
  ]
}
```

Important notes:

- `files[].url` is **relative** to the manifest folder. The backend concatenates the manifest folder URL with this path.
- `version` is the single source of truth. The launcher compares it with the locally installed version to detect updates.
- `game_id` and `channel` must match the path segment in the CDN URL.

## `news.json`

Separate runtime feed. Not part of the catalog or the launcher binary.

```json
{
  "items": [
    {
      "id": "summer-event-2026",
      "title": "Summer Event",
      "excerpt": "New skins and challenges are live.",
      "date": "2026-07-08",
      "imageUrl": "https://pub-example.r2.dev/launcher/news/summer-event.png",
      "category": "Event",
      "url": "https://pandawancorp.com/news/summer-event"
    }
  ]
}
```

## Generating a manifest

Use the Python script from the game project's build pipeline:

```bash
python scripts/generate-manifest.py \
  --game-id {id} \
  --name "Game Name" \
  --version 1.0.0 \
  --build-number 1 \
  --executable "Game.exe" \
  --cdn-origin "https://pub-example.r2.dev" \
  --channel stable \
  --input-dir "./Builds/StandaloneWindows64-v1.0.0" \
  --output "manifest.json" \
  --patch-notes "patch-notes.json"
```

Uploading is `npm run publish:game`, which generates the manifest, uploads the
build bytes, then writes `manifest.json` and `latest.json` for the channel.
**Files go up first on purpose** — the manifest is the signal that a build exists,
so publishing it early would let a client resolve a manifest whose files are not
there yet. `npm run dashboard` wraps the same verb in a form.

To ship a new version, publish it. Build bytes go to a new version-stamped
directory, so the previous version stays downloadable and players can roll back
by republishing its manifest. No launcher rebuild, and no catalog edit unless the
game is new.

## Separation of concerns

| File            | Purpose                                 |
| --------------- | --------------------------------------- |
| `catalog.json`  | What games appear in the launcher       |
| `manifest.json` | Per-game file list, version, and hashes |
| `news.json`     | Company announcements feed              |

This keeps the launcher modular: adding a game only touches the catalog; shipping a version only touches the manifest; posting news only touches `news.json`.

## Local override (dev / QA)

Place `catalog.override.json` in the app data directory. The launcher will try it only after the remote catalog fails. End users never see or edit this file.
