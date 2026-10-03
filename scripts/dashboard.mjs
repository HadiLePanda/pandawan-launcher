/**
 * Pandawan publishing dashboard: a local-only control panel for the R2 publish
 * scripts.
 *
 *   npm run dashboard [-- --port 4400]
 *
 * SECURITY: this process holds the R2 secret key and can delete bucket objects,
 * so it is a local admin tool and must never ship to players or answer beyond
 * loopback. It is safe today because (1) scripts/ is not in the shipped bundle
 * and bundle_contents_tests.rs enforces that, (2) it binds 127.0.0.1 and rejects
 * any request whose Host header is not loopback, which also blocks DNS
 * rebinding, and (3) credentials come from a gitignored .env. Do not loosen the
 * bind address or the host check, and do not add a deploy mode: remote access
 * would need real authentication and a TLS terminator first.
 */
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// The in-server catalog write reuses r2.mjs's upload/NO_CACHE so its
// cache-control header matches publish-catalog.mjs exactly: a mutable index
// served under a long-lived cache header makes a publish look like a no-op.
import {
  IMMUTABLE,
  NO_CACHE,
  S3,
  deleteObject,
  listKeysWithMeta,
  loadDotEnv,
  r2Config,
  upload,
} from './lib/r2.mjs';
// The field contract is shared with the publisher, so the form cannot offer a
// field the script would silently ignore.
import { CHANNELS, FIELDS, FIELD_SPEC, IMAGE_FIELDS } from './lib/metadata-fields.mjs';
// The one semver bump rule, shared with release.mjs so the version the panel
// proposes cannot drift from the version a release writes.
import { bumpVersion } from './lib/version.mjs';
import { readGameMetadata } from './lib/game-metadata.mjs';
// Killing a tree and reading the manifest are shared with the watchdog, so what
// the dashboard records and what cleans up after it cannot drift apart.
import { killTree, processStartedAt, reapManifest, writeManifest } from './lib/service-reaper.mjs';
// The news contract lives with the publisher for the same reason.
import {
  NEWS_ART_PREFIX,
  NEWS_CATEGORY_SUGGESTIONS,
  NEWS_FIELDS,
  newsItemToFields,
  uniqueNewsId,
} from './lib/news-fields.mjs';
// Artwork decisions are pure and unit-tested on their own.
import {
  artworkObjectName,
  describeArtwork,
  MAX_ARTWORK_BYTES,
  referencesObject,
  safeLocalName,
  selectArtworkObjects,
  sortArtwork,
  validateArtwork,
} from './lib/artwork.mjs';
// Catalog read/CRUD decisions are pure and unit-tested: this file holds the R2
// keys and boots a server, so what a catalog edit *means* cannot be checked here.
import {
  catalogDiff,
  catalogDiffIsEmpty,
  catalogEntryFrom,
  catalogGames,
  removeCatalogEntry,
} from './lib/catalog-edit.mjs';
// Creating an entry IS an add, so it runs through catalog-merge.mjs rather than
// growing a second, subtly different add rule that could drift.
import { mergeCatalog, publishPlan } from './lib/catalog-merge.mjs';
// Website-panel decisions are pure and unit-tested for the same reason as
// catalog-edit.mjs.
import {
  SITE_PLATFORM_NAMES,
  SITE_PLATFORMS,
  SITE_PROJECT_NAME,
  parseAheadCount,
  parseGitRemote,
  parsePagesDeployments,
  siteGitSummary,
  siteMissingMessage,
  summariseDownloads,
} from './lib/website-status.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.join(here, 'dashboard');

const repoRoot = path.resolve(here, '..');

// The public download page is a separate repository next to this one.
const siteRoot = path.resolve(repoRoot, '..', 'pandawan-launcher-site');

loadDotEnv();
const { cdnOrigin, endpoint, bucket } = r2Config();

const portArg = process.argv.indexOf('--port');
const PORT = portArg > -1 ? Number(process.argv[portArg + 1]) : 4400;

const PLATFORMS = ['windows', 'macos', 'linux'];
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

// Staged artwork lives under dist/ so a rebuild clears it; a stale file would be
// offered as the operator's current choice.
const artStagingDir = path.join(repoRoot, 'dist', 'artwork-staging');
rm(artStagingDir, { recursive: true, force: true }).catch(() => {});

// Whether the React dashboard app has been built. Checked once at startup so a
// request cannot see the answer change mid-session.
const appBuilt = existsSync(path.join(here, 'dashboard', 'app', 'dist', 'index.html'));

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  // A wrong content-type stops the browser executing a module script or applying
  // a stylesheet, which looks like an app that built fine and then did nothing.
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Read a TTL from the environment, treating an absent or blank value as unset
 * and a literal 0 as a real answer. 0 must mean "cache nothing at all" - it is
 * how a caching bug is told apart from a real one - so it cannot fall through to
 * the default. Unparseable or negative input still falls back to the default.
 */
function ttlFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * How long an ONLINE read may be reused, in ms. One hour, because everything it
 * applies to is a round trip to somebody else's infrastructure - a recursive
 * bucket listing, a CDN document, a git/wrangler subprocess, a GitHub release
 * list - and re-running them per tab made the panel feel like it refetched
 * constantly. A change made OUTSIDE this dashboard is invisible for up to an
 * hour; `?refresh=1`, the x-cache-age-ms header and write-invalidation are what
 * keep that from being a silent lie. Override: DASHBOARD_CACHE_TTL_MS; 0
 * disables caching.
 */
const CACHE_TTL_ONLINE_MS = ttlFromEnv('DASHBOARD_CACHE_TTL_MS', 60 * 60 * 1000);

/**
 * How long a CDN request may take before it is abandoned. One constant because
 * the panel's own reads already answer inside it: a fetch with no signal waits on
 * a half-open connection, which parks the request rather than failing it, and
 * the read cache would then serve that hung request for an hour.
 */
const CDN_FETCH_TIMEOUT_MS = 15_000;

/**
 * How long a LOCAL live fact may be reused, in ms. Short because /api/services
 * is a port probe the client re-polls every few seconds: at 30 s a stopped dev
 * server reads as running for at most 30 s while nine polls in ten cost nothing,
 * and an hour here would report a server the operator just stopped as running.
 * /api/launcher/status is deliberately not in this table and stays uncached.
 * Override: DASHBOARD_CACHE_TTL_LOCAL_MS; 0 disables, as above.
 */
const CACHE_TTL_LOCAL_MS = ttlFromEnv('DASHBOARD_CACHE_TTL_LOCAL_MS', 30_000);

/**
 * Which read endpoints are cached, and for how long. Registry and TTL live in ONE
 * table so a route cannot become cached by accident or without someone choosing
 * its TTL; a path not listed is not cached at all, so the failure mode of adding
 * a route is "slower", never "wrong answer".
 */
const CACHE_TTL_BY_PATH = new Map([
  // A full recursive bucket listing plus a fetch per channel: the most expensive
  // read here by a wide margin.
  ['/api/inventory', CACHE_TTL_ONLINE_MS],
  ['/api/meta', CACHE_TTL_ONLINE_MS],
  ['/api/art', CACHE_TTL_ONLINE_MS],
  ['/api/news', CACHE_TTL_ONLINE_MS],
  ['/api/catalog', CACHE_TTL_ONLINE_MS],
  // A git status, a wrangler subprocess and a HEAD per artifact; re-read every
  // time the tab is opened.
  ['/api/website', CACHE_TTL_ONLINE_MS],
  // Local and live: a TCP connect per service, and the client polls it.
  ['/api/services', CACHE_TTL_LOCAL_MS],
]);

/**
 * Read-endpoint cache: the resolved value, when it was fetched, and the refresh
 * running behind it. Only paths in CACHE_TTL_BY_PATH are stored. A single
 * in-flight promise is what deduplicates concurrent reads; the resolved value is
 * what gets served.
 */
const readCache = new Map();

/**
 * The cache key: path plus query, minus `refresh`. The query is part of the key
 * because /api/meta?gameId=x&channel=y differs from the same path for another
 * game; `refresh` is stripped because caching the cache-bypassing request would
 * make refresh permanently self-defeating. Every other parameter is kept, so
 * unknown ones cannot let two queries collide.
 */
function cacheKey(url) {
  const params = new URLSearchParams(url.search);
  params.delete('refresh');
  const query = params.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

/**
 * The TTL a path may reuse a value for, or null when it is not cached at all.
 * The registry, not the call sites, is the source of truth. The check is `null`
 * rather than falsy so a TTL of 0 - the override that disables caching - is
 * honoured rather than treated as absent.
 */
function cacheTtlFor(url) {
  const ttl = CACHE_TTL_BY_PATH.get(url.pathname);
  return ttl === undefined ? null : ttl;
}

/**
 * Run `produce`, reusing a cached value when there is a fresh one. A stale value
 * is returned rather than discarded: the panel paints from what it has and the
 * replacement is read behind it, which is what makes an hour-long TTL invisible
 * instead of laggy.
 *
 * @returns {{value: *, ageMs: number, stale: boolean, state: 'hit'|'miss'|'stale'}}
 */
async function cachedRead(url, produce) {
  const ttl = cacheTtlFor(url);
  // Not in the registry, or the TTL is 0: read it, cache nothing, and report it
  // as a miss so nothing downstream can treat the answer as stored.
  if (ttl === null || ttl === 0) {
    return { value: await produce(), ageMs: 0, stale: false, state: 'miss' };
  }

  const key = cacheKey(url);
  const now = Date.now();
  const bypass = url.searchParams.has('refresh');
  const hit = readCache.get(key);

  // A read that has not resolved yet is joined rather than duplicated, whatever
  // its age, so two tabs opening at once produce one bucket listing. Joining is
  // the answer for ?refresh=1 arriving mid-read too, since it is the same query.
  if (hit && hit.refreshing && hit.value === undefined) {
    const value = await hit.promise;
    return { value, ageMs: Date.now() - hit.at, stale: false, state: 'miss' };
  }

  // `bypass` gates the fresh-hit check: `?refresh=1` must mean "re-read now", so
  // a value still well inside its TTL must NOT be returned for it - otherwise
  // the one button meant to prove the cache is not lying would be answered by
  // the cache. The stale branch below is gated on `bypass` for the same reason.
  if (!bypass && hit && hit.value !== undefined && now - hit.at < ttl) {
    return { value: hit.value, ageMs: now - hit.at, stale: false, state: 'hit' };
  }

  // A stale value with nothing in flight: serve it now, start the replacement
  // behind, and say so (`x-cache: stale`, with the real age) rather than present
  // an hour-old read as current.
  if (hit && hit.value !== undefined && !bypass && !hit.refreshing) {
    startRefresh(key, produce);
    return { value: hit.value, ageMs: now - hit.at, stale: true, state: 'stale' };
  }

  const value = await readInto(key, produce, null);
  return { value, ageMs: 0, stale: false, state: 'miss' };
}

/**
 * Read now and wait, storing the entry only once it has resolved. `previous` is
 * the stale entry a background refresh is replacing: kept on failure, because
 * serving a stale answer while saying so beats a blocked read on the next
 * request. A cold read has nothing to keep, so its failure deletes the entry.
 */
async function readInto(key, produce, previous) {
  const entry = { at: Date.now(), value: undefined, promise: null, refreshing: true };
  // Stored before awaiting so a concurrent request joins this read instead of
  // starting its own.
  readCache.set(key, entry);
  const promise = produce();
  entry.promise = promise;
  try {
    const value = await promise;
    // Re-stamped on success: the age a caller is told is the age of the value,
    // not of the read that produced it.
    entry.at = Date.now();
    entry.value = value;
    entry.refreshing = false;
    return value;
  } catch (err) {
    if (previous) {
      readCache.set(key, previous);
    } else {
      readCache.delete(key);
    }
    throw err;
  }
}

/**
 * Replace an expired entry behind the caller, never blocking it. The rejection
 * is swallowed on purpose: the request was already answered, and an unhandled
 * rejection would take the server down.
 */
function startRefresh(key, produce) {
  const previous = readCache.get(key);
  readInto(key, produce, previous).catch(() => {});
}

/**
 * Drop cached entries so the next read goes to the source. Called when a write
 * is ACCEPTED, not when its child exits: a read taken mid-publish would
 * otherwise be served for the whole TTL afterwards. Over-invalidating costs one
 * read; under-invalidating at a one-hour TTL costs an hour of a wrong panel, so
 * a write drops every read that consumes a document it rewrites. `prefix`
 * narrows it to those (matched as a path, with or without its own query, so one
 * call covers every game/channel variant behind it); with no prefix every cached
 * read is dropped.
 */
function invalidateCache(prefix) {
  if (!prefix) {
    readCache.clear();
    return;
  }
  for (const key of readCache.keys()) {
    if (key === prefix || key.startsWith(`${prefix}?`)) readCache.delete(key);
  }
}

/** The headers a cached read carries, so the client can show its age. */
function cacheHeaders(state, ageMs) {
  return {
    // no-store: a browser cache would answer the next request from its own store,
    // and the "updated Ns ago" label and manual Refresh would stop reflecting the
    // server's cache.
    'cache-control': 'no-store',
    'x-cache': state,
    'x-cache-age-ms': String(Math.max(0, Math.round(ageMs))),
  };
}

/**
 * Every game, channel, version and platform currently on the bucket, built from
 * one recursive listing plus latest.json per channel.
 */
async function buildInventory() {
  const keys = await listKeysWithMeta(S3.s3Uri(bucket, 'games/'), {
    endpoint,
    throwOnFailure: true,
  });
  const games = new Map();

  const channelOf = (key) => {
    const parts = key.replace(/^games\//, '').split('/');
    return parts.length >= 2 ? { id: parts[0], channel: parts[1], parts } : null;
  };

  const bucketFor = (id) => {
    if (!games.has(id)) games.set(id, new Map());
    return games.get(id);
  };

  // A version is identified by the manifest sitting directly beneath it: inferring
  // from path shape alone misreads a flat publish, where a game's files sit in the
  // channel directory and its first folder is not a version. Each version carries
  // the newest timestamp among its objects (the real ship time); reading it from
  // the versioned manifest's HTTP header would report a backfilled build as
  // shipped today.
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
      // A flat, pre-version-stamped channel: registered here or it never appears.
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

  // Everything inside a known version directory belongs to that build: this pass
  // records platform subdirectories and stamps the build's ship time.
  for (const entry of keys) {
    const loc = channelOf(entry.key);
    if (!loc) continue;
    const channels = bucketFor(loc.id);
    const versions = channels.get(loc.channel);
    const record = versions?.get(loc.parts[2]);
    if (!record) continue;
    if (PLATFORMS.includes(loc.parts[3])) record.platforms.add(loc.parts[3]);
    // Manifests are excluded: they are metadata that can be rewritten long after
    // the build shipped, and including them would report when the manifest was
    // last touched rather than when the build was published.
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
        const res = await fetch(`${cdnOrigin}/games/${id}/${channel}/latest.json`, {
          signal: AbortSignal.timeout(CDN_FETCH_TIMEOUT_MS),
        });
        if (res.ok) latest = await res.json();
      } catch {
        latest = null;
      }

      // A channel with no index still serves its flat manifest, so the launcher
      // installs it; reporting every platform as empty would say the opposite.
      if (!latest) {
        try {
          const res = await fetch(`${cdnOrigin}/games/${id}/${channel}/manifest.json`, {
            signal: AbortSignal.timeout(CDN_FETCH_TIMEOUT_MS),
          });
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
        // Ship time per platform from the bucket listing rather than a header: a
        // backfilled build's manifest was written today, its files are older.
        updated: shipTimes(versions, flatStamps.get(`${id}/${channel}`), latest),
        // Driven by latest.json, since a flat publish has no platform directories.
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
 * Ship time per platform, taken from the version each one is pinned to. A flat
 * channel has no version directory, so it falls back to the channel's own time.
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

/**
 * When this dashboard last ran the launcher publish, or null.
 *
 * publish-launcher.mjs rewrites launcher/downloads.json and the site renders it
 * live, so the useful fact after a publish is "how long ago did the site's data
 * change", not "was the site deployed". In-memory on purpose: it records what
 * THIS process did, and a restarted dashboard did nothing.
 */
let lastLauncherPublishAt = null;

/**
 * The git facts about the site repo, read with spawnSync. Read-only commands and
 * `-C <siteRoot>` rather than a cwd change, so nothing here can touch another
 * repository's index or working tree. `dirty` counts untracked files: they are
 * still files in the tree a deploy would ship. Every command is allowed to fail
 * - git may be absent, a fresh clone may have no commits - and that is reported
 * as unknown facts rather than refusing the panel.
 */
function readSiteGit() {
  const run = (args) =>
    spawnSync('git', ['-C', siteRoot, ...args], {
      encoding: 'utf-8',
      shell: false,
      // Bounded: the default is infinite, and a hung git would hang the status
      // poll with it.
      timeout: 10_000,
    });

  const text = (out) => (out && out.status === 0 ? String(out.stdout ?? '') : '');

  const status = run(['status', '--porcelain']);
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = run(['rev-parse', '--short', 'HEAD']);
  const subject = run(['log', '-1', '--pretty=%s']);
  // `get-url origin` rather than `remote`: the latter prints one line per remote
  // per direction, and parseGitRemote takes the first, which is alphabetical
  // rather than the one a deploy would push to. The full list is the fallback for
  // a repo whose remote is not named "origin".
  const origin = run(['remote', 'get-url', 'origin']);
  const remotes = run(['remote', '-v']);
  // Absent upstream is normal, so a non-zero exit here means "unknown", not
  // "behind".
  const ahead = run(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);

  return siteGitSummary({
    porcelain: text(status),
    branch: text(branch).trim(),
    commit: text(commit).trim(),
    subject: text(subject).trim(),
    ahead: parseAheadCount(text(ahead)),
    remote: text(origin).trim() || parseGitRemote(text(remotes)),
  });
}

/**
 * The live Pages deployment list, or why it could not be read. `available: false`
 * is a first-class answer: wrangler is a devDependency of the site repo and this
 * must work where it is not installed or not authenticated. It runs through the
 * site's own node_modules rather than a global wrangler, which the site's README
 * forbids installing. `--json` suppresses the banner; a warning printed in front
 * of the array is still recovered by parsePagesDeployments.
 */
function readPagesDeployments() {
  const wrangler = path.join(siteRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (!existsSync(wrangler)) {
    return {
      available: false,
      reason: 'wrangler is not installed in the site repo (npm install there)',
      latest: null,
      deployments: [],
    };
  }

  const out = spawnSync(
    process.execPath,
    [wrangler, 'pages', 'deployment', 'list', '--project-name', SITE_PROJECT_NAME, '--json'],
    {
      cwd: siteRoot,
      encoding: 'utf-8',
      shell: false,
      // Talks to the Cloudflare API; a hung request must not hold the status poll.
      timeout: 20_000,
    }
  );

  if (out.error)
    return {
      available: false,
      reason: String(out.error.message ?? out.error),
      latest: null,
      deployments: [],
    };
  if (out.status !== 0) {
    // wrangler's own stderr is the actionable part ("not logged in"); first line
    // only, and never its stdout, which for a failed call can hold a whole error
    // payload.
    const reason = (String(out.stderr ?? '') || String(out.stdout ?? ''))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    return {
      available: false,
      reason: `wrangler exited ${out.status}${reason ? `: ${reason}` : ''}`,
      latest: null,
      deployments: [],
    };
  }

  const parsed = parsePagesDeployments(out.stdout);
  if (parsed.error) {
    return { available: false, reason: parsed.error, latest: null, deployments: [] };
  }
  return { available: true, reason: null, latest: parsed.latest, deployments: parsed.deployments };
}

/**
 * Whether a download URL resolves, and how big it is. A HEAD, not a GET:
 * downloading a 200 MB installer to answer "would this button work" is not a
 * check, and R2 sends content-length on HEAD. A failed check is reported per
 * artifact rather than thrown: one missing .dmg is the state this panel exists
 * to surface, not a failure of the endpoint.
 */
async function headArtifact(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(CDN_FETCH_TIMEOUT_MS),
    });
    const length = Number(response.headers.get('content-length'));
    return {
      ok: response.ok,
      status: response.status,
      // Null rather than 0: "no header" and "empty file" are different facts, and
      // only the second is a broken download.
      size: Number.isFinite(length) && length > 0 ? length : null,
    };
  } catch (err) {
    return { ok: false, status: null, size: null, error: String(err?.message ?? err) };
  }
}

/**
 * The website panel's one number that matters: what the page is showing.
 * downloads.json is fetched from the CDN, not the site repo, because the site
 * reads it from there and the checkout has no copy. no-store because it is a
 * mutable index: a cached response would report a version no longer offered.
 * Returned as {error} rather than thrown so the rest of the panel still shows
 * when the bucket cannot be reached.
 */
async function readLiveDownloads() {
  const url = `${cdnOrigin}/launcher/downloads.json`;
  let response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(CDN_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { url, error: String(err?.message ?? err), ...summariseDownloads(null) };
  }

  if (!response.ok) {
    return { url, error: `HTTP ${response.status}`, ...summariseDownloads(null) };
  }

  let doc;
  try {
    doc = await response.json();
  } catch (err) {
    return { url, error: `not valid JSON: ${err.message}`, ...summariseDownloads(null) };
  }

  const summary = summariseDownloads(doc);
  // Only the preferred artifact is HEAD-checked: a request per file a person
  // could click is too many, and the site's own verify walks every URL anyway.
  const platforms = await Promise.all(
    summary.platforms.map(async (platform) => {
      if (!platform.preferred) return platform;
      return {
        ...platform,
        preferred: { ...platform.preferred, ...(await headArtifact(platform.preferred.url)) },
      };
    })
  );

  return { url, error: null, version: summary.version, platforms };
}

/**
 * Everything the Website panel shows. Read-only: nothing here writes to the site
 * repo or runs a git write command. The three sources answer three different
 * questions and are deliberately not collapsed into one "up to date" flag - the
 * checkout is what WOULD be deployed, the deployments are what IS deployed, and
 * downloads.json is what the live page SHOWS. Publishing a launcher version
 * moves only the third, so an old deployment can still show today's version.
 */
async function websiteStatus() {
  const present = existsSync(siteRoot);
  if (!present) {
    // The other fields are omitted rather than nulled: a row of nulls reads like
    // a broken panel rather than a missing folder.
    return {
      present: false,
      path: siteRoot,
      reason: siteMissingMessage(siteRoot),
      lastPublished: lastLauncherPublishAt,
    };
  }

  const [downloads, pages] = await Promise.all([readLiveDownloads(), readPagesDeployments()]);
  const git = readSiteGit();

  return {
    present: true,
    path: siteRoot,
    git,
    pages,
    downloads,
    lastPublished: lastLauncherPublishAt,
    // Served so the client need not hard-code a project name or infer one.
    project: SITE_PROJECT_NAME,
    platforms: SITE_PLATFORMS.map((id) => ({ id, name: SITE_PLATFORM_NAMES[id] ?? id })),
  };
}

/**
 * Refuse a site-repo action when the checkout is absent, answering the request
 * itself. Returns true when it answered. A missing sibling repository is an
 * ordinary state and must read as "here is where I looked" rather than an
 * unhandled ENOENT.
 */
function siteAbsentResponse(res) {
  if (existsSync(siteRoot)) return false;
  res.writeHead(409, { 'content-type': 'text/plain' }).end(siteMissingMessage(siteRoot));
  return true;
}

/**
 * Run an npm script in the site repo, streaming the same SSE contract as
 * runScript: output, error, done({code}). runScript is not reused because it
 * spawns `node <script>` in THIS repo, and the site is a separate repository with
 * its own package.json and node_modules.
 *
 * cmd.exe rather than a direct npm spawn: spawning a `.cmd` with shell:false
 * raises EINVAL on current Node (the fix for the CVE-2024-27998
 * argument-injection class), and the shell resolves npm through PATHEXT. The
 * command is a fixed string built here - the script name comes from the route,
 * never the request body - so nothing in it can be injected.
 */
function runSiteScript(script, args, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const send = (event, data) => res.write(`event: ${event}\ndata: ${data}\n\n`);

  const comspec = process.env.ComSpec || 'cmd.exe';
  const commandLine = ['npm', 'run', script, ...args].join(' ');
  const child = spawn(comspec, ['/d', '/s', '/c', commandLine], {
    cwd: siteRoot,
    env: process.env,
    shell: false,
  });

  child.stdout?.on('data', (chunk) => send('output', String(chunk)));
  child.stderr?.on('data', (chunk) => send('output', String(chunk)));
  child.on('error', (err) => send('error', String(err)));
  child.on('close', (code) => {
    send('done', JSON.stringify({ code }));
    res.end();
  });
}

function rejectRebinding(req, res) {
  const host = (req.headers.host ?? '').split(':')[0].replace(/^\[|\]$/g, '');
  if (!LOOPBACK.has(host)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('This dashboard only answers requests from localhost.');
    return true;
  }
  return rejectCrossOrigin(req, res);
}

/**
 * Refuse a mutating request that some other page caused.
 *
 * The Host check above stops DNS rebinding; it does not stop CSRF, because a page
 * on any origin can send a simple POST (form or text/plain) to a loopback URL and
 * the browser will attach no Origin this server is entitled to trust. Every write
 * here touches R2 with real credentials, so a cross-origin write is refused and
 * application/json is required: both together force a CORS preflight that a
 * foreign page cannot pass.
 */
function rejectCrossOrigin(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') return false;

  const origin = req.headers.origin;
  if (origin) {
    let host = '';
    try {
      host = new URL(origin).hostname;
    } catch {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Malformed Origin.');
      return true;
    }
    if (!LOOPBACK.has(host)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('Cross-origin writes are refused; this dashboard is local-only.');
      return true;
    }
  }

  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type && type !== 'application/json') {
    res.writeHead(415, { 'content-type': 'text/plain' });
    res.end(`Send application/json, not ${type}.`);
    return true;
  }

  return false;
}

/**
 * What is currently published for the launcher, and what exists to publish. The
 * live bucket is what players get today; the GitHub release list is what CI has
 * built and signed. A tag can be signed but unpublished and an artifact can be
 * published from a tag with no local copy, so both are shown.
 */
async function launcherStatus() {
  // Fetched over HTTP so this reflects exactly what an updater would see.
  // no-store because the live version is a live fact: a version just published
  // must not read as the previous one from a cache.
  let published = null;
  let publishedError = null;
  try {
    const response = await fetch(`${cdnOrigin}/launcher/latest.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(CDN_FETCH_TIMEOUT_MS),
    });
    if (response.ok) {
      const manifest = await response.json();
      const targets = Object.keys(manifest.platforms ?? {});
      published = {
        version: manifest.version ?? null,
        targets,
        artifactCount: new Set(Object.values(manifest.platforms ?? {}).map((entry) => entry.url))
          .size,
      };
    } else if (response.status !== 404) {
      // 404 is "nothing published yet"; anything else is "could not read", which
      // must not render as an empty bucket.
      publishedError = `latest.json answered HTTP ${response.status}`;
    }
  } catch (err) {
    // Unreachable is not the same fact as not published, so it is reported.
    publishedError = String(err?.message ?? err);
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

  // What each bump level would produce from the repo's version, computed with
  // release.mjs's own rule so the preview and the release cannot disagree.
  const nextVersions = {
    patch: bumpVersion(packageVersion, 'patch'),
    minor: bumpVersion(packageVersion, 'minor'),
    major: bumpVersion(packageVersion, 'major'),
  };

  return { published, publishedError, releases, packageVersion, nextVersions, cdnOrigin };
}

/**
 * The live news feed, or an empty one when absent. A missing feed is normal on a
 * fresh bucket; an unparseable one is reported, because writing over it would
 * destroy whatever it said.
 */
async function readNewsFeed(cdnOrigin) {
  const res = await fetch(`${cdnOrigin}/launcher/news.json`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(CDN_FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) return { items: [] };
  const text = await res.text();
  if (!text.trim()) return { items: [] };

  let feed;
  try {
    feed = JSON.parse(text);
  } catch {
    throw new Error(
      'The published news.json is not valid JSON. Fix or remove it on the bucket before editing.'
    );
  }
  if (!Array.isArray(feed.items)) {
    throw new Error('The published news.json has no items array.');
  }
  return feed;
}

// A blank title still has to be identifiable; a list of empty rows is when the
// operator most needs to tell items apart.
function newsItemLabelFor(item) {
  return String(item?.title ?? '').trim() || String(item?.id ?? '').trim() || '(untitled)';
}

const CATALOG_URL = `${cdnOrigin}/launcher/catalog.json`;

/**
 * The published catalog, or null with the reason it could not be read. Returns a
 * status instead of throwing because the caller must show both copies whether or
 * not either exists: "there is no published catalog" and "the published catalog
 * is broken" are very different things for an operator, and collapsing them is
 * how a hand-fixed document gets overwritten. no-store because it is a mutable
 * index: a cached response would show yesterday's games as the live one.
 *
 * @returns {{catalog: object|null, status: 'ok'|'absent'|'unreadable'|'invalid', detail: string|null}}
 */
async function readLiveCatalog() {
  let response;
  try {
    response = await fetch(CATALOG_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(CDN_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    return { catalog: null, status: 'unreadable', detail: String(err) };
  }

  if (response.status === 404) {
    return { catalog: null, status: 'absent', detail: null };
  }
  if (!response.ok) {
    return { catalog: null, status: 'unreadable', detail: `HTTP ${response.status}` };
  }

  const text = await response.text();
  if (!text.trim()) {
    return { catalog: null, status: 'absent', detail: null };
  }

  let catalog;
  try {
    catalog = JSON.parse(text);
  } catch (err) {
    // Reported rather than repaired: silently treating it as absent would invite a
    // create or delete to overwrite whatever it actually says.
    return { catalog: null, status: 'invalid', detail: `not valid JSON: ${err.message}` };
  }

  if (!Array.isArray(catalog?.games)) {
    return { catalog: null, status: 'invalid', detail: 'it has no games array' };
  }

  return { catalog, status: 'ok', detail: null };
}

/**
 * public/catalog.json, or null with the reason. A missing file is normal on a
 * fresh checkout; an unparseable one is named because publish-catalog.mjs refuses
 * to run against it.
 *
 * @returns {{catalog: object|null, status: string, detail: string|null, path: string}}
 */
async function readLocalCatalog() {
  const file = path.join(repoRoot, 'public', 'catalog.json');
  let text;
  try {
    text = await readFile(file, 'utf-8');
  } catch (err) {
    return {
      catalog: null,
      status: 'absent',
      detail: err.code === 'ENOENT' ? null : String(err),
      path: file,
    };
  }

  try {
    return { catalog: JSON.parse(text), status: 'ok', detail: null, path: file };
  } catch (err) {
    return {
      catalog: null,
      status: 'invalid',
      detail: `not valid JSON: ${err.message}`,
      path: file,
    };
  }
}

/**
 * Upload a catalog document the way publish-catalog.mjs does: the same
 * upload(..., NO_CACHE, application/json) call, so the cache-control header - the
 * difference between a publish players see and one they do not - cannot drift.
 * upload() shells out to `aws s3 cp`, so the document lands in dist/ beside the
 * publisher's staging file and is removed afterwards; a leftover copy could be
 * picked up by a build or read as though it were published.
 */
async function uploadCatalog(catalog) {
  const staging = path.join(repoRoot, 'dist');
  const mergedPath = path.join(staging, 'catalog-dashboard.json');
  await mkdir(staging, { recursive: true });
  try {
    writeFileSync(mergedPath, `${JSON.stringify(catalog, null, 2)}\n`);
    upload(mergedPath, S3.s3Uri(bucket, 'launcher/catalog.json'), {
      endpoint,
      cacheControl: NO_CACHE,
      contentType: 'application/json',
      // In-process call: exit(1) here would kill the dashboard, so let it throw.
      throwOnFailure: true,
    });
  } finally {
    rm(mergedPath, { force: true }).catch(() => {});
  }
}

/**
 * Where the React dashboard app builds to. Outside the repo-root dist/ on
 * purpose: the launcher bundles dist/ and this server holds R2 credentials.
 * scripts/dashboard/app/vite.config.ts and bundle_contents_tests.rs enforce it.
 */
const appDistDir = path.join(assetDir, 'app', 'dist');

/**
 * Serve a file from the React build, or the app shell for a client-side route.
 * no-store on everything, including hashed asset filenames: a cached index.html
 * pointing at assets that no longer exist is a blank page after every rebuild.
 *
 * @param pathname a request path, always starting with '/'
 * @returns {Promise<boolean>} true when the response was written here
 */
async function serveAppDist(res, pathname) {
  // Only inside app/dist: without this a request for `/../../.env` escapes a
  // process whose whole reason to exist is the credentials it holds. A malformed
  // percent-escape (GET /%) makes decodeURIComponent throw, and this async handler
  // has no outer catch, so answer it as "not a static file".
  let relative;
  try {
    relative = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  } catch {
    return false;
  }
  const target = path.resolve(appDistDir, relative);
  if (target !== appDistDir && !target.startsWith(appDistDir + path.sep)) return false;

  let body;
  let file = target;
  try {
    body = await readFile(file);
  } catch {
    // SPA fallback: a client-side route like /games/catalog is not a file, so the
    // app shell is served for any path that did not resolve to one. Two kinds must
    // NOT get it: `/api/...`, where a 200 of HTML would look like a server bug at
    // the fetch call, and the app's own index.html, which resolved or there would
    // be no build.
    if (relative === 'index.html') return false;
    if (pathname === '/api' || pathname.startsWith('/api/')) return false;
    if (!appBuilt) return false;

    file = path.join(appDistDir, 'index.html');
    try {
      body = await readFile(file);
    } catch {
      return false;
    }
  }

  res.writeHead(200, {
    'content-type': mimeTypes[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(body);
  return true;
}

/**
 * Upload a catalog document, streaming the outcome over SSE (output/error/done)
 * so the client's stream handling covers it without a special case. The success
 * payload is returned so the caller can add what it knows; null means the
 * response is already written and the caller must stop.
 */
async function catalogWrite(res, catalog) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  const send = (event, data) => res.write(`event: ${event}\ndata: ${data}\n\n`);

  try {
    send('output', `Uploading launcher/catalog.json (${catalogGames(catalog).length} games)\n`);
    await uploadCatalog(catalog);
    const payload = { ok: true, code: 0 };
    send('done', JSON.stringify(payload));
    res.end();
    return payload;
  } catch (err) {
    // Reported rather than thrown: the response is half-written. `code` is
    // required - the client derives the verdict from it, so a failure frame
    // without one parses as exit 0 and renders as success.
    send('output', `${String(err)}\n`);
    send('done', JSON.stringify({ ok: false, code: 1, error: String(err) }));
    res.end();
    return null;
  }
}

/**
 * The failure answer of readJson, distinct from every value a body can parse to.
 * `null` was overloaded, and `0`, `false` and `''` are all falsy: the caller's
 * `if (!payload) return` read those as "already answered" and left the request
 * hanging with no response at all.
 */
const JSON_REFUSED = Symbol('readJson refused');

/**
 * Parse a JSON request body, answering the request itself on malformed input and
 * on an oversized one. Chunks past `maxBytes` are drained but not stored, so the
 * browser sees the 413 rather than a connection reset.
 *
 * Returns JSON_REFUSED when the request has already been answered; the caller
 * must compare against the symbol, not against a falsy value.
 */
async function readJson(req, res, { maxBytes = 1024 * 1024 } = {}) {
  const raw = await new Promise((resolve) => {
    let body = '';
    let size = 0;
    let refused = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        refused = true;
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(refused ? JSON_REFUSED : body));
  });

  if (raw === JSON_REFUSED) {
    res.writeHead(413).end(`body too large; the limit is ${maxBytes} bytes`);
    return JSON_REFUSED;
  }

  let value;
  try {
    value = JSON.parse(raw || '{}');
  } catch {
    res.writeHead(400).end('bad json');
    return JSON_REFUSED;
  }

  // Every caller reads named fields off the payload, so a scalar or null body is
  // answered as the malformed request it is. Handing it back "successfully" threw
  // on the first property access, and this handler has no outer catch: the whole
  // server went down with the response unanswered.
  if (typeof value !== 'object' || value === null) {
    res.writeHead(400).end('a JSON object is required');
    return JSON_REFUSED;
  }

  return value;
}

/**
 * Run a publishing script and stream its output as server-sent events. The
 * scripts are not reimplemented here on purpose: publish-game.mjs carries the
 * channel/version guard, the version-stamped layout, platform validation and the
 * stale-multipart cleanup a dashboard copy would silently lose.
 *
 * `onExit` fires once, after the `done` event, with the child's exit code. It
 * exists because some facts are only knowable when a child exits, and it is a
 * hook only: the three SSE events, their order and their payload shape are
 * unchanged, so a caller that passes nothing behaves exactly as before.
 */
function runScript(name, args, res, { onExit } = {}) {
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

  // Recorded so a dashboard that dies mid-publish does not leave the upload
  // running behind it, with no window on screen to stop it.
  const script = { pid: child.pid, startedAt: processStartedAt(child.pid), id: name };
  runningScripts.add(script);
  persist();

  // Set by the child's own close, because a normal completion ends the response
  // and would otherwise cancel the child it just finished reporting on.
  let finished = false;

  // A closed tab, a reload or a sleeping laptop drops the stream mid-publish and
  // leaves the upload running with nothing left to stop it. Cancelling kills the
  // tree: the child records the exit in its own handler, and a taskkill that did
  // not land leaves the manifest entry for the watchdog to reap.
  res.on('close', () => {
    if (finished) return;
    finished = true;
    killTree(child.pid);
  });

  child.stdout.on('data', (chunk) => send('output', String(chunk)));
  child.stderr.on('data', (chunk) => send('output', String(chunk)));
  child.on('error', (err) => send('error', String(err)));
  child.on('close', (code) => {
    finished = true;
    runningScripts.delete(script);
    persist();
    send('done', JSON.stringify({ code }));
    res.end();
    // After the stream is closed, so the hook cannot interleave output into an
    // ended response; its own failure is swallowed - bookkeeping must never change
    // what the client saw.
    try {
      onExit?.(code);
    } catch {
      // Nothing to do - the publish already happened either way.
    }
  });
}

/**
 * Every dev surface, as data. `port` is what makes "is it up" answerable - a
 * service is running when something listens there - and it lets the panel report
 * a target as up even when the dashboard did not start it, which stops Stop from
 * claiming to own someone else's process.
 */
// A `.bat` service is OPENED, not spawned: `start` gives it its own console
// window that outlives the dashboard and whose output the user reads directly,
// rather than truncating `npm run tauri:dev` into a 1500-char tail. Consequence:
// an opened service has pid null, so persist() filters it out and stop() cannot
// kill it (it only stops offering to reopen one).
const SERVICES = [
  {
    id: 'launcher',
    name: 'Launcher',
    note: 'Tauri app with hot reload, in its own window. First build takes minutes.',
    bat: 'run-launcher.bat',
    cwd: repoRoot,
    port: 1420,
    url: null,
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
  {
    id: 'website',
    name: 'Website',
    note: 'pandawan-launcher-site, via wrangler pages dev.',
    bat: 'run-website.bat',
    cwd: repoRoot,
    port: 8788,
    url: 'http://127.0.0.1:8788',
    // The site is a sibling checkout, so the .bat is only runnable when present.
    requires: siteRoot,
  },
];

/**
 * Crash-safe record of what this hub started. On Windows, closing a console app
 * does not reliably deliver SIGINT or SIGTERM, and process.on('exit') does not
 * run when the window is closed with X - exactly how run-dashboard.bat ends - so
 * the reap-on-exit handler is best effort and a hard kill would strand every tree
 * it started. The on-disk manifest is the real guarantee, and two cleaners read
 * it: the watchdog the moment this process dies, and the next launch for anything
 * a hard kill stranded. Each pid is written with its process start time, which is
 * what makes killing it later safe - a recycled pid will not match, so it is
 * never killed.
 */
const manifestPath = path.join(os.tmpdir(), 'pandawan-dashboard-services.json');

/**
 * Mirror the live map to disk so the watchdog and the next launch can clean up
 * after this one.
 */
function persist() {
  writeManifest(
    manifestPath,
    [
      // `pid` is null for a service opened in its own window: there is no process
      // of ours to remember, so it is left out rather than persisted as "unknown
      // pid" on the next launch.
      ...[...started.values()].map((e) => ({
        pid: e.pid,
        startedAt: e.startedAt,
        id: e.service.id,
      })),
      ...[...runningScripts].map((e) => ({ pid: e.pid, startedAt: e.startedAt, id: e.id })),
    ].filter((e) => e.pid)
  );
}

/**
 * Nothing inside this process runs when its window is closed with X, so when the
 * killing has to happen the process doing it must outlive us. The watchdog holds
 * the write end of our stdin and is never sent a byte: the pipe closing is the
 * death notice, so the manifest is reaped the moment this process goes, whether
 * that was a window close, a crash or a kill from outside.
 */
function startWatchdog() {
  const child = spawn(process.execPath, [path.join(here, 'dashboard-watchdog.mjs'), manifestPath], {
    detached: true,
    // A background reaper, not a service: it opens no console window of its own.
    windowsHide: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  // The pipe is the signal and stays open; unref only releases the event loop,
  // which is what lets a dashboard that finishes on its own still exit.
  child.stdin?.unref?.();
  child.unref();
}

/**
 * The toolchain directories scripts/dev-env.bat adds on a double-click, mirrored
 * here because the dashboard starts commands directly. Without it a hub started
 * from a desktop predating a Rust install cannot find cargo.
 */
function buildEnv() {
  const env = { ...process.env };

  // Windows spells this variable "Path" far more often than "PATH", and env keys
  // are case-insensitive to the OS but case-SENSITIVE to a JS object, so reading
  // env.PATH returned undefined and prepending produced the literal string
  // "dir;undefined" - destroying PATH for every child. Use whichever spelling
  // this process actually has.
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
 * Everything the dashboard has started, keyed by service id. `pid` is the root of
 * the tree we spawned; the whole tree dies with it, so children are not tracked.
 */
const started = new Map();

/**
 * Publishing scripts currently running, as `{ pid, startedAt, id }`. They are
 * not services and have no SERVICES entry, but an in-flight upload is exactly
 * the thing that must not be left running with nothing on screen to stop it, so
 * they are recorded the same way.
 */
const runningScripts = new Set();

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

function start(service) {
  if (started.has(service.id)) return { ok: false, error: 'already started by the dashboard' };
  if (service.requires && !existsSync(service.requires)) {
    return { ok: false, error: `folder not found: ${service.requires}` };
  }

  // `shell: true` on Windows resolves `npm`/`python` through the PATHEXT lookup.
  // The pid then belongs to cmd.exe rather than to node, which is harmless here
  // precisely because killTree walks the tree.
  const comspec = process.env.ComSpec || 'cmd.exe';

  // A .bat service is opened, not spawned: `start` gives it its own console
  // window that outlives this dashboard. `start` returns as soon as the window
  // opens, so there is nothing to wait on and nothing keeping this process alive.
  if (service.bat) {
    const child = spawn(comspec, ['/d', '/s', '/c', 'start', '""', service.bat], {
      cwd: service.cwd,
      env: buildEnv(),
      shell: false,
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
    started.set(service.id, {
      // pid null: the console window belongs to cmd, and killing it would close
      // the user's terminal rather than the dev server. Presence is tracked by the
      // port instead, which is what the user actually cares about.
      pid: null,
      startedAt: null,
      service,
      exited: false,
    });
    persist();
    return { ok: true, opened: true };
  }

  const commandLine = [service.command, ...service.args].join(' ');
  const child = spawn(comspec, ['/d', '/s', '/c', commandLine], {
    cwd: service.cwd,
    env: buildEnv(),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const tail = [];
  // Output is kept, not discarded: a service that dies during startup is the most
  // common failure here, and with stdio ignored the only symptom was a button
  // that stopped working.
  const collect = (chunk) => {
    tail.push(chunk.toString());
    while (tail.length > 1 && tail.join('').length > 1500) tail.shift();
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  const entry = {
    pid: child.pid,
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

  // An opened service has no process of ours to kill, and killing the window
  // would close the user's terminal rather than the dev server. The window is
  // theirs to close; the button only stops offering to reopen one.
  if (!entry.pid) {
    started.delete(id);
    persist();
    return { ok: true, opened: true, note: 'close its window to stop it' };
  }

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
        // True when this service runs in its own console window rather than as a
        // process we can stop. The UI needs it to avoid offering a Stop button that
        // would only kill part of the tree, and to say where the output is going.
        opened: Boolean(service.bat),
        // The last few lines of output, so a service that failed to start can
        // explain itself in the page. Always null for a `bat` service: its output
        // is in its own window, not here.
        log: entry?.exited ? entry.tail.join('').trim().slice(-600) : null,
      };
    })
  );
}

/**
 * The pid currently listening on a loopback port, or null. Used by the explicit
 * "stop it anyway" action: a service whose root process died can leave a
 * descendant still holding the port, and that descendant is no longer provably
 * ours, so killing it automatically could kill an unrelated program that later
 * inherited the pid. Making it a button keeps the decision with the person who
 * can see what they are stopping.
 */
function listenerPid(port) {
  const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  for (const line of (out.stdout ?? '').split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    // columns: protocol, local address, foreign address, state, pid
    if (parts.length < 5 || parts[3] !== 'LISTENING') continue;
    // Take the port from the local-address column rather than matching the whole
    // line: a server may bind 0.0.0.0, and a regex pinned to loopback silently
    // failed to find exactly the processes it was meant to clean up.
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

/**
 * Resolve an operator-supplied local artwork path, refusing anything that did not
 * come from `/api/art/stage`.
 *
 * The only legitimate producer of these paths is the stage route, which writes
 * under `artStagingDir` and hands back an absolute path for the existing
 * `--icon-file` flow. Checking only that a path exists let a request name any file
 * on the machine -- `.env` included -- and the publisher would hash its bytes and
 * `aws s3 cp` them to a public content-addressed URL. One check, at the only two
 * call sites, closes it.
 */
function resolveStagedArtwork(res, raw) {
  const localPath = path.resolve(String(raw).trim());
  const stage = path.resolve(artStagingDir) + path.sep;
  if (!localPath.startsWith(stage)) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('Only artwork staged by /api/art/stage can be uploaded.');
    return null;
  }
  if (!existsSync(localPath)) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end(`No such staged file: ${raw}`);
    return null;
  }
  return localPath;
}

const server = http.createServer(async (req, res) => {
  if (rejectRebinding(req, res)) return;

  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/inventory' && req.method === 'GET') {
    try {
      // The most expensive read in the panel: a recursive listing plus one CDN
      // request per game per channel, re-run on every tab switch without this.
      const read = await cachedRead(url, async () => {
        const inventory = await buildInventory();
        return { inventory, drift: findDrift(inventory) };
      });
      res.writeHead(200, {
        'content-type': 'application/json',
        ...cacheHeaders(read.state, read.ageMs),
      });
      res.end(JSON.stringify(read.value));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // --- Local dev services -------------------------------------------------
  //
  // Start, stop and inspect the local dev servers. They live on the same
  // loopback-only, rebinding-guarded server so there is one place to look.

  if (url.pathname === '/api/services' && req.method === 'GET') {
    try {
      // Cached briefly, and "briefly" is the whole design: the client polls it
      // every few seconds, so an uncached answer was a fresh set of socket
      // connects per poll - the constant refetching this panel was asked to stop.
      // Thirty seconds caps how long a stopped dev server reads as running; every
      // read inside that window costs nothing. start/stop/force-stop drop it
      // immediately, so the button just pressed is never answered with the state
      // from before it.
      const read = await cachedRead(url, status);
      res.writeHead(200, {
        'content-type': 'application/json',
        ...cacheHeaders(read.state, read.ageMs),
      });
      res.end(JSON.stringify(read.value));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
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
    // Dropped on acceptance rather than on exit: a start takes seconds, and the
    // poll that follows would otherwise be answered from the pre-start state -
    // showing "not running" for a server that is up.
    invalidateCache('/api/services');
    return;
  }

  if (url.pathname === '/api/service/stop' && req.method === 'POST') {
    const result = stop(url.searchParams.get('id'));
    res.writeHead(result.ok ? 200 : 409, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    // Same reason as start, in the other direction: the answer that goes stale is
    // "still running".
    invalidateCache('/api/services');
    return;
  }

  if (url.pathname === '/api/service/force-stop' && req.method === 'POST') {
    const result = forceStop(url.searchParams.get('id'));
    res.writeHead(result.ok ? 200 : 409, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    // forceStop kills the listener directly, so nothing about `started` changes -
    // the port probe is the only thing that will report the difference.
    invalidateCache('/api/services');
    return;
  }

  if (url.pathname === '/api/publish' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (payload === JSON_REFUSED) return;

    // A build publish changes the inventory, rewrites manifest.json and
    // latest.json (which readGameMetadata fetches), and can ship artwork - so
    // inventory + meta + art all go stale on acceptance, not on child exit.
    invalidateCache('/api/inventory');
    invalidateCache('/api/meta');
    invalidateCache('/api/art');

    // Args cross as an array and go to spawn without a shell, so nothing typed
    // into the form can become a command.
    const argv = Array.isArray(payload.args) ? payload.args.map(String) : [];
    runScript('publish-game.mjs', argv, res);
    return;
  }

  if (url.pathname === '/api/prune' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (payload === JSON_REFUSED) return;

    // prune-builds deletes build directories, so its argv is assembled from named
    // fields rather than forwarded: the form cannot smuggle in flags like
    // --clean-flat or --older-than that the UI never offers.
    const gameId = String(payload.gameId ?? '').trim();
    const channel = String(payload.channel ?? '').trim();
    // A bare `--token` is a flag to prune-builds, so a value starting with one
    // would silently become a different option.
    if (!gameId || gameId.startsWith('--') || channel.startsWith('--')) {
      res.writeHead(400).end('game and channel must be names, not flags');
      return;
    }

    const argv = ['--game-id', gameId, '--channel', channel || 'stable'];
    argv.push('--keep', String(Number(payload.keep) | 0));
    // The script's own prompt reads a keystroke from a console this stream has no
    // access to, so --dry-run is the default and a real run needs confirm: true.
    argv.push(payload.confirm ? '--yes' : '--dry-run');

    // Pruning removes build directories, so the listing the inventory is built
    // from is now wrong. Dropped even for a dry run: one extra bucket read is
    // cheaper than a panel that lies.
    invalidateCache('/api/inventory');

    runScript('prune-builds.mjs', argv, res);
    return;
  }

  // --- Catalog ------------------------------------------------------------
  //
  // The GET returns both copies so the difference is visible before it is acted
  // on.

  if (url.pathname === '/api/catalog' && req.method === 'GET') {
    try {
      const read = await cachedRead(url, async () => {
        const [live, local] = await Promise.all([readLiveCatalog(), readLocalCatalog()]);

        // Both copies travel whole, not just the diff: the table renders the
        // fields themselves, and a diff of field names cannot say what a name is.
        return {
          live: live.catalog,
          local: local.catalog,
          // Which side is real matters more than the diff: against an absent
          // document every game reads as onlyLive/onlyLocal, which looks like the
          // two copies disagreeing when one of them could not be read at all.
          liveStatus: live.status,
          liveDetail: live.detail,
          localStatus: local.status,
          localDetail: local.detail,
          localPath: local.path,
          diff: catalogDiff(live.catalog, local.catalog),
          inSync: catalogDiffIsEmpty(catalogDiff(live.catalog, local.catalog)),
          // What pressing Publish would do, from the merge the publisher runs, so
          // the panel cannot promise something the script would not do.
          plan: publishPlan(live.catalog, local.catalog),
          // The field contract the form renders from, served rather than copied:
          // a hand-typed client list drifts silently from the publisher's.
          fieldSpec: FIELD_SPEC,
          url: CATALOG_URL,
        };
      });
      res.writeHead(200, {
        'content-type': 'application/json',
        ...cacheHeaders(read.state, read.ageMs),
      });
      res.end(JSON.stringify(read.value));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (url.pathname === '/api/catalog/create' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (payload === JSON_REFUSED) return;

    // The entry shape is decided by the tested module; the id is validated there
    // too because it becomes a bucket path segment.
    const built = catalogEntryFrom(payload);
    if (!built.ok) {
      res.writeHead(400).end(built.error);
      return;
    }

    const live = await readLiveCatalog();
    if (live.status !== 'ok') {
      // Refused rather than creating a document from scratch: writing a new
      // catalog because the CDN was unreachable would drop every game the local
      // file happens not to mention - the outage publish-catalog.mjs refuses to
      // cause. The messages name the status so the operator knows whether to retry
      // or to go fix the document.
      res
        .writeHead(409)
        .end(
          live.status === 'absent'
            ? 'There is no published catalog to add to yet. Run a catalog publish first.'
            : `The published catalog could not be read (${live.status}${
                live.detail ? `: ${live.detail}` : ''
              }). Refusing to write a new one from scratch.`
        );
      return;
    }

    if (catalogGames(live.catalog).some((entry) => entry?.id === built.entry.id)) {
      res
        .writeHead(409)
        .end(`"${built.entry.id}" is already in the published catalog. Edit it instead.`);
      return;
    }

    // The add goes through the publisher's own merge rule rather than an array
    // push, so the dashboard cannot produce a document the publisher would have
    // refused to write.
    const merged = mergeCatalog(live.catalog, { games: [built.entry] });
    if (merged.added.length === 0) {
      res
        .writeHead(409)
        .end(`"${built.entry.id}" could not be added: the merge kept the published entry.`);
      return;
    }
    // Stamped by the merge itself when it moved something, so the dashboard does
    // not have a second opinion about when the document changed.
    const catalog = merged.catalog;

    // Both create and delete have already validated this document - delete via the
    // publisher's validateCatalog, create because the entry passed
    // catalogEntryFrom - so there is nothing left to check here.
    const created = await catalogWrite(res, catalog);
    if (!created) return;
    invalidateCache('/api/catalog');
    // The metadata read resolves launcher/catalog.json too (catalog over
    // manifest), so a create makes every game's metadata stale - not just the
    // panel that shows the catalog itself.
    invalidateCache('/api/meta');
    created.entry = built.entry;
    return;
  }

  if (url.pathname === '/api/catalog/delete' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (payload === JSON_REFUSED) return;

    // Delete hides a game from every launcher with no undo, so it is refused
    // without an explicit confirmation. The message says what will happen rather
    // than only refusing.
    if (payload.confirm !== true) {
      res
        .writeHead(400)
        .end(
          'Removing a game from the published catalog hides it from every launcher and ' +
            'cannot be undone. Send confirm: true to proceed.'
        );
      return;
    }

    const live = await readLiveCatalog();
    if (live.status !== 'ok') {
      res
        .writeHead(409)
        .end(
          live.status === 'absent'
            ? 'There is no published catalog to delete from.'
            : `The published catalog could not be read (${live.status}${
                live.detail ? `: ${live.detail}` : ''
              }). Nothing was deleted.`
        );
      return;
    }

    // The rules - not published, not the last entry, still valid afterwards - live
    // in the tested module, which reuses validateCatalog, so this cannot produce a
    // document publish-catalog.mjs would refuse to write.
    const removed = removeCatalogEntry(live.catalog, payload.id);
    if (!removed.ok) {
      res.writeHead(400).end(removed.error);
      return;
    }

    const deleted = await catalogWrite(res, removed.catalog);
    if (!deleted) return;
    invalidateCache('/api/catalog');
    // Same as create: the deleted game's metadata read resolves its catalog entry,
    // which now no longer exists.
    invalidateCache('/api/meta');
    deleted.removed = removed.removed;
    deleted.remaining = removed.remaining;
    return;
  }

  if (url.pathname === '/api/catalog' && req.method === 'POST') {
    // publish-catalog.mjs merges additively and supports --dry-run, forwarded so
    // the UI's "preview only" checkbox is honoured.
    const payload = await readJson(req, res);
    if (payload === JSON_REFUSED) return;
    // Dropped on acceptance: a read taken during the publish would otherwise be
    // served for the rest of the TTL. The same script re-uploads public/news.json
    // to launcher/news.json unless SKIP_NEWS, so /api/news is stale too. /api/meta
    // IS touched: the publish merges launcher/catalog.json, which readGameMetadata
    // resolves, so it can add or change a game's catalog entry. Dropped on a dry
    // run as well - one extra read beats a panel that shows pre-publish values.
    invalidateCache('/api/catalog');
    invalidateCache('/api/meta');
    invalidateCache('/api/inventory');
    invalidateCache('/api/news');
    runScript('publish-catalog.mjs', payload.dryRun ? ['--dry-run'] : [], res);
    return;
  }

  // --- Game metadata ------------------------------------------------------
  //
  // Editing metadata is a different verb from publishing a build: the build
  // already exists and only the presentation layer changes. The panel loads what
  // is live first, so an edit starts from the truth rather than a blank form.

  if (url.pathname === '/api/meta' && req.method === 'GET') {
    const gameId = url.searchParams.get('gameId') ?? '';
    const channel = url.searchParams.get('channel') ?? '';
    if (!gameId || !channel) {
      res.writeHead(400).end('gameId and channel are required');
      return;
    }
    try {
      // Cached per game+channel: the query is part of the key, so one game's
      // metadata is never served under another's name.
      const read = await cachedRead(url, async () => ({
        // The field contract travels with the read, the way /api/news serves its
        // own: the client cannot import the .mjs module, so it renders from this
        // and cannot drift into offering a field the publisher ignores.
        ...(await readGameMetadata(gameId, channel, { cdnOrigin, fields: FIELDS })),
        fieldSpec: FIELD_SPEC,
      }));
      res.writeHead(200, {
        'content-type': 'application/json',
        ...cacheHeaders(read.state, read.ageMs),
      });
      res.end(JSON.stringify(read.value));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (url.pathname === '/api/meta/publish' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (payload === JSON_REFUSED) return;

    // The argument list is assembled from named fields rather than forwarded, for
    // the same reason prune does it: the form must not pass through a flag the UI
    // never offers.
    const argv = ['--game-id', String(payload.gameId ?? '').trim()];
    argv.push('--channel', String(payload.channel ?? '').trim());
    if (payload.dryRun) argv.push('--dry-run');

    for (const field of FIELDS) {
      const value = payload[field.flag];
      // Absent means "leave whatever is published", which is what makes a partial
      // edit safe, so the distinction between absent and empty has to survive to
      // here.
      if (value === undefined || value === null) continue;
      const text = String(value).trim();
      // An emptied text field clears the value; an emptied list field does not,
      // since a comma list cannot express "no genres" and [] would erase the field.
      if (text === '' && field.list) continue;
      argv.push(`--${field.flag}`, text);
    }

    for (const [flag, key] of [
      ['icon-file', 'iconFile'],
      ['banner-file', 'bannerFile'],
    ]) {
      const file = payload[key];
      if (typeof file !== 'string' || !file.trim()) continue;
      const localPath = resolveStagedArtwork(res, file);
      if (!localPath) return;
      argv.push(`--${flag}`, localPath);
    }

    // A metadata publish rewrites the catalog entry on the CDN, so the metadata
    // read, the catalog read and the artwork listing are all stale on acceptance.
    // Dropped even on a dry run: one extra read is cheaper than a form that shows
    // pre-edit values.
    invalidateCache('/api/meta');
    invalidateCache('/api/art');
    invalidateCache('/api/catalog');

    runScript('publish-metadata.mjs', argv, res);
    return;
  }

  // --- Artwork -----------------------------------------------------------
  //
  // The form shows a URL but not which object players are actually seeing, and a
  // browser file input cannot report the absolute path the publisher needs. So the
  // bucket is listed, and a chosen file is staged to a real path for the existing
  // --icon-file flow to upload.

  if (url.pathname === '/api/art' && req.method === 'GET') {
    const scope = url.searchParams.get('scope') === 'news' ? 'news' : 'game';
    const values = Object.fromEntries(
      Object.entries(IMAGE_FIELDS).map(([metadataFlag]) => [
        metadataFlag,
        url.searchParams.get(metadataFlag) ?? '',
      ])
    );
    // Screenshots are a list field the listing must mark too: without this a
    // screenshot object reads as unused and invites a delete that breaks a page.
    values['screenshots'] = url.searchParams.get('screenshots') ?? '';

    let prefix;
    if (scope === 'news') {
      prefix = NEWS_ART_PREFIX;
      values['image-url'] = url.searchParams.get('image-url') ?? '';
    } else {
      const gameId = (url.searchParams.get('gameId') ?? '').trim();
      const channel = (url.searchParams.get('channel') ?? '').trim();
      if (!gameId || !channel) {
        res.writeHead(400).end('gameId and channel are required');
        return;
      }
      // The channel becomes a path segment, so only a known one is allowed.
      if (!CHANNELS.includes(channel)) {
        res.writeHead(400).end(`channel must be one of ${CHANNELS.join(', ')}`);
        return;
      }
      prefix = `games/${gameId}/${channel}`;
    }

    try {
      // The form re-reads this after every upload, which is what made the picker
      // feel slow.
      const read = await cachedRead(url, async () => {
        const keys = await listKeysWithMeta(S3.s3Uri(bucket, prefix), {
          endpoint,
          throwOnFailure: true,
        });
        // Keyed by the contract entry's key ("icon-url"), NOT its `flag` field
        // ("icon-file"), which names the CLI option. Keyed wrong, nothing is in use.
        const objects = sortArtwork(
          describeArtwork(selectArtworkObjects(keys, { prefix, cdnOrigin }), values)
        );
        return { scope, prefix, objects };
      });
      res.writeHead(200, {
        'content-type': 'application/json',
        ...cacheHeaders(read.state, read.ageMs),
      });
      res.end(JSON.stringify(read.value));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (url.pathname === '/api/art/stage' && req.method === 'POST') {
    // base64 adds a third again to the file, so the body cap sits above the file
    // cap rather than at it.
    const payload = await readJson(req, res, { maxBytes: Math.ceil(MAX_ARTWORK_BYTES * 1.4) });
    if (payload === JSON_REFUSED) return;

    const fileName = String(payload.fileName ?? '');
    const check = validateArtwork({ fileName, sizeBytes: Number(payload.sizeBytes) });
    if (check.error) {
      res.writeHead(400).end(check.error);
      return;
    }

    // Only the decoded bytes are checked against the limit: the declared size is
    // operator input, and trusting it would let a small-declared request write an
    // arbitrarily large file.
    let bytes;
    try {
      bytes = Buffer.from(String(payload.data ?? ''), 'base64');
    } catch {
      res.writeHead(400).end('the file could not be decoded');
      return;
    }
    if (!bytes.length) {
      res.writeHead(400).end('the file is empty');
      return;
    }
    if (bytes.length > MAX_ARTWORK_BYTES) {
      res.writeHead(413).end('the file is larger than the upload limit');
      return;
    }

    try {
      await mkdir(artStagingDir, { recursive: true });
      const localPath = path.join(artStagingDir, safeLocalName(check.name));
      await writeFile(localPath, bytes);
      res.writeHead(200, { 'content-type': 'application/json' });
      // The absolute path is what makes the existing --icon-file flow work unchanged.
      res.end(JSON.stringify({ localPath, name: check.name, sizeBytes: bytes.length }));
    } catch (err) {
      res.writeHead(500).end(`could not stage the file: ${String(err)}`);
    }
    return;
  }

  if (url.pathname === '/api/art/upload' && req.method === 'POST') {
    // Same body cap as /api/art/stage: the base64 payload adds a third again to
    // the file, so the request cap sits above the file cap rather than at it.
    const payload = await readJson(req, res, { maxBytes: Math.ceil(MAX_ARTWORK_BYTES * 1.4) });
    if (payload === JSON_REFUSED) return;

    const gameId = String(payload.gameId ?? '').trim();
    const channel = String(payload.channel ?? '').trim();
    // The key is built from these, so they are treated as path segments here
    // rather than trusted: a gameId carrying a slash or `..` would escape the
    // game's own prefix.
    if (!gameId || !channel) {
      res.writeHead(400).end('gameId and channel are required');
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(gameId) || gameId.includes('..')) {
      res.writeHead(400).end('gameId must be a plain id');
      return;
    }
    if (!CHANNELS.includes(channel)) {
      res.writeHead(400).end(`channel must be one of ${CHANNELS.join(', ')}`);
      return;
    }

    // Decoded FIRST, and the limit checked against the DECODED length: a declared
    // sizeBytes is operator input, and trusting it would let a small-declared
    // request write an arbitrarily large object.
    let bytes;
    try {
      bytes = Buffer.from(String(payload.data ?? ''), 'base64');
    } catch {
      res.writeHead(400).end('the file could not be decoded');
      return;
    }
    if (!bytes.length) {
      res.writeHead(400).end('the file is empty');
      return;
    }
    const check = validateArtwork({
      fileName: String(payload.fileName ?? ''),
      sizeBytes: bytes.length,
    });
    if (check.error) {
      res.writeHead(400).end(check.error);
      return;
    }

    // The name is decided by the CONTENT, never chosen or sent by the client. The
    // base is a constant rather than the source filename on purpose: a
    // filename-derived base would let the same image be uploaded twice under two
    // names, which is exactly what content addressing exists to prevent. The
    // extension still comes from the source file, through artwork.mjs's rules, so
    // the object is served with the right Content-Type.
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
    const objectName = artworkObjectName({
      baseName: 'artwork',
      hash,
      fileName: check.name,
      fallbackName: 'artwork.png',
    });
    const prefix = `games/${gameId}/${channel}`;
    const key = `${prefix}/${objectName}`;
    const objectUrl = `${String(cdnOrigin).replace(/\/+$/, '')}/${key}`;

    // Content addressing makes the same image the same object, so the check is by
    // HASH, not by the exact key: the same bytes already on the bucket - even
    // published as this game's icon - are a no-op rather than a second copy.
    let existing = null;
    try {
      const keys = await listKeysWithMeta(S3.s3Uri(bucket, prefix), {
        endpoint,
        throwOnFailure: true,
      });
      existing = keys.find((entry) => {
        const name = String(entry?.key ?? '').slice(prefix.length + 1);
        return !name.includes('/') && new RegExp(`-${hash}\\.[a-z0-9]+$`, 'i').test(name);
      });
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `could not read the bucket: ${String(err)}` }));
      return;
    }

    const plan = {
      key,
      objectName,
      url: objectUrl,
      sizeBytes: bytes.length,
      duplicate: Boolean(existing),
      existingName: existing ? String(existing.key).slice(prefix.length + 1) : null,
    };

    // A dry run is the default. It answers with the consequence - the name the
    // bytes will land under, derived from their hash, and whether they are
    // already on the bucket - because the name cannot be known before the bytes
    // are hashed, which is why the operator's confirm comes AFTER this call and
    // names both the file and the resulting object.
    if (payload.confirm !== true) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, written: false, ...plan }));
      return;
    }

    if (existing) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, written: false, ...plan }));
      return;
    }

    const localPath = path.join(artStagingDir, `upload-${Date.now()}-${safeLocalName(check.name)}`);
    try {
      await mkdir(artStagingDir, { recursive: true });
      await writeFile(localPath, bytes);
      // The same r2.mjs layer the delete path uses. Immutable, because the key
      // carries a content hash: a changed image lands on a different URL.
      upload(localPath, S3.s3Uri(bucket, key), {
        endpoint,
        cacheControl: IMMUTABLE,
        throwOnFailure: true,
      });
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `could not upload ${objectName}: ${String(err)}` }));
      return;
    } finally {
      // The staged copy is only the bridge to `aws s3 cp`; its failure is not the
      // operator's problem once the object is written.
      rm(localPath, { force: true }).catch(() => {});
    }

    // The listing changed, so the cached read that feeds both the Artwork tab and
    // the picker is dropped on ACCEPTANCE, matching the delete and
    // metadata-publish handlers.
    invalidateCache('/api/art');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, written: true, ...plan }));
    return;
  }

  if (url.pathname === '/api/art/delete' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (payload === JSON_REFUSED) return;

    const key = String(payload.key ?? '').trim();
    // Removing an object from the bucket cannot be undone, so it is refused
    // without an explicit confirmation - the client sends confirm: true only
    // after a window.confirm that names the object.
    if (payload.confirm !== true) {
      res
        .writeHead(400)
        .end('Deleting an artwork object cannot be undone. Send confirm: true to proceed.');
      return;
    }

    // Only a plausible artwork key reaches aws: a single object directly under a
    // game's channel (or the news prefix), with an image extension and no path
    // escape. Anything else is a bug, not a delete.
    const isNews = key.startsWith(`${NEWS_ART_PREFIX}/`);
    const segments = key.split('/');
    const plausible =
      (key.startsWith('games/') || isNews) &&
      !key.includes('..') &&
      segments.length === (isNews ? 3 : 4) &&
      /\.(png|jpe?g|webp|gif)$/i.test(key);
    if (!plausible) {
      res.writeHead(400).end('That is not an artwork key.');
      return;
    }

    const object = { key, url: `${String(cdnOrigin).replace(/\/+$/, '')}/${key}` };

    // CRITICAL: artwork is content-addressed and its URLs are referenced by
    // catalog.json and manifest.json, so deleting an object something still
    // points at breaks a live store page. Every published value is checked
    // FIRST; a referenced object is refused with the fields that name it.
    const referencedBy = [];
    const values = [];
    const [live, local] = await Promise.all([readLiveCatalog(), readLocalCatalog()]);
    for (const doc of [live.catalog, local.catalog]) {
      for (const game of doc?.games ?? []) {
        for (const [field, value] of Object.entries(game ?? {})) {
          for (const one of Array.isArray(value) ? value : [value]) {
            if (typeof one === 'string' && one.trim())
              values.push([`${game?.id ?? 'a game'}.${field}`, one]);
          }
        }
      }
    }
    // games/<id>/<channel>/<name>: the channel's manifest can name the object
    // even when no catalog entry does.
    const [, gameId, channel] = segments;
    try {
      const meta = await readGameMetadata(gameId ?? '', channel ?? '', {
        cdnOrigin,
        fields: FIELDS,
      });
      for (const [flag, field] of Object.entries(meta.fields ?? {})) {
        const value = field?.value;
        for (const one of Array.isArray(value) ? value : String(value ?? '').split(',')) {
          if (String(one).trim()) values.push([flag, String(one)]);
        }
      }
    } catch {
      // A manifest that cannot be read does not excuse skipping the catalog
      // check that already ran.
    }
    for (const [field, value] of values) {
      if (referencesObject(value, object)) referencedBy.push(field);
    }

    if (referencedBy.length) {
      res
        .writeHead(409)
        .end(
          `${key} is still referenced by ${[...new Set(referencedBy)].join(', ')}; ` +
            'deleting it would break a live page, so it was not deleted.'
        );
      return;
    }

    try {
      // throwOnFailure: a plain run() calls process.exit(1) on a non-zero aws
      // exit, which would kill the dashboard instead of reporting the refusal.
      deleteObject(S3.s3Uri(bucket, key), { endpoint, throwOnFailure: true });
    } catch (err) {
      res.writeHead(500).end(`could not delete ${key}: ${String(err)}`);
      return;
    }

    // The listing changed, as did the metadata read that marks which object each
    // field points at, the inventory the rail is built from, and the catalog
    // whose entries name these URLs.
    invalidateCache('/api/art');
    invalidateCache('/api/meta');
    invalidateCache('/api/inventory');
    invalidateCache('/api/catalog');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, deleted: key }));
    return;
  }

  // --- News ---------------------------------------------------------------
  //
  // One flat document rather than two drifting copies. Served from the CDN, not
  // the working tree: public/news.json is the bundled offline fallback the
  // publisher keeps in step, so reading it as the source of truth would mean
  // editing a file about to be overwritten.

  if (url.pathname === '/api/news' && req.method === 'GET') {
    try {
      const read = await cachedRead(url, async () => {
        const feed = await readNewsFeed(cdnOrigin);
        // Normalised into the contract's field names here, not in the browser, so
        // the form renders one shape whatever the document holds.
        const items = (feed.items ?? []).map((item) => ({
          id: item.id,
          label: newsItemLabelFor(item),
          fields: newsItemToFields(item),
          imageUrl: item.imageUrl ?? '',
        }));
        const categories = [
          ...new Set([
            ...NEWS_CATEGORY_SUGGESTIONS,
            ...items.map((item) => item.fields.category).filter(Boolean),
          ]),
        ];
        return {
          ...feed,
          items,
          categories,
          // The browser cannot import the contract (no bundler), so the field list
          // travels with the response rather than being hand-typed into the client.
          fields: NEWS_FIELDS,
        };
      });
      res.writeHead(200, {
        'content-type': 'application/json',
        ...cacheHeaders(read.state, read.ageMs),
      });
      res.end(JSON.stringify(read.value));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (url.pathname === '/api/news/publish' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (payload === JSON_REFUSED) return;

    // Validated rather than forwarded: the publisher treats a bare --flag as
    // destructive, so an unrecognised value from the form must never become one.
    const ops = [];
    const op = String(payload.op ?? '').trim();
    if (op === 'update') {
      const id = String(payload.id ?? '').trim();
      if (!id) {
        res.writeHead(400).end('an update needs the id of the item to change');
        return;
      }
      const values = {};
      for (const field of NEWS_FIELDS) {
        if (payload[field.flag] !== undefined) values[field.flag] = payload[field.flag];
      }
      ops.push({ op: 'update', id, values });
    } else if (op === 'create') {
      // A chosen id from the browser could collide with a published item and merge
      // two announcements, so an absent one is derived here from the live feed.
      let id = String(payload.id ?? '').trim();
      const values = {};
      for (const field of NEWS_FIELDS) {
        if (payload[field.flag] !== undefined) values[field.flag] = payload[field.flag];
      }
      if (!id) {
        let feed;
        try {
          feed = await readNewsFeed(cdnOrigin);
        } catch (err) {
          res.writeHead(409, { 'content-type': 'text/plain' });
          res.end(String(err));
          return;
        }
        id = uniqueNewsId(
          values.title ?? 'new-item',
          (feed.items ?? []).map((i) => i.id)
        );
      }
      ops.push({ op: 'create', id, values });
    } else if (op === 'delete') {
      const id = String(payload.id ?? '').trim();
      if (!id) {
        res.writeHead(400).end('a delete needs the id of the item to remove');
        return;
      }
      ops.push({ op: 'delete', id });
    } else if (op === 'move') {
      const id = String(payload.id ?? '').trim();
      if (!id || (payload.delta !== -1 && payload.delta !== 1)) {
        res.writeHead(400).end('a move needs an id and a delta of 1 or -1');
        return;
      }
      ops.push({ op: 'move', id, delta: payload.delta });
    } else {
      res.writeHead(400).end(`unknown operation "${op}"`);
      return;
    }

    const argv = [];
    if (payload.dryRun) argv.push('--dry-run');
    for (const one of ops) {
      // Every flag is written with its `--` prefix here. `one.op` is a bare verb
      // ("update"), and a token without the prefix is not an argument at all:
      // parseArgs skips it silently, so the publisher reports "say what to do"
      // instead of the edit that was requested.
      if (one.op === 'move') argv.push('--move', one.id, one.delta === -1 ? '--up' : '--down');
      else if (one.op === 'delete') argv.push('--delete', one.id);
      // Create carries its id as a separate --id flag rather than as the value of
      // --create: written bare, --create has no positional value to fall back on,
      // and parseArgs would read the following flag as a boolean and lose the id.
      else if (one.op === 'create') argv.push('--create', '--id', one.id);
      else argv.push(`--${one.op}`, one.id);
    }
    // Field flags go only with an update or create; --delete and --move take none.
    const values = ops[0].values;
    if (values) {
      for (const field of NEWS_FIELDS) {
        if (values[field.flag] === undefined) continue;
        argv.push(`--${field.flag}`, String(values[field.flag]));
      }
      if (typeof payload.imageFile === 'string' && payload.imageFile.trim()) {
        const localPath = resolveStagedArtwork(res, payload.imageFile);
        if (!localPath) return;
        argv.push('--image-file', localPath);
      }
    }

    // A news publish rewrites the feed the panel reads, and a news image lands in
    // the artwork listing the picker uses. Dropped even on a dry run.
    invalidateCache('/api/news');
    invalidateCache('/api/art');

    runScript('publish-news.mjs', argv, res);
    return;
  }

  // --- Launcher releases -------------------------------------------------
  //
  // The launcher ships through a different pipeline than games: CI builds and
  // signs the bundles, and only then is there anything to publish. So these
  // actions are deliberately narrower - the dashboard never builds or signs, it
  // only publishes what already exists.

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
    if (payload === JSON_REFUSED) return;
    // The tag is validated before it is passed on, so a form value can never become
    // an option (publish-launcher treats anything starting with -- as a flag).
    const tag = String(payload.tag ?? '').trim();
    if (!/^v\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(tag)) {
      res.writeHead(400).end('tag must look like v0.1.1');
      return;
    }
    const argv = ['--tag', tag];
    // --dry-run changes nothing in the bucket, so it is the default and a real
    // upload has to be asked for explicitly.
    if (payload.confirm) argv.push('--confirm');

    // The launcher manifests land under launcher/ (which the inventory reads for
    // drift) and downloads.json drives the website panel; both are stale from this
    // moment - not when the child exits.
    invalidateCache('/api/inventory');
    invalidateCache('/api/website');

    // Noted on exit, and only for a real run, because a dry run rewrites nothing
    // and a timestamp would claim the site's data moved. The response body is
    // untouched: this rides on an exit callback rather than a new field.
    runScript('publish-launcher.mjs', argv, res, {
      onExit: (code) => {
        if (code === 0 && !payload.dryRun) lastLauncherPublishAt = Date.now();
      },
    });
    return;
  }

  if (url.pathname === '/api/launcher/keys' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (payload === JSON_REFUSED) return;
    // keys:check only reads the key and signs a throwaway file, so it is always
    // safe to run from here.
    runScript('check-updater-keys.cjs', [], res);
    return;
  }

  if (url.pathname === '/api/launcher/release' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (payload === JSON_REFUSED) return;
    const level = ['patch', 'minor', 'major'].includes(payload.level) ? payload.level : 'patch';
    const argv = [level];
    // A dry run is the default, as for every other publish verb here. A real
    // release commits, tags and pushes, so it has to be asked for by name rather
    // than arrive as the absence of a flag.
    if (payload.confirm) argv.push('--confirm');

    // A release bumps the version a later publish ships, so the inventory's
    // picture of the launcher is about to move.
    invalidateCache('/api/inventory');

    runScript('release.mjs', argv, res);
    return;
  }

  // --- Website -------------------------------------------------------------
  //
  // The public download page is a SEPARATE repository, reported on rather than
  // managed. It is here because the page's data comes from THIS repo's bucket:
  // publish-launcher.mjs writes launcher/downloads.json and the site reads it
  // through a Cloudflare Pages Function, so a launcher publish changes what the
  // site shows without the site being deployed.

  if (url.pathname === '/api/website' && req.method === 'GET') {
    try {
      // Cached like the other reads: this shells out to git and wrangler and makes
      // a HEAD per artifact. ?refresh=1 bypasses it, and a deploy drops it.
      const read = await cachedRead(url, websiteStatus);
      res.writeHead(200, {
        'content-type': 'application/json',
        ...cacheHeaders(read.state, read.ageMs),
      });
      res.end(JSON.stringify(read.value));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (url.pathname === '/api/website/verify' && req.method === 'POST') {
    const missing = siteAbsentResponse(res);
    if (missing) return;

    // The site repo's own `npm run verify`, not a reimplementation: it prints what
    // the page will render from the LIVE downloads.json and exits non-zero on a
    // problem, which catches "published a launcher build whose .msi never landed
    // on the bucket" before a player clicks it. Its real network requests to R2 are
    // the point, not a side effect.
    invalidateCache('/api/website');
    runSiteScript('verify', [], res);
    return;
  }

  if (url.pathname === '/api/website/deploy' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (payload === JSON_REFUSED) return;

    const missing = siteAbsentResponse(res);
    if (missing) return;

    // Publishes the LIVE public site (`build && wrangler pages deploy dist`), which
    // replaces what every visitor sees. No dry run and no undo, so it is refused
    // unless the request says confirm: true. Strictly `=== true`: a truthy string
    // from a form would otherwise sail through a check meant to be deliberate.
    if (payload.confirm !== true) {
      res
        .writeHead(400)
        .end(
          'This publishes the website repo to Cloudflare Pages, replacing the live public ' +
            'download page for everyone. It cannot be undone from here. Send confirm: true ' +
            'to proceed.'
        );
      return;
    }

    // Warn about a dirty tree rather than blocking, and say what is uncommitted: a
    // deploy that silently ships a half-finished edit is the failure this prevents,
    // but the operator may have intended exactly those changes.
    const git = readSiteGit();
    if (git.dirty) {
      const detail = `${git.changedFiles} uncommitted change(s) in the site repo`;
      const ahead = git.ahead === null ? null : `${git.ahead} commit(s) not pushed`;
      process.stdout.write(
        `[website] deploying with ${detail}${ahead ? `, ${ahead}` : ''} - the deploy ships the working tree, not the remote.\n`
      );
    }

    // wrangler only reads the checkout and uploads dist; the dashboard writes
    // nothing to the site repo.
    invalidateCache('/api/website');
    runSiteScript('deploy', [], res);
    return;
  }

  // --- Static files -------------------------------------------------------
  //
  // The React build's files, and its app shell for any path that is not a file -
  // so `/` and a deep client-side link like /games/catalog both load.
  if (await serveAppDist(res, url.pathname)) return;

  // An unknown /api/ path is a caller bug, not a client-side route: answering it
  // with the app shell would turn "does not exist" into a 200 of HTML that a JSON
  // parser reports as a syntax error. Explicitly not falling through.
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `no such endpoint: ${req.method} ${url.pathname}` }));
    return;
  }

  // The only remaining explanation is a build that is not there, and saying so
  // beats a bare 404 that reads like a broken route.
  res.writeHead(appBuilt ? 404 : 503, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(
    appBuilt
      ? 'not found'
      : 'The dashboard app is not built. Run `npm run dashboard:build`, then reload.'
  );
});

for (const signal of ['exit', 'SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const entry of started.values()) killTree(entry.pid);
    for (const entry of runningScripts) killTree(entry.pid);
    started.clear();
    runningScripts.clear();
    writeManifest(manifestPath, []);
    if (signal !== 'exit') process.exit(0);
  });
}

startWatchdog();

const reaped = reapManifest(manifestPath);

// Without this, a port already in use is an unhandled 'error' event: the process
// dies on a stack trace that never names the port, and the .bat launchers go on
// polling it until their own timeout instead of reporting the collision at once.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use - close whatever is listening there, or pass --port.`
    );
  } else {
    console.error(`Dashboard server error: ${String(err?.message ?? err)}`);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  if (reaped) console.log(`Stopped ${reaped} leftover service tree(s) from a previous run`);
  console.log(`Dashboard on http://127.0.0.1:${PORT}`);
  console.log(`Bucket: ${bucket}`);
  // Once, at startup: a missing build is the only thing that can serve nothing.
  console.log(
    appBuilt
      ? 'UI: React build (scripts/dashboard/app/dist)'
      : 'UI: NOT BUILT - run `npm run dashboard:build`'
  );
  // The effective values are printed because they are what an operator needs when
  // a panel looks stale.
  console.log(
    `Read cache TTL: ${CACHE_TTL_ONLINE_MS}ms online (DASHBOARD_CACHE_TTL_MS), ` +
      `${CACHE_TTL_LOCAL_MS}ms local (DASHBOARD_CACHE_TTL_LOCAL_MS)`
  );
});
