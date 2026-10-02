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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
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

// Module scope on purpose: repoRoot also appears as a local inside
// launcherStatus(), which a module-level service list cannot see.
const repoRoot = path.resolve(here, '..');

// The public download page is a separate repository next to this one.
const siteRoot = path.resolve(repoRoot, '..', 'pandawan-launcher-site');

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

/**
 * Every dev surface, as data.
 *
 * `port` is what makes "is it up" answerable: a service counts as running when
 * something is listening there, which is the same thing the user would discover
 * by opening the URL and seeing a connection error. It also lets the dashboard report
 * a target as already up when the dashboard did not start it, which is the honest
 * answer and stops the Stop button from claiming to own someone else's process.
 *
 * `launcher` and `frontend` deliberately share port 1420, because tauri dev
 * starts vite itself. Only one of them can run at a time.
 */
const SERVICES = [
  {
    id: 'launcher',
    name: 'Launcher',
    note: 'Tauri app with hot reload. First build takes minutes.',
    cwd: repoRoot,
    command: 'npm',
    args: ['run', 'tauri:dev'],
    port: 1420,
    url: null,
  },
  {
    id: 'frontend',
    name: 'Launcher frontend',
    note: 'Vite only, in your browser. Shares port 1420 with the launcher.',
    cwd: repoRoot,
    command: 'npm',
    args: ['run', 'dev'],
    port: 1420,
    url: 'http://localhost:1420',
  },
  {
    id: 'site',
    name: 'Website',
    note: 'pandawan-launcher-site, via wrangler pages dev.',
    cwd: siteRoot,
    command: 'npm',
    args: ['run', 'dev'],
    port: 8788,
    url: 'http://127.0.0.1:8788',
    requires: siteRoot,
  },
  {
    id: 'dashboard',
    name: 'Publishing dashboard',
    note: 'Local R2 publish panel. Needs .env for credentials.',
    cwd: repoRoot,
    command: 'npm',
    args: ['run', 'dashboard'],
    port: 4400,
    url: 'http://127.0.0.1:4400',
  },
  ];

/**
 * Crash-safe record of what this hub started.
 *
 * Why this exists: on Windows, closing a console app does NOT reliably deliver
 * SIGINT or SIGTERM, and process.on('exit') does not run when the window is
 * closed with the X button - which is precisely how run-dashboard.bat ends. So
 * the reap-on-exit handler is a best effort, not a guarantee, and a hard kill
 * would strand every tree it started.
 *
 * The manifest is the real guarantee: each started pid is written to disk with
 * its process start time, and the next hub launch reaps anything from a previous
 * run that is still alive. Start time is what makes this safe - a recycled pid
 * belonging to some unrelated program will not match, so it is never killed.
 */
const manifestPath = path.join(os.tmpdir(), 'pandawan-dashboard-services.json');

/**
 * Read a process's start time, or null if it is gone.
 *
 * Retries, because a process spawned a moment ago is not always visible to
 * Get-Process yet. Returning null on the first miss would record a pid with no
 * identity, and an unverifiable pid must never be killed later.
 */
function processStartedAt(pid, attempts = 5) {
  const script =
    'try { $p = Get-Process -Id ' + pid + ' -ErrorAction Stop; ' +
    'Write-Output $p.StartTime.ToUniversalTime().ToString("o") } catch { Write-Output "" }';
  for (let i = 0; i < attempts; i++) {
    const out = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
    const value = (out.stdout ?? '').trim();
    if (value) return value;
    spawnSync('ping', ['-n', '2', '127.0.0.1'], { stdio: 'ignore' });
  }
  return null;
}

function readManifest() {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return [];
  }
}

function writeManifest(entries) {
  try {
    writeFileSync(manifestPath, JSON.stringify(entries, null, 2));
  } catch {
    // A missing manifest costs a possible orphan on a hard kill; it must never
    // stop the dashboard from starting.
  }
}

/** Mirror the live map to disk so the next launch can clean up after this one. */
function persist() {
  writeManifest(
    [...started.values()].map((e) => ({ pid: e.pid, startedAt: e.startedAt, id: e.service.id }))
  );
}

/** Kill anything a previous hub run left behind, ignoring pids that were reused. */
function reapPreviousRun() {
  const stale = readManifest();
  if (!stale.length) return 0;
  let killed = 0;
  for (const entry of stale) {
    if (!entry.pid) continue;
    const startedAt = processStartedAt(entry.pid);
    if (startedAt === null) continue; // already gone
    // No recorded identity means the pid cannot be proven to be ours. A
    // recycled pid would kill an unrelated program, so skip rather than guess.
    if (!entry.startedAt) continue;
    if (startedAt !== entry.startedAt) continue;
    killTree(entry.pid);
    killed++;
  }
  writeManifest([]);
  return killed;
}

/**
 * The toolchain directories `scripts/dev-env.bat` adds on a double-click.
 *
 * Mirrored rather than invoked because that file is a batch script and the dashboard
 * starts commands directly. Without this, a hub started from a desktop that
 * predates a Rust install cannot find cargo, which is exactly the case
 * dev-env.bat exists to cover.
 */
function buildEnv() {
  const env = { ...process.env };

  // Windows spells this variable "Path" far more often than "PATH", and
  // env keys on Windows are case-insensitive to the OS but case-SENSITIVE to a
  // JavaScript object. Reading env.PATH therefore returned undefined, and
  // prepending to it produced the literal string "dir;undefined" - which
  // destroyed PATH for every child, so even npm could not be found. Use
  // whichever spelling this process actually has.
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';

  const add = (dir) => {
    if (dir && existsSync(dir)) env[pathKey] = `${dir};${env[pathKey] ?? ''}`;
  };

  const userProfile = env.USERPROFILE || `${env.SystemDrive || 'C:'}\\Users\\${env.USERNAME}`;
  if (spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status !== 0) {
    add(path.join(userProfile, '.cargo', 'bin'));
  }
  add('C:\\Program Files\\Amazon\\AWSCLIV2');
  return env;
}

/**
 * Everything the dashboard has started, keyed by service id.
 *
 * `pid` is the root of the tree we spawned. Nothing else is tracked: the whole
 * tree dies with it, so tracking children would only create state that can
 * disagree with reality.
 */
const started = new Map();

/** True when something is accepting connections on the port. */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    // The timeout matters: a port held by a half-dead process accepts the
    // connection slowly, and a hung probe would stall the whole status poll.
    socket.setTimeout(700);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * Kill a process and everything it started.
 *
 * `/T` is the whole point. `npm run tauri:dev` puts node, cargo and the built
 * exe several levels below the pid we spawned, and killing only that pid is
 * what strands them holding ports. `/F` is needed because these trees do not
 * respond to a polite close.
 */
function killTree(pid) {
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

function start(service) {
  if (started.has(service.id)) return { ok: false, error: 'already started by the dashboard' };
  if (service.requires && !existsSync(service.requires)) {
    return { ok: false, error: `folder not found: ${service.requires}` };
  }

  // `shell: true` on Windows resolves `npm`/`python` through the PATHEXT
  // lookup. It also means the pid belongs to cmd.exe rather than to node, which
  // is harmless here precisely because killTree walks the tree.
  const comspec = process.env.ComSpec || 'cmd.exe';
  const commandLine = [service.command, ...service.args].join(' ');
  const child = spawn(comspec, ['/d', '/s', '/c', commandLine], {
    cwd: service.cwd,
    env: buildEnv(),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const tail = [];
  // Output is kept, not discarded. A service that dies during startup is the
  // most common failure here, and with stdio ignored the only symptom was a
  // button that stopped working, which tells the user nothing about why.
  const collect = (chunk) => {
    tail.push(chunk.toString());
    while (tail.length > 1 && tail.join('').length > 1500) tail.shift();
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  const entry = {
    pid: child.pid,
    at: Date.now(),
    startedAt: processStartedAt(child.pid),
    tail,
    service,
    exited: false,
  };
  started.set(service.id, entry);
  persist();

  // On an unexpected exit the entry is kept (marked exited) rather than deleted,
  // so the status endpoint can still report why the service died. Starting the
  // same service again overwrites it.
  child.on('error', (err) => {
    tail.push('\nspawn failed: ' + err.message);
    entry.exited = true;
  });
  child.on('exit', () => {
    entry.exited = true;
  });

  return { ok: true, pid: child.pid };
}

function stop(id) {
  const entry = started.get(id);
  if (!entry) return { ok: false, error: 'not started by the dashboard' };
  killTree(entry.pid);
  started.delete(id);
  persist();
  return { ok: true };
}

async function status() {
  return Promise.all(
    SERVICES.map(async (service) => {
      const entry = started.get(service.id);
      return {
        ...service,
        up: await portInUse(service.port),
        ours: Boolean(entry) && !entry.exited,
        // The last few lines of output, so a service that failed to start can
        // explain itself in the page instead of only in the console.
        log: entry?.exited ? entry.tail.join('').trim().slice(-600) : null,
      };
    })
  );
}

/**
 * The pid currently listening on a loopback port, or null.
 *
 * Used by the explicit "stop it anyway" action. The hub deliberately does not
 * do this by itself: a service whose root process died can leave a descendant
 * still holding the port, and that descendant is no longer provably ours, so
 * killing it automatically would risk killing an unrelated program that later
 * inherited the pid. Making it a button the user presses keeps the decision with
 * the person who can see what they are stopping.
 */
function listenerPid(port) {
  const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  for (const line of (out.stdout ?? '').split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    // columns: protocol, local address, foreign address, state, pid
    if (parts.length < 5 || parts[3] !== 'LISTENING') continue;
    // Take the port from the local-address column rather than matching the
    // whole line: a server may bind 0.0.0.0 rather than 127.0.0.1, and a regex
    // pinned to loopback silently failed to find exactly the processes it was
    // meant to clean up.
    const local = parts[1];
    const colon = local.lastIndexOf(':');
    if (colon === -1 || Number(local.slice(colon + 1)) !== port) continue;
    const pid = Number(parts[parts.length - 1]);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}

function forceStop(id) {
  const service = SERVICES.find((s) => s.id === id);
  if (!service) return { ok: false, error: 'unknown service' };
  const pid = listenerPid(service.port);
  if (!pid) return { ok: false, error: 'nothing is listening on that port' };
  killTree(pid);
  started.delete(id);
  persist();
  return { ok: true, pid };
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

  // --- Local dev services -------------------------------------------------
  //
  // Start, stop and inspect the local dev servers. They live here rather than
  // on a page of their own so there is one place to look, and so the same
  // loopback-only, rebinding-guarded server owns them.

  if (url.pathname === '/api/services' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(await status()));
    return;
  }

  if (url.pathname === '/api/service/start' && req.method === 'POST') {
    const service = SERVICES.find((s) => s.id === url.searchParams.get('id'));
    if (!service) {
      res.writeHead(404).end('unknown service');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(start(service)));
    return;
  }

  if (url.pathname === '/api/service/stop' && req.method === 'POST') {
    const result = stop(url.searchParams.get('id'));
    res.writeHead(result.ok ? 200 : 409, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (url.pathname === '/api/service/force-stop' && req.method === 'POST') {
    const result = forceStop(url.searchParams.get('id'));
    res.writeHead(result.ok ? 200 : 409, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
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

for (const signal of ['exit', 'SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const entry of started.values()) killTree(entry.pid);
    started.clear();
    writeManifest([]);
    if (signal !== 'exit') process.exit(0);
  });
}

const reaped = reapPreviousRun();

server.listen(PORT, '127.0.0.1', () => {
  if (reaped) console.log(`Stopped ${reaped} leftover service tree(s) from a previous run`);
  console.log(`Dashboard on http://127.0.0.1:${PORT}`);
  console.log(`Bucket: ${bucket}`);
});
