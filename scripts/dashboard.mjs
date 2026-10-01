/**
 * Pandawan publishing dashboard.
 *
 * A local-only control panel for the R2 publishing scripts. It exists so the
 * publish verbs are a form instead of a command line, and so platform drift is
 * visible: channels ship per platform, so "windows is on 0.4.0 but mac is still
 * on 0.3.9" is the normal state of a project mid-release and should be obvious.
 *
 *   node scripts/dashboard.mjs [--port 4400]
 *
 * SECURITY: it holds the R2 secret key, so it binds 127.0.0.1 and rejects any
 * request whose Host header is not loopback. That blocks DNS rebinding, where a
 * page the user visits resolves their hostname to 127.0.0.1 and then talks to
 * this server with the user's credentials.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3, listKeysWithMeta, loadDotEnv, r2Config } from './lib/r2.mjs';

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
/**
 * Run a publish script and stream its output as server-sent events.
 *
 * The scripts are not reimplemented here on purpose: publish-game.mjs carries the
 * channel/version guard, the version-stamped layout, platform validation and the
 * stale-multipart cleanup. A dashboard that duplicated that logic would quietly
 * lose every one of them.
 */
function runPublish(args, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const send = (event, data) => res.write(`event: ${event}\ndata: ${data}\n\n`);

  const child = spawn(process.execPath, [path.join(here, 'publish-game.mjs'), ...args], {
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
    const body = await new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
      });
      req.on('end', () => resolve(raw));
    });

    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      res.writeHead(400).end('bad json');
      return;
    }

    // Args cross as an array and go to spawn without a shell, so nothing typed
    // into the form can become a command.
    const argv = Array.isArray(payload.args) ? payload.args.map(String) : [];
    runPublish(argv, res);
    return;
  }

  await serveStatic(res, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dashboard on http://127.0.0.1:${PORT}`);
  console.log(`Bucket: ${bucket}`);
});
