/**
 * Pandawan publishing dashboard.
 *
 * A local-only control panel for the R2 publishing scripts. It exists so the
 * publish verbs are a form instead of a command line, and so platform drift is
 * visible: channels ship per platform, so "windows is on 0.4.0 but mac is still
 * on 0.3.9" is the normal state of a project mid-release and should be obvious.
 *
 *   npm run dashboard [-- --port 4400]
 *
 * SECURITY - this process holds the R2 secret key and can delete bucket
 * objects, so it is a local admin tool and must never ship to players.
 *
 * Three independent reasons it is safe today:
 *
 *  1. It is not in the shipped artifact. The launcher bundles the compiled Rust
 *     binary plus dist/ (the Vite frontend output). `scripts/` is never part of
 *     it, and `bundle.resources` is unset. src-tauri/tests/bundle_contents_tests.rs
 *     fails if that ever changes, so this cannot be broken by accident.
 *
 *  2. It binds 127.0.0.1, and additionally rejects any request whose Host header
 *     is not loopback. The second check blocks DNS rebinding, where a page the
 *     user visits resolves their hostname to 127.0.0.1 and then drives this
 *     server with the user's credentials.
 *
 *  3. It is not committed with credentials. R2_ACCESS_KEY_ID and
 *     R2_SECRET_ACCESS_KEY come from .env or the environment, and .env is
 *     gitignored. If this repository ever leaked, the dashboard source would
 *     come with it but not the keys.
 *
 * Do not "fix" the host check by allowing LAN addresses, and do not add a
 * deploy mode. If this ever needs remote access, it needs real authentication
 * and a TLS terminator in front of it, not a loosened bind address.
 */
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3, listKeysWithMeta, loadDotEnv, r2Config } from './lib/r2.mjs';
// The field contract is shared with the publisher rather than restated here, so
// the form cannot offer a field the script would silently ignore. The read side
// lives in a module so it can be tested without booting a server that holds the
// R2 keys.
import { FIELDS } from './lib/metadata-fields.mjs';
import { readGameMetadata } from './lib/game-metadata.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.join(here, 'dashboard');

loadDotEnv();
const { cdnOrigin, endpoint, bucket } = r2Config();

const portArg = process.argv.indexOf('--port');
const PORT = portArg > -1 ? Number(process.argv[portArg + 1]) : 4400;

const PLATFORMS = ['windows', 'macos', 'linux'];
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/**
 * Every game, channel, version and platform currently on the bucket.
 *
 * Built from one recursive listing rather than a fetch per game: the key paths
 * already say which versions exist for which platform, and latest.json supplies
 * the authoritative version/build per platform.
 */
async function buildInventory() {
  const keys = await listKeysWithMeta(S3.s3Uri(bucket, 'games/'), { endpoint });
  const games = new Map();

  const channelOf = (key) => {
    const parts = key.replace(/^games\//, '').split('/');
    return parts.length >= 2 ? { id: parts[0], channel: parts[1], parts } : null;
  };

  const bucketFor = (id) => {
    if (!games.has(id)) games.set(id, new Map());
    return games.get(id);
  };

  // A version is identified by the manifest sitting directly beneath it. Inferring
  // it from the path shape alone misreads a flat publish — a game whose files sit
  // directly in the channel directory reports its first folder as a version.
  //
  // Each version carries the newest timestamp among its objects, which is the real
  // ship time. Reading it from the versioned manifest's HTTP header instead would
  // report when that manifest was written, which for a backfilled build is today
  // rather than the day it was published.
  const stamp = (record, iso) => {
    if (iso && (!record.lastModified || iso > record.lastModified)) {
      record.lastModified = iso;
    }
  };

  // A flat channel's ship time lives on the channel itself, since there is no
  // version directory to hang it off.
  const flatStamps = new Map();

  for (const entry of keys) {
    const loc = channelOf(entry.key);
    if (!loc) continue;
    const rest = loc.parts.slice(2);
    if (rest.length === 1 && rest[0] === 'manifest.json') {
      // A flat, pre-version-stamped channel. It has no version directory at all,
      // so it must be registered here or it never appears in the inventory.
      const channels = bucketFor(loc.id);
      if (!channels.has(loc.channel)) channels.set(loc.channel, new Map());
      const key = `${loc.id}/${loc.channel}`;
      const current = flatStamps.get(key);
      if (entry.lastModified && (!current || entry.lastModified > current)) {
        flatStamps.set(key, entry.lastModified);
      }
      continue;
    }
    if (rest.length !== 2 || rest[1] !== 'manifest.json') continue;
    const channels = bucketFor(loc.id);
    if (!channels.has(loc.channel)) channels.set(loc.channel, new Map());
    const versions = channels.get(loc.channel);
    if (!versions.has(rest[0])) versions.set(rest[0], { platforms: new Set(), lastModified: null });
    continue;
  }

  // Everything inside a known version directory belongs to that build. This pass
  // both records platform subdirectories and stamps the build's ship time.
  for (const entry of keys) {
    const loc = channelOf(entry.key);
    if (!loc) continue;
    const channels = bucketFor(loc.id);
    const versions = channels.get(loc.channel);
    const record = versions?.get(loc.parts[2]);
    if (!record) continue;
    if (PLATFORMS.includes(loc.parts[3])) record.platforms.add(loc.parts[3]);
    // Manifests are excluded from the timestamp: they are metadata that can be
    // rewritten long after the build shipped, and including them would report when
    // the manifest was last touched rather than when the build was published.
    if (!loc.parts.includes('manifest.json')) stamp(record, entry.lastModified);
  }

  const result = [];
  for (const [id, channels] of games) {
    const channelList = [];
    for (const [channel, versions] of channels) {
      const published = [...versions.entries()]
        .map(([version, record]) => ({
          version,
          platforms: record.platforms.size > 0 ? [...record.platforms].sort() : ['windows'],
        }))
        .sort((a, b) => (a.version < b.version ? 1 : -1));

      let latest = null;
      try {
        const res = await fetch(`${cdnOrigin}/games/${id}/${channel}/latest.json`);
        if (res.ok) latest = await res.json();
      } catch {
        latest = null;
      }

      // A channel with no index still serves its flat manifest, so the launcher
      // installs it. Reporting every platform as empty would say the opposite.
      if (!latest) {
        try {
          const res = await fetch(`${cdnOrigin}/games/${id}/${channel}/manifest.json`);
          if (res.ok) {
            const manifest = await res.json();
            latest = { windows: { version: manifest.version, build: manifest.build_number } };
          }
        } catch {
          latest = null;
        }
      }

      channelList.push({
        channel,
        latest,
        published,
        // When each platform actually shipped, from the bucket listing rather than
        // an HTTP header: the versioned manifest of a backfilled build was written
        // today, while its files carry the day it was really published.
        updated: shipTimes(versions, flatStamps.get(`${id}/${channel}`), latest),
        // Driven by latest.json rather than by path shape, since a flat publish
        // has no platform directories to read from.
        platforms:
          Object.keys(latest ?? {}).length > 0
            ? Object.keys(latest)
            : PLATFORMS.filter((p) => published.some((v) => v.platforms.includes(p))),
      });
    }
    result.push({ id, channels: channelList });
  }

  return result.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Ship time per platform, taken from the version each one is pinned to.
 *
 * A flat channel has no version directory, so it falls back to the channel's own
 * timestamp. Version drift says there is a gap; these say how big.
 */
function shipTimes(versions, flatStamp, latest) {
  const stamps = {};
  for (const platform of Object.keys(latest ?? {})) {
    const record = versions.get(latest[platform].version);
    stamps[platform] = record?.lastModified ?? flatStamp ?? null;
  }
  return stamps;
}

/** Channels where the platforms disagree on the current version. */
function findDrift(inventory) {
  const drift = [];
  for (const game of inventory) {
    for (const channel of game.channels) {
      const versions = Object.values(channel.latest ?? {}).map((entry) => entry.version);
      if (new Set(versions).size > 1) {
        drift.push({ gameId: game.id, channel: channel.channel, versions: channel.latest });
      }
    }
  }
  return drift;
}

function rejectRebinding(req, res) {
  const host = (req.headers.host ?? '').split(':')[0].replace(/^\[|\]$/g, '');
  if (LOOPBACK.has(host)) return false;
  res.writeHead(403, { 'content-type': 'text/plain' });
  res.end('This dashboard only answers requests from localhost.');
  return true;
}

/**
 * What is currently published for the launcher, and what exists to publish.
 *
 * Two independent sources, because they answer different questions:
 *  - the live bucket tells players what they get today;
 *  - the GitHub release tells us what CI has already built and signed.
 *
 * A tag can be signed but unpublished (CI finished, publish not run yet), and an
 * artifact can be published from a tag with no local copy - so both are shown.
 */
async function launcherStatus() {
  const repoRoot = path.resolve(here, '..');

  // What players get right now. Fetched over HTTP rather than through the API so
  // this reflects exactly what an updater would see, caching included.
  let published = null;
  try {
    const response = await fetch(`${cdnOrigin}/launcher/latest.json`);
    if (response.ok) {
      const manifest = await response.json();
      const targets = Object.keys(manifest.platforms ?? {});
      published = {
        version: manifest.version ?? null,
        targets,
        artifactCount: new Set(Object.values(manifest.platforms ?? {}).map((entry) => entry.url))
          .size,
      };
    }
  } catch {
    // Nothing published, or the network is down. Both are shown as "not published"
    // rather than failing the whole panel.
  }

  // Which releases exist, newest first.
  let releases = [];
  try {
    const out = spawnSync('gh', ['release', 'list', '--limit', '10', '--json', 'tagName,isDraft'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      shell: false,
    });
    if (out.status === 0 && out.stdout) releases = JSON.parse(out.stdout);
  } catch {
    // gh missing or not logged in; the panel still works without the list.
  }

  const packageVersion = JSON.parse(
    await readFile(path.join(repoRoot, 'package.json'), 'utf-8')
  ).version;

  return { published, releases, packageVersion, cdnOrigin };
}

async function serveStatic(res, name) {
  const file = path.join(assetDir, name);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': mimeTypes[path.extname(file)] ?? 'text/plain' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}
/** Parse a JSON request body, answering 400 itself on malformed input. */
async function readJson(req, res) {
  const raw = await new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
  });

  try {
    return JSON.parse(raw || '{}');
  } catch {
    res.writeHead(400).end('bad json');
    return null;
  }
}

/**
 * Run a publishing script and stream its output as server-sent events.
 *
 * The scripts are not reimplemented here on purpose: publish-game.mjs carries the
 * channel/version guard, the version-stamped layout, platform validation and the
 * stale-multipart cleanup. A dashboard that duplicated that logic would quietly
 * lose every one of them.
 */
function runScript(name, args, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const send = (event, data) => res.write(`event: ${event}\ndata: ${data}\n\n`);

  const child = spawn(process.execPath, [path.join(here, name), ...args], {
    cwd: path.resolve(here, '..'),
    env: process.env,
  });

  child.stdout.on('data', (chunk) => send('output', String(chunk)));
  child.stderr.on('data', (chunk) => send('output', String(chunk)));
  child.on('error', (err) => send('error', String(err)));
  child.on('close', (code) => {
    send('done', JSON.stringify({ code }));
    res.end();
  });
}

const server = http.createServer(async (req, res) => {
  if (rejectRebinding(req, res)) return;

  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/inventory') {
    try {
      const inventory = await buildInventory();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ inventory, drift: findDrift(inventory) }));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (url.pathname === '/api/publish' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (!payload) return;

    // Args cross as an array and go to spawn without a shell, so nothing typed
    // into the form can become a command.
    const argv = Array.isArray(payload.args) ? payload.args.map(String) : [];
    runScript('publish-game.mjs', argv, res);
    return;
  }

  if (url.pathname === '/api/prune' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (!payload) return;

    // prune-builds deletes build directories, so its argv is assembled here from
    // named fields rather than forwarded: the form cannot smuggle in flags like
    // --clean-flat or --older-than that the UI never offers.
    const gameId = String(payload.gameId ?? '').trim();
    const channel = String(payload.channel ?? '').trim();
    // prune-builds parses its own argv and treats any bare `--token` as a flag, so
    // a value starting with one would silently turn into a different option.
    if (!gameId || gameId.startsWith('--') || channel.startsWith('--')) {
      res.writeHead(400).end('game and channel must be names, not flags');
      return;
    }

    const argv = ['--game-id', gameId, '--channel', channel || 'stable'];
    argv.push('--keep', String(Number(payload.keep) | 0));
    // The script's own prompt reads a keystroke from a console this stream has no
    // access to, so --dry-run is the default and a real run needs confirm: true.
    argv.push(payload.confirm ? '--yes' : '--dry-run');
    runScript('prune-builds.mjs', argv, res);
    return;
  }

  if (url.pathname === '/api/catalog' && req.method === 'POST') {
    // publish-catalog.mjs takes no arguments at all: it publishes public/catalog.json.
    runScript('publish-catalog.mjs', [], res);
    return;
  }

  // --- Game metadata -------------------------------------------------------
  //
  // Editing metadata is a different verb from publishing a build: the build
  // already exists and only the presentation layer changes. The panel loads what
  // is live first so an edit starts from the truth rather than from a blank form,
  // which is what stops a display name being typed over a good one by accident.

  if (url.pathname === '/api/meta' && req.method === 'GET') {
    const gameId = url.searchParams.get('gameId') ?? '';
    const channel = url.searchParams.get('channel') ?? '';
    if (!gameId || !channel) {
      res.writeHead(400).end('gameId and channel are required');
      return;
    }
    try {
      const data = await readGameMetadata(gameId, channel, { cdnOrigin, fields: FIELDS });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (url.pathname === '/api/meta/publish' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (!payload) return;

    // The argument list is assembled here from named fields rather than
    // forwarded, for the same reason prune does it: the form must not be able to
    // pass through a flag the UI never offers.
    const argv = ['--game-id', String(payload.gameId ?? '').trim()];
    argv.push('--channel', String(payload.channel ?? '').trim());
    if (payload.dryRun) argv.push('--dry-run');

    for (const field of FIELDS) {
      const value = payload[field.flag];
      // An absent key means "leave whatever is published". That is what makes a
      // partial edit safe, so the distinction between absent and empty has to
      // survive all the way to here.
      if (value === undefined || value === null) continue;
      const text = String(value).trim();
      // An emptied text field is a real intent: it clears the value. An emptied
      // list field is not, since a comma list cannot express "no genres" and
      // writing [] would silently erase the field.
      if (text === '' && field.list) continue;
      argv.push(`--${field.flag}`, text);
    }

    for (const [flag, key] of [
      ['icon-file', 'iconFile'],
      ['banner-file', 'bannerFile'],
    ]) {
      const file = payload[key];
      if (typeof file !== 'string' || !file.trim()) continue;
      const localPath = path.resolve(file.trim());
      if (!existsSync(localPath)) {
        res.writeHead(400).end(`No such file: ${file}`);
        return;
      }
      argv.push(`--${flag}`, localPath);
    }

    runScript('publish-metadata.mjs', argv, res);
    return;
  }

  // --- Launcher releases -------------------------------------------------
  //
  // The launcher ships through a different pipeline than games: CI builds and
  // signs the bundles, and only then is there anything to publish. So these
  // actions are deliberately narrower than the game ones - the dashboard never
  // builds or signs, it only publishes what already exists.

  if (url.pathname === '/api/launcher/status' && req.method === 'GET') {
    try {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(await launcherStatus()));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (url.pathname === '/api/launcher/publish' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (!payload) return;
    // The tag is validated against the release tag pattern before it is passed
    // on, so a value from the form can never become an option rather than an
    // argument (publish-launcher treats anything starting with -- as a flag).
    const tag = String(payload.tag ?? '').trim();
    if (!/^v\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(tag)) {
      res.writeHead(400).end('tag must look like v0.1.1');
      return;
    }
    const argv = ['--tag', tag];
    // --dry-run changes nothing in the bucket, so it is the default and a real
    // upload has to be asked for explicitly.
    if (payload.confirm) argv.push('--confirm');
    runScript('publish-launcher.mjs', argv, res);
    return;
  }

  if (url.pathname === '/api/launcher/keys' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (!payload) return;
    // keys:check only reads the key and signs a throwaway file, so it is always
    // safe to run from here.
    runScript('check-updater-keys.cjs', [], res);
    return;
  }

  if (url.pathname === '/api/launcher/release' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (!payload) return;
    const level = ['patch', 'minor', 'major'].includes(payload.level) ? payload.level : 'patch';
    const argv = [level];
    if (payload.dryRun) argv.push('--dry-run');
    runScript('release.mjs', argv, res);
    return;
  }

  await serveStatic(res, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dashboard on http://127.0.0.1:${PORT}`);
  console.log(`Bucket: ${bucket}`);
});
