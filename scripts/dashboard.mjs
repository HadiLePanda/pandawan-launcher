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
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// NO_CACHE and upload are used by the catalog CRUD paths below, which have to put
// bytes on the bucket from inside the server rather than by spawning the
// publisher. Reusing r2.mjs's upload keeps the cache-control header identical to
// the one publish-catalog.mjs writes - a mutable index served with a long-lived
// cache header is the failure mode that makes a publish look like it did nothing.
import { NO_CACHE, S3, listKeysWithMeta, loadDotEnv, r2Config, upload } from './lib/r2.mjs';
// The field contract is shared with the publisher rather than restated here, so
// the form cannot offer a field the script would silently ignore. The read side
// lives in a module so it can be tested without booting a server that holds the
// R2 keys.
import { CHANNELS, FIELDS, IMAGE_FIELDS } from './lib/metadata-fields.mjs';
import { readGameMetadata } from './lib/game-metadata.mjs';
// The news contract lives with the publisher so the form cannot offer a field the
// script would silently ignore.
import {
  NEWS_ART_PREFIX,
  NEWS_CATEGORY_SUGGESTIONS,
  NEWS_FIELDS,
  newsItemToFields,
  uniqueNewsId,
} from './lib/news-fields.mjs';
// Artwork decisions (what counts as an image, how a staged file is named, which
// field a published object belongs to) are pure and unit-tested on their own.
import {
  describeArtwork,
  MAX_ARTWORK_BYTES,
  safeLocalName,
  selectArtworkObjects,
  sortArtwork,
  validateArtwork,
} from './lib/artwork.mjs';
// The catalog read/CRUD decisions are pure and unit-tested in their own module,
// for the same reason artwork.mjs is: this file holds the R2 keys and boots a
// server, so nothing about what a catalog edit *means* can be checked here.
import {
  CATALOG_GAME_FIELDS,
  catalogDiff,
  catalogDiffIsEmpty,
  catalogEntryFrom,
  catalogGames,
  removeCatalogEntry,
} from './lib/catalog-edit.mjs';
// The merge rule itself is not restated here. Creating an entry into the published
// catalog IS an add, and catalog-merge.mjs already owns what an add means
// (including its refusal to overwrite an entry the CDN already lists), so create
// runs the entry through it rather than growing a second, subtly different rule
// that could drift.
import { mergeCatalog } from './lib/catalog-merge.mjs';
// The website panel's decisions - what downloads.json means for a person, what a
// porcelain status says, what a wrangler deployment list means - are pure and
// unit-tested in their own module. This file holds the R2 keys and boots a
// server, so none of that can be checked from here.
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

/**
 * Where a file chosen in the browser is written before it is published.
 * Under dist/ so a rebuild clears it; a stale file would be offered as the
 * operator's current choice.
 */
const artStagingDir = path.join(repoRoot, 'dist', 'artwork-staging');
rm(artStagingDir, { recursive: true, force: true }).catch(() => {});

/**
 * Whether the React dashboard app has been built.
 *
 * There is one client and no fallback, so a missing build has nothing to serve.
 * Checked once at startup and reported once rather than per request, so
 * `serveAppDist` stays a pure read of the filesystem and cannot change its answer
 * halfway through a session.
 */
const appBuilt = existsSync(path.join(here, 'dashboard', 'app', 'dist', 'index.html'));

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  // The React build emits these under assets/. Without them the browser refuses
  // to execute a module script or apply a stylesheet, which looks like an app
  // that built fine and then did nothing.
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
 * Read a TTL from the environment, treating an absent or blank value as
 * "unset" and a literal 0 as a real answer.
 *
 * The distinction is the whole point of the override. `DASHBOARD_CACHE_TTL_MS=0`
 * has to mean "cache nothing at all", because that is how a caching bug is told
 * apart from a real one - and it used to mean the opposite: the old test was
 * `Number(x) > 0 ? x : DEFAULT`, so 0 fell through to the default and the one
 * setting that disables the cache silently kept it on. Unparseable or negative
 * input still falls back to the default rather than to a nonsensical TTL.
 */
function ttlFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * How long an ONLINE read may be reused before it is read again, in ms.
 *
 * One hour, because everything this applies to is a round trip to somebody
 * else's infrastructure - a recursive bucket listing, a CDN document, a `git`
 * and a `wrangler` subprocess, a GitHub release list - and none of them change
 * on their own. /api/inventory alone is a full listing plus one HTTP request per
 * game per channel, which is slow enough to be felt; re-running it every time a
 * tab is opened is what made the panel feel like it was constantly refetching.
 *
 * The cost is stated rather than hidden: a change made OUTSIDE this dashboard -
 * a publish run from a terminal - is not visible here for up to an hour. Two
 * things make that acceptable, and both are load-bearing:
 *
 *   1. `?refresh=1` bypasses the cache, and
 *   2. every write this server accepts invalidates the entries it affects, at
 *      the moment it is accepted rather than when its child exits (see
 *      invalidateCache).
 *
 * Staleness is never invisible: the x-cache-age-ms header carries the age, and a
 * stale entry is still served (see cachedRead) rather than blocking.
 *
 * Overridable with DASHBOARD_CACHE_TTL_MS. 0 disables caching entirely.
 */
const CACHE_TTL_ONLINE_MS = ttlFromEnv('DASHBOARD_CACHE_TTL_MS', 60 * 60 * 1000);

/**
 * How long a LOCAL live fact may be reused, in ms.
 *
 * Deliberately short, and the reason is the polling loop rather than the cost of
 * the read: /api/services is a port probe the client re-polls every few
 * seconds, so every one of those polls was a fresh set of socket connects. At 30
 * seconds a status change is at most 30 seconds behind reality - imperceptible
 * for "did my dev server start" - while the poll costs nothing for nine reads in
 * ten. One hour here would be the opposite of an improvement: it would report a
 * server the operator just stopped as running for an hour, which is a worse lie
 * than a slow read.
 *
 * /api/launcher/status is not in this table and stays uncached. It is a live
 * CDN fetch plus a `gh release list`, which is cheap enough to be current, and
 * "which launcher version is out" is the answer an operator must never be shown
 * an old copy of.
 *
 * Overridable with DASHBOARD_CACHE_TTL_LOCAL_MS; 0 disables it, as above.
 */
const CACHE_TTL_LOCAL_MS = ttlFromEnv('DASHBOARD_CACHE_TTL_LOCAL_MS', 30_000);

/**
 * Which read endpoints are cached, and for how long.
 *
 * The registry and the TTL live in ONE table on purpose: an endpoint cannot be
 * added to one without the other, so a future read cannot become cached by
 * accident, and no endpoint can be cached without someone having to choose its
 * TTL. A path that is not listed is not cached at all, which makes the failure
 * mode of adding a route "slower", never "wrong answer".
 *
 * Invalidation names the same paths, so this table is also the list of prefixes
 * invalidateCache is ever asked about.
 */
const CACHE_TTL_BY_PATH = new Map([
  // A full recursive bucket listing plus a fetch per channel: the most expensive
  // read here by a wide margin, and the one an operator reloads most.
  ['/api/inventory', CACHE_TTL_ONLINE_MS],
  ['/api/meta', CACHE_TTL_ONLINE_MS],
  ['/api/art', CACHE_TTL_ONLINE_MS],
  ['/api/news', CACHE_TTL_ONLINE_MS],
  // A CDN fetch plus a file read. Not as expensive as the others, but the tab
  // re-reads it every time it is opened, and it is also the endpoint a metadata
  // publish invalidates - an invalidation with nothing cached behind it would be
  // dead code pretending to be a guarantee.
  ['/api/catalog', CACHE_TTL_ONLINE_MS],
  // A git status, a wrangler subprocess and two CDN fetches with a HEAD per
  // artifact. Slow enough to be felt and re-read every time the tab is opened.
  // Cached for the same reason /api/catalog is: the operator switching tabs
  // should not re-run wrangler.
  ['/api/website', CACHE_TTL_ONLINE_MS],
  // Local and live: a TCP connect per service. Short TTL, because "is it
  // running" is the one answer that goes out of date the moment the answer is
  // true - and because the client polls it.
  ['/api/services', CACHE_TTL_LOCAL_MS],
]);

/**
 * Read-endpoint cache: resolved values, when they were fetched, and the refresh
 * running behind them.
 *
 * Only the paths in CACHE_TTL_BY_PATH are stored, so a read that is not listed
 * there is neither stored nor served from here.
 *
 * A single in-flight promise is stored rather than a resolved value alone, so
 * two tabs opening at once produce one bucket listing instead of two. The
 * resolved value is what gets returned; the promise is what deduplicates.
 */
const readCache = new Map();

/**
 * The cache key for a request: path plus query, minus the cache-control flags.
 *
 * The query is part of the key because these endpoints genuinely differ by it -
 * /api/meta?gameId=misspell&channel=alpha and the same path for another game are
 * different documents, and caching either one under the path alone would show one
 * game's metadata under another's name.
 *
 * `refresh` is stripped because it selects whether the cache is consulted at all;
 * caching under "the version that bypassed the cache" would leave the refresh
 * permanently self-defeating. Any other parameter is left in, deliberately:
 * dropping unknown ones would let two different queries collide on one entry.
 */
function cacheKey(url) {
  const params = new URLSearchParams(url.search);
  params.delete('refresh');
  const query = params.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

/**
 * The TTL a path may reuse a value for, or null when it is not cached at all.
 *
 * The registry, not the call sites, is the single source of truth, so a future
 * endpoint cannot become cached by accident and a cheap local read cannot
 * inherit the one-hour TTL by accident either. The check is `null` rather than
 * "falsy" so that a TTL of 0 - the override that disables caching - is honoured
 * rather than treated as absent.
 */
function cacheTtlFor(url) {
  const ttl = CACHE_TTL_BY_PATH.get(url.pathname);
  return ttl === undefined ? null : ttl;
}

/**
 * Run `produce`, reusing a cached value when there is a fresh one.
 *
 * A stale value is *returned*, not discarded: the panel paints immediately from
 * what it has and the replacement is read behind it. This is what makes an
 * hour-long TTL invisible rather than laggy, and it is what stops the panel
 * from blocking on a full bucket listing every time the hour rolls over. Only a
 * `?refresh=1` or a post-write invalidation forces a real read, and both of
 * those are synchronous with the caller.
 *
 * @returns {{value: *, ageMs: number, stale: boolean, state: 'hit'|'miss'|'stale'}}
 *   `ageMs` is how long ago the returned value was fetched, which the client
 *   renders as "updated 2m ago" via the x-cache-age-ms header.
 */
async function cachedRead(url, produce) {
  const ttl = cacheTtlFor(url);
  // Not in the registry, or the TTL is 0: read it, cache nothing, and report
  // every one of these reads as a miss so nothing downstream can treat the
  // answer as stored.
  if (ttl === null || ttl === 0) {
    return { value: await produce(), ageMs: 0, stale: false, state: 'miss' };
  }

  const key = cacheKey(url);
  const now = Date.now();
  const bypass = url.searchParams.has('refresh');
  const hit = readCache.get(key);

  // A read that has not resolved yet is joined rather than duplicated, whatever
  // its age: two tabs opening at once must produce one bucket listing, not two
  // racing ones. Joining is also the answer for ?refresh=1 arriving mid-read -
  // it is the same query, so a second identical read would only cost time.
  if (hit && hit.refreshing && hit.value === undefined) {
    const value = await hit.promise;
    return { value, ageMs: Date.now() - hit.at, stale: false, state: 'miss' };
  }

  // `bypass` gates the fresh-hit check. `?refresh=1` has to mean "re-read now",
  // so a value that is still well inside its TTL must NOT be returned for it -
  // otherwise the one button that is supposed to prove the cache is not lying
  // would be answered by the cache. The stale branch below is gated on `bypass`
  // for the same reason.
  if (!bypass && hit && hit.value !== undefined && now - hit.at < ttl) {
    return { value: hit.value, ageMs: now - hit.at, stale: false, state: 'hit' };
  }

  // A stale value with nothing in flight: serve it now, start the replacement
  // behind. The response says so (`x-cache: stale`, with the real age) rather
  // than presenting an hour-old read as current.
  if (hit && hit.value !== undefined && !bypass && !hit.refreshing) {
    startRefresh(key, produce);
    return { value: hit.value, ageMs: now - hit.at, stale: true, state: 'stale' };
  }

  const value = await readInto(key, produce, null);
  return { value, ageMs: 0, stale: false, state: 'miss' };
}

/**
 * Read now and wait, storing the entry only once it has resolved.
 *
 * `previous` is the stale entry a background refresh is replacing: it is kept on
 * failure, because serving yesterday's answer while saying so beats dropping to
 * a blocked read on the next request. A cold read has nothing to keep, so a
 * failure deletes the entry - a transient listing error must not be replayed for
 * the rest of the TTL and made to look like the bucket is broken.
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
    // `at` is re-stamped on success: the age a caller is told is the age of the
    // value, not the age of the read that produced it.
    entry.at = Date.now();
    entry.value = value;
    entry.refreshing = false;
    return value;
  } catch (err) {
    if (previous) {
      // Hand the stale value back and let the next request try again.
      readCache.set(key, previous);
    } else {
      readCache.delete(key);
    }
    throw err;
  }
}

/**
 * Replace an expired entry behind the caller, never blocking it.
 *
 * Fire-and-forget by design: the request that triggered it has already been
 * answered with the stale value, and the process cannot do anything useful with
 * a failure here other than keep the stale value. A rejection is swallowed on
 * purpose for that reason - an unhandled rejection would take the server down.
 */
function startRefresh(key, produce) {
  const previous = readCache.get(key);
  readInto(key, produce, previous).catch(() => {});
}

/**
 * Drop cached entries so the next read goes to the source.
 *
 * Called when a write is *accepted*, not when its child process exits. The
 * publish runs for seconds, so invalidating on exit would let a read taken during
 * the publish be cached for the whole TTL afterwards - exactly the stale-panel
 * complaint this cache was added to fix, and with an hour-long TTL that complaint
 * would last an hour. Invalidating early is the safe direction: the worst case is
 * one extra bucket read.
 *
 * `prefix` narrows it to the endpoints a given write affects (a metadata publish
 * touches neither the news feed nor the bucket listing); with no prefix every
 * cached read is dropped. The prefix is matched as a path, with or without its
 * own query, so one call covers every game/channel variant behind it - which
 * matters most for /api/meta, where each game+channel is a separate entry.
 *
 * What is deliberately NOT done: forgetting an endpoint here. Over-invalidation
 * costs one read; under-invalidation at a one-hour TTL costs an hour of a panel
 * that disagrees with the bucket. So a write that changes a shared document
 * drops every read that consumes it.
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

/** The response headers a cached read carries, so the client can show its age. */
function cacheHeaders(state, ageMs) {
  return {
    // no-store on the browser side is not optional: a browser cache would answer
    // the next request from its own store, and the "updated Ns ago" label and the
    // manual Refresh would both silently stop reflecting the server's cache.
    'cache-control': 'no-store',
    'x-cache': state,
    'x-cache-age-ms': String(Math.max(0, Math.round(ageMs))),
  };
}

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

/**
 * When this dashboard last ran the launcher publish, or null.
 *
 * Publish-launcher.mjs rewrites launcher/downloads.json, and the site renders
 * that document live - it does not need redeploying for a new version to appear.
 * So the useful question after a publish is not "was the site deployed?" but
 * "how long ago did the site's data change?", and this timestamp is what answers
 * it without the operator having to remember whether they clicked it here or ran
 * it in a terminal.
 *
 * In-memory on purpose: it records what THIS dashboard did, and a dashboard that
 * has been restarted did nothing. Persisting it would claim a publish happened
 * in this session that did not.
 */
let lastLauncherPublishAt = null;

/**
 * The git facts about the site repo, read with spawnSync.
 *
 * Read-only commands only, and `-C <siteRoot>` rather than a cwd change, so
 * nothing here can touch another repository's index or working tree. `dirty` is
 * what decides whether a deploy warns, so an untracked file counts: it is still a
 * file in the tree the deploy runs against.
 *
 * Every command is allowed to fail. `git` may not be installed, a fresh clone may
 * have no commits, and none of that is an error worth refusing the panel over -
 * the status is reported as unknown facts and the deploy still works.
 */
function readSiteGit() {
  const run = (args) =>
    spawnSync('git', ['-C', siteRoot, ...args], {
      encoding: 'utf-8',
      shell: false,
      // A repo with a large index can take a moment; the default is infinite and
      // a hung git would hang the status poll with it.
      timeout: 10_000,
    });

  const text = (out) => (out && out.status === 0 ? String(out.stdout ?? '') : '');

  const status = run(['status', '--porcelain']);
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = run(['rev-parse', '--short', 'HEAD']);
  const subject = run(['log', '-1', '--pretty=%s']);
  // `git remote get-url origin` rather than `git remote`: the latter prints one
  // line per remote per direction, and parseGitRemote takes the first, which is
  // alphabetical rather than the one a deploy would push to. Falls back to the
  // full list for a repo whose remote has no name "origin".
  const origin = run(['remote', 'get-url', 'origin']);
  const remotes = run(['remote', '-v']);
  // Absent upstream is normal - a fresh clone of a tag, or a branch nobody pushed
  // - so a non-zero exit here means "unknown", not "behind".
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
 * The live Pages deployment list, or why it could not be read.
 *
 * `available: false` is a first-class answer, not an error: wrangler is a
 * devDependency of the site repo and this endpoint must work on a machine where
 * it is not installed or not authenticated. The rest of the panel is about the
 * bucket and the checkout, and none of it depends on Cloudflare answering.
 *
 * wrangler is run through the site's own node_modules/.bin rather than a global
 * `wrangler`, because the site repo installs it locally on purpose - the README
 * is explicit that nothing is installed globally. A global lookup would report
 * the CLI as missing on a machine where the deploy would work.
 *
 * `--json` suppresses wrangler's banner; a warning printed in front of the array
 * is still recovered by parsePagesDeployments, which is why this cannot quietly
 * report "unavailable" for a call that succeeded.
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
      // This one talks to the Cloudflare API and can authenticate. A hung request
      // must not hold the status poll open, so it is bounded like the git calls.
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
    // wrangler's own stderr is the actionable part ("not logged in"); a bare exit
    // code would tell the operator nothing about which of its many failures this
    // is. First line only, and never its stdout, which for a failed call can hold
    // a whole error payload.
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
 * Whether a download URL resolves, and how big it is.
 *
 * A HEAD rather than a GET: the whole point is to answer "would this button
 * work", and downloading a 200 MB installer to find out is not a check. R2 sends
 * content-length on HEAD, so the size comes back free.
 *
 * A failed check is reported per artifact rather than thrown, because one missing
 * .dmg is exactly the state this panel exists to surface - and it is a fact about
 * the site, not a failure of the endpoint.
 */
async function headArtifact(url) {
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
    const length = Number(response.headers.get('content-length'));
    return {
      ok: response.ok,
      status: response.status,
      // Null rather than 0: "the header was absent" and "the file is empty" are
      // different facts, and only the second is a broken download.
      size: Number.isFinite(length) && length > 0 ? length : null,
    };
  } catch (err) {
    return { ok: false, status: null, size: null, error: String(err?.message ?? err) };
  }
}

/**
 * The website panel's one number that matters: what the page is showing.
 *
 * downloads.json is fetched straight off the CDN rather than out of the site
 * repo, because the site reads it from there and this is what players get - the
 * site checkout has no copy of it at all. Fetched with no-store because it is a
 * mutable index: a cached response here would have the panel reporting a version
 * that is no longer the one a visitor is offered.
 *
 * Returned as `{error}` rather than thrown for the same reason the rest of this
 * panel degrades instead of failing: the repo facts and the deployment history
 * are still worth showing when the bucket cannot be reached.
 */
async function readLiveDownloads() {
  const url = `${cdnOrigin}/launcher/downloads.json`;
  let response;
  try {
    response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
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
  // Only the preferred artifact is checked. A HEAD per artifact is a request per
  // file a person could click, and the preferred one is the one almost every
  // click lands on - the alternatives are visible with their names and the site's
  // own verify walks every URL anyway.
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
 * Everything the Website panel shows.
 *
 * Status only: no side effects, and nothing here writes to the site repo or runs
 * a git write command. That repo is a separate project, so the dashboard's job is
 * to report it, not to manage it.
 *
 * The three sources answer three different questions and are deliberately not
 * collapsed into one "is the site up to date" flag:
 *
 *   - the checkout      what would be deployed (and is it dirty);
 *   - the deployments   what IS deployed, by commit;
 *   - downloads.json    what the live page actually shows, right now.
 *
 * Publishing a launcher version moves only the third, because the site reads the
 * bucket through a Pages Function rather than embedding the data. So a site whose
 * deployment is old can still be showing today's version, and the panel reports
 * the deployment age without ever implying the page is stale.
 */
async function websiteStatus() {
  const present = existsSync(siteRoot);
  if (!present) {
    // Not an error, and the other fields are omitted rather than nulled: a repo
    // that is not there has no git, no deployments and nothing to deploy, and
    // a row of nulls reads like a broken panel rather than a missing folder.
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
    // Everything the panel needs to explain what it is looking at, so the client
    // does not have to hard-code a project name or infer one from the folder.
    project: SITE_PROJECT_NAME,
    platforms: SITE_PLATFORMS.map((id) => ({ id, name: SITE_PLATFORM_NAMES[id] ?? id })),
  };
}

/**
 * Refuse a site-repo action when the checkout is not there, answering the
 * request itself.
 *
 * Returns true when it answered, so the caller is `if (missing) return;`. A
 * missing sibling repository is an ordinary state on a machine that has never
 * cloned it, and it must read as "here is where I looked" rather than as a stack
 * trace - otherwise the first thing the panel ever says about the website is an
 * unhandled ENOENT.
 *
 * The same message the status panel reports, from the same tested module, so the
 * two can never disagree about what is missing or where.
 */
function siteAbsentResponse(res) {
  if (existsSync(siteRoot)) return false;
  res.writeHead(409, { 'content-type': 'text/plain' }).end(siteMissingMessage(siteRoot));
  return true;
}

/**
 * Run an npm script in the site repo, streaming it like every other verb.
 *
 * runScript is not reused here even though the SSE contract is identical: it
 * spawns `node <this repo>/<script>` in THIS repo's root, and the site is a
 * separate repository with its own package.json, node_modules and .env. The
 * stream shape is what the client depends on, so it is reproduced exactly -
 * output, error, done({code}) - and nothing else changes.
 *
 * `cmd.exe` rather than a direct `npm` spawn, for the reason start() documents
 * and because it is now also the only thing that works: spawning a `.cmd` with
 * shell:false raises EINVAL on current Node (the fix for the CVE-2024-27998
 * argument-injection class of bug), which took the whole dashboard down the
 * first time this was exercised. Going through the shell resolves npm through
 * PATHEXT, and `npm run <script>` is a fixed string built here - the script name
 * comes from the route, never from the request body, so there is nothing in it
 * for a payload to inject.
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

/**
 * The live news feed, or an empty one when absent. A missing feed is normal on a
 * fresh bucket; an unparseable one is reported, because writing over it would
 * destroy whatever it said.
 */
async function readNewsFeed(cdnOrigin) {
  const res = await fetch(`${cdnOrigin}/launcher/news.json`, { cache: 'no-store' });
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
 * The published catalog, or null with the reason it could not be read.
 *
 * Returns a status instead of throwing, because the caller has to show both
 * copies whether or not either of them exists: "there is no published catalog"
 * and "the published catalog is broken" are very different things for an
 * operator, and collapsing them into one error is how a hand-fixed document gets
 * overwritten by a script that thought there was nothing there.
 *
 * Fetched with no-store for the same reason publish-catalog.mjs reads it that
 * way: this is a mutable index, and a cached response would have the tab showing
 * yesterday's games as the live one.
 *
 * @returns {{catalog: object|null, status: string, detail: string|null}}
 *   status is 'ok' | 'absent' | 'unreadable' | 'invalid'.
 */
async function readLiveCatalog() {
  let response;
  try {
    response = await fetch(CATALOG_URL, { cache: 'no-store' });
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
    // Reported rather than repaired. This is the document every launcher reads;
    // silently treating it as absent would invite a create or delete to write a
    // new one over whatever it actually says.
    return { catalog: null, status: 'invalid', detail: `not valid JSON: ${err.message}` };
  }

  if (!Array.isArray(catalog?.games)) {
    return { catalog: null, status: 'invalid', detail: 'it has no games array' };
  }

  return { catalog, status: 'ok', detail: null };
}

/**
 * public/catalog.json, or null with the reason it could not be read.
 *
 * A missing file is normal on a fresh checkout, and an unparseable one is a real
 * problem worth naming: publish-catalog.mjs refuses to run against it.
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
 * Upload a catalog document to the bucket the way publish-catalog.mjs does.
 *
 * Same `upload(..., NO_CACHE, application/json)` call, not a reimplementation:
 * the cache-control header is the difference between a publish that players see
 * on their next launch and one they do not, and it is exactly the detail a
 * hand-rolled uploader would get wrong.
 *
 * `upload()` shells out to `aws s3 cp`, which reads a file, so the document has
 * to land on disk first. It goes in dist/ beside the publisher's own staging
 * file, and it is removed afterwards: a leftover copy could be picked up by a
 * later build, or read by hand as though it were published.
 *
 * @returns {Promise<void>} throws with the CLI's message when the upload fails
 */
async function uploadCatalog(catalog) {
  const staging = path.join(repoRoot, 'dist');
  const mergedPath = path.join(staging, 'catalog-dashboard.json');
  await mkdir(staging, { recursive: true });
  try {
    writeFileSync(mergedPath, `${JSON.stringify(catalog, null, 2)}\n`);
    upload(mergedPath, S3.s3Uri(bucket, 'launcher/catalog.json'), {
      endpoint,
      // Mutable index: clients must not keep reading the document that was just
      // replaced, so this matches publish-catalog.mjs exactly.
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
 * Where the React dashboard app builds to.
 *
 * Outside the repo-root dist/ on purpose: the launcher bundles dist/, and this
 * server holds R2 credentials. The build config (scripts/dashboard/app/vite.config.ts)
 * says the same thing, and src-tauri/tests/bundle_contents_tests.rs enforces it.
 */
const appDistDir = path.join(assetDir, 'app', 'dist');

/**
 * Serve a file from the React build, or the app shell for a client-side route.
 *
 * `no-store` on everything, including the hashed asset filenames: this is a local
 * tool built in place, and a cached index.html pointing at assets that no longer
 * exist is a blank page after every rebuild. Once the app is stable the hashed
 * names are immutable and could be cached, but that is a later decision.
 *
 * @param pathname a request path, always starting with '/'
 * @returns {Promise<boolean>} true when the response was written here
 */
async function serveAppDist(res, pathname) {
  // Only inside app/dist: without this a request for `/../../.env` would resolve
  // outside it, and this process's whole reason to exist is the credentials it
  // holds. Normalising and then re-checking that the result is still inside the
  // directory closes the traversal as well as the obvious form of it.
  // A malformed percent-escape (GET /%) makes decodeURIComponent throw, and this
  // async handler has no outer catch, so answer it as "not a static file".
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
    // app shell is served for any path that did not resolve to one.
    //
    // Two kinds of path must NOT get the shell, and each would otherwise fail in a
    // way that looks like a different problem entirely:
    //
    //   - `/api/...`. A missing endpoint answered with a 200 of HTML looks like a
    //     server bug at the fetch call, not a typo in the path.
    //   - the app's own index.html, which resolved or there would be no build.
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
 * Upload a catalog document, streaming the outcome the way the other verbs do.
 *
 * Same three SSE events as runScript (output/error/done) so the client's stream
 * handling covers this without a special case - a create or delete that returned
 * a bare JSON body would render as a publish that silently did nothing.
 *
 * The success payload is returned so the caller can add what it knows (the entry
 * created, the id removed); null means the response is already written and the
 * caller must stop.
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
    // Reported rather than thrown: the response is already half-written.
    // `code` is required - the client derives the verdict from it, so a failure
    // frame without one parses as exit 0 and renders as success.
    send('output', `${String(err)}\n`);
    send('done', JSON.stringify({ ok: false, code: 1, error: String(err) }));
    res.end();
    return null;
  }
}

/**
 * Parse a JSON request body, answering the request itself on malformed input.
 * `maxBytes` bounds it; chunks past the cap are drained but not stored, so the
 * browser sees the 413 rather than a connection reset.
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
    req.on('end', () => resolve(refused ? null : body));
  });

  if (raw === null) {
    res.writeHead(413).end(`body too large; the limit is ${maxBytes} bytes`);
    return null;
  }

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
 *
 * `onExit` is an optional callback fired once, after the `done` event is written,
 * with the child's exit code. It exists because some facts are only knowable when
 * a child exits - whether the launcher's publish actually replaced the bucket
 * documents the website renders - and reaching that from the route handler means
 * knowing when the stream finished. It is a hook and nothing else: the three SSE
 * events, their order and their payload shape are unchanged, so a caller that
 * passes nothing behaves exactly as before.
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

  child.stdout.on('data', (chunk) => send('output', String(chunk)));
  child.stderr.on('data', (chunk) => send('output', String(chunk)));
  child.on('error', (err) => send('error', String(err)));
  child.on('close', (code) => {
    send('done', JSON.stringify({ code }));
    res.end();
    // After the stream is closed, so a hook that does work cannot interleave
    // output into a response that has already ended. Its own failure is swallowed:
    // bookkeeping must never change what the client saw.
    try {
      onExit?.(code);
    } catch {
      // Nothing to do - the publish already happened either way.
    }
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
// Dev services the dashboard can launch.
//
// Each one opens its own console window by running a .bat file, rather than
// being spawned with its output piped into this process. That is deliberate:
// `npm run tauri:dev` prints a lot, and piping it here meant the useful output
// stopped at a 1500-character tail in the dashboard while the user had to find a
// log file to read the rest. Running the .bat means the window the user already
// knows how to read is the window the output appears in, and the dashboard only
// has to say whether it came up.
const SERVICES = [
  {
    id: 'launcher',
    name: 'Launcher',
    note: 'Tauri app with hot reload, in its own window. First build takes minutes.',
    // Opened rather than spawned: see the note above.
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
    // The site lives in a sibling repository, so the .bat is only runnable when
    // that checkout is present.
    requires: siteRoot,
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
    'try { $p = Get-Process -Id ' +
    pid +
    ' -ErrorAction Stop; ' +
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
    // `pid` is null for a service that was opened in its own window rather than
    // spawned: there is no process of ours to remember, so it is left out instead
    // of persisting a null that would read as "unknown pid" on the next launch.
    [...started.values()]
      .filter((e) => e.pid)
      .map((e) => ({ pid: e.pid, startedAt: e.startedAt, id: e.service.id }))
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

  // A service backed by a .bat is *opened*, not spawned: `start` gives it its own
  // console window that outlives this dashboard and can be read directly. Its
  // output is not captured here at all, because the whole point is that the user
  // reads it in that window rather than in a truncated panel.
  if (service.bat) {
    const child = spawn(comspec, ['/d', '/s', '/c', 'start', '""', service.bat], {
      cwd: service.cwd,
      env: buildEnv(),
      shell: false,
      // `start` returns as soon as the window opens, so there is nothing to wait
      // on and nothing that would keep this process alive.
      stdio: 'ignore',
      detached: true,
    });
    child.unref();
    started.set(service.id, {
      pid: null,
      at: Date.now(),
      startedAt: null,
      tail: [],
      service,
      // Not tracked by pid: the console window belongs to cmd, and killing that
      // would close the user's terminal rather than the dev server. Presence is
      // tracked by the port instead, which is what the user actually cares about.
      opened: true,
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

  // A service opened in its own console window has no process of ours to kill,
  // and killing the window would close the user's terminal rather than the dev
  // server. The window is theirs to close; the button only stops offering to
  // reopen one.
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
        // explain itself in the page instead of only in the console. Always null
        // for a `bat` service: its output is in its own window, not here.
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

  if (url.pathname === '/api/inventory' && req.method === 'GET') {
    try {
      // Cached because this is the most expensive read in the panel: a recursive
      // bucket listing plus one CDN request per game per channel. Without it,
      // switching tabs re-runs the whole thing.
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
  // Start, stop and inspect the local dev servers. They live here rather than
  // on a page of their own so there is one place to look, and so the same
  // loopback-only, rebinding-guarded server owns them.

  if (url.pathname === '/api/services' && req.method === 'GET') {
    try {
      // Cached, briefly, and this is the one endpoint where "briefly" is the
      // whole design: the client polls it every few seconds, so an uncached
      // answer meant a fresh set of socket connects on every poll - the source
      // of the constant refetching this panel was asked to stop. Thirty seconds
      // caps how long a stopped dev server can still read as running, and every
      // read inside that window costs nothing.
      //
      // start/stop/force-stop drop it immediately, so the button the operator
      // just pressed is never answered with the state from before it.
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
    // poll that follows it would otherwise be answered from the pre-start state
    // for the whole local TTL - showing "not running" for a server that is up.
    invalidateCache('/api/services');
    return;
  }

  if (url.pathname === '/api/service/stop' && req.method === 'POST') {
    const result = stop(url.searchParams.get('id'));
    res.writeHead(result.ok ? 200 : 409, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    // Same reason as start, in the other direction: this is the one that must not
    // wait, because the answer that goes stale is "still running".
    invalidateCache('/api/services');
    return;
  }

  if (url.pathname === '/api/service/force-stop' && req.method === 'POST') {
    const result = forceStop(url.searchParams.get('id'));
    res.writeHead(result.ok ? 200 : 409, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result));
    // forceStop kills the listener directly, so nothing about `started` changes
    // - the port probe is the only thing that will report the difference.
    invalidateCache('/api/services');
    return;
  }

  if (url.pathname === '/api/publish' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (!payload) return;

    // A build publish changes what the inventory lists, so its cached read is
    // dropped now, while the request is accepted. Invalidating on the child's exit
    // instead would leave a read taken mid-publish cached for the rest of the TTL.
    invalidateCache('/api/inventory');
    // It also rewrites games/<id>/<channel>/manifest.json and latest.json, which
    // readGameMetadata fetches directly, so every metadata read for that game is
    // stale from the moment the request is accepted - not just for an hour after.
    invalidateCache('/api/meta');
    // And artwork can ship with a build (--icon-url/--banner-url plus a staged
    // file), landing in the same per-game prefix the artwork picker lists.
    invalidateCache('/api/art');

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

    // Pruning removes build directories, so the listing the inventory is built
    // from is now wrong. Dropped even for a dry run: a dry run proves nothing was
    // removed, and one extra bucket read is cheaper than a panel that lies.
    invalidateCache('/api/inventory');

    runScript('prune-builds.mjs', argv, res);
    return;
  }

  // --- Catalog ------------------------------------------------------------
  //
  // The tab used to have nothing to show: there was a publish verb and no read
  // verb at all, so the only thing an operator could do was push the local file
  // and hope. The GET below returns both copies so the difference is visible
  // before it is acted on.

  if (url.pathname === '/api/catalog' && req.method === 'GET') {
    try {
      const read = await cachedRead(url, async () => {
        const [live, local] = await Promise.all([readLiveCatalog(), readLocalCatalog()]);

        // Both copies travel whole, not just the diff: the table renders the
        // fields themselves, and a diff of field names cannot tell the operator
        // what a name actually is.
        return {
          live: live.catalog,
          local: local.catalog,
          // Which side is real matters more than the diff does. A diff computed
          // against an absent document would report every game as `onlyLive` or
          // `onlyLocal`, which reads as "the two copies disagree" when in fact one
          // of them could not be read at all.
          liveStatus: live.status,
          liveDetail: live.detail,
          localStatus: local.status,
          localDetail: local.detail,
          localPath: local.path,
          diff: catalogDiff(live.catalog, local.catalog),
          inSync: catalogDiffIsEmpty(catalogDiff(live.catalog, local.catalog)),
          // The field list, so the client cannot offer a column the document
          // never carries. The publisher is the only writer, so this is its shape.
          fields: CATALOG_GAME_FIELDS,
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
    if (!payload) return;

    // What the entry is, is decided by the tested module; the id is validated the
    // same way as everywhere else, because it becomes a bucket path segment.
    const built = catalogEntryFrom(payload);
    if (!built.ok) {
      res.writeHead(400).end(built.error);
      return;
    }

    const live = await readLiveCatalog();
    if (live.status !== 'ok') {
      // Refused rather than creating a document from scratch. Writing a new
      // catalog because the CDN was unreachable would drop every game the local
      // file happens not to mention from every launcher - the same outage
      // publish-catalog.mjs refuses to cause. The messages name the status so the
      // operator knows whether to retry or to go fix the document.
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

    // The add goes through the publisher's own merge rule rather than an
    // array push. For a genuinely new id the two agree; for anything else the
    // merge is the authority, and running it here means the dashboard cannot
    // produce a document the publisher would have refused to write.
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

    // Both the create and delete paths have already validated this document -
    // delete via the publisher's own validateCatalog, create because the entry
    // passed catalogEntryFrom - so there is nothing left to check here.
    const created = await catalogWrite(res, catalog);
    if (!created) return;
    invalidateCache('/api/catalog');
    // The metadata read fetches launcher/catalog.json too (readGameMetadata
    // resolves catalog-over-manifest), so a create makes every game's metadata
    // read stale - not just the panel that shows the catalog itself. Invisible
    // at 45 seconds, an hour of wrong form values at this TTL.
    invalidateCache('/api/meta');
    created.entry = built.entry;
    return;
  }

  if (url.pathname === '/api/catalog/delete' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (!payload) return;

    // Delete removes a game from every launcher on its next refresh and there is
    // no undo, so it is refused without an explicit confirmation. The message says
    // what will happen rather than just refusing, because "400" alone leaves the
    // operator guessing which of their two payloads was wrong.
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

    // The rules - not published, not the last entry, still valid afterwards -
    // live in the tested module, and reuse validateCatalog so this cannot produce
    // a document publish-catalog.mjs would refuse to write.
    const removed = removeCatalogEntry(live.catalog, payload.id);
    if (!removed.ok) {
      res.writeHead(400).end(removed.error);
      return;
    }

    const deleted = await catalogWrite(res, removed.catalog);
    if (!deleted) return;
    invalidateCache('/api/catalog');
    // Same reason as create: the deleted game's metadata read resolves its
    // catalog entry, so that entry is now absent and a cached read would fill
    // the form from a document that no longer exists.
    invalidateCache('/api/meta');
    deleted.removed = removed.removed;
    deleted.remaining = removed.remaining;
    return;
  }

  if (url.pathname === '/api/catalog' && req.method === 'POST') {
    // publish-catalog.mjs merges additively and supports --dry-run, so this verb
    // gets the same real preview every other verb has. Without forwarding it the
    // UI's "preview only" checkbox could not be honoured and the button wrote to
    // the CDN while promising a preview.
    const payload = await readJson(req, res);
    if (!payload) return;
    // Drop the cached read now rather than when it exits: a read taken during the
    // publish would otherwise be served for the rest of the TTL, which is exactly
    // the stale-panel complaint the cache was added to fix.
    invalidateCache('/api/catalog');
    invalidateCache('/api/inventory');
    // The same script also re-uploads public/news.json to launcher/news.json
    // (publish-catalog.mjs, unless SKIP_NEWS is set), so the news panel's read is
    // stale too - and with a one-hour TTL it was an hour of an announcement list
    // that no longer matched the bucket. /api/meta is not touched: a catalog
    // publish moves no manifest.
    invalidateCache('/api/news');
    runScript('publish-catalog.mjs', payload.dryRun ? ['--dry-run'] : [], res);
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
      // Cached per game+channel: the query is part of the key, so one game's
      // metadata is never served under another's name.
      const read = await cachedRead(url, () =>
        readGameMetadata(gameId, channel, { cdnOrigin, fields: FIELDS })
      );
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

    // A metadata publish rewrites the catalog entry on the CDN, so the metadata
    // read, the catalog read and the artwork listing are all stale the moment this
    // is accepted. Dropped even on a dry run: it changes nothing, and one extra
    // read is cheaper than a form that shows pre-edit values.
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
      // A bucket listing, and the form re-reads it after every upload - so this
      // is exactly the read that made the artwork picker feel slow.
      const read = await cachedRead(url, async () => {
        const keys = await listKeysWithMeta(S3.s3Uri(bucket, prefix), { endpoint });
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
    if (!payload) return;

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

  // --- News ---------------------------------------------------------------
  //
  // One flat document rather than two drifting copies, so this is simpler than game
  // metadata. Served from the CDN, not the working tree: public/news.json is the
  // bundled offline fallback and the publisher keeps the two in step, so reading it
  // as the source of truth would mean editing a file about to be overwritten.

  if (url.pathname === '/api/news' && req.method === 'GET') {
    try {
      const read = await cachedRead(url, async () => {
        const feed = await readNewsFeed(cdnOrigin);
        // Normalised into the contract's field names here, not in the browser, so the form
        // renders one shape whatever the document holds.
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
          // The browser cannot import the contract (no bundler), so the field list travels
          // with the response rather than being hand-typed into app.js.
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
    if (!payload) return;

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
      // A chosen id from the browser could collide with a published item and merge two
      // announcements, so an absent one is derived here from the live feed.
      let id = String(payload.id ?? '').trim();
      const values = {};
      for (const field of NEWS_FIELDS) {
        if (payload[field.flag] !== undefined) values[field.flag] = payload[field.flag];
      }
      if (!id) {
        const feed = await readNewsFeed(cdnOrigin);
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
      // parseArgs skips it silently, so the publisher sees no operation and reports
      // "say what to do" instead of the edit that was requested.
      if (one.op === 'move') argv.push('--move', one.id, one.delta === -1 ? '--up' : '--down');
      else if (one.op === 'delete') argv.push('--delete', one.id);
      // Create carries its id as a separate --id flag rather than as the value of
      // --create. Written bare, --create has no positional value to fall back on:
      // parseArgs would read the following flag as a boolean, and the id - including
      // the one this server just derived from the title - would be lost.
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
        const localPath = path.resolve(payload.imageFile.trim());
        if (!existsSync(localPath)) {
          res.writeHead(400).end(`No such file: ${payload.imageFile}`);
          return;
        }
        argv.push('--image-file', localPath);
      }
    }

    // A news publish rewrites the feed the panel reads, and a news image lands in
    // the same artwork listing the picker uses. Dropped even on a dry run: it
    // changed nothing, and one extra read is cheaper than a stale list.
    invalidateCache('/api/news');
    invalidateCache('/api/art');

    runScript('publish-news.mjs', argv, res);
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

    // The launcher manifests land under launcher/, which the inventory reads for
    // drift, and downloads.json is what the website panel renders. Both are stale
    // from this moment - not when the child exits - so invalidating on exit would
    // leave a read taken mid-publish served for the rest of the TTL.
    invalidateCache('/api/inventory');
    invalidateCache('/api/website');

    // Noted on the child's exit, and only for a real run, because a dry run
    // rewrites nothing and a timestamp would claim the site's data moved. The
    // response body is untouched: this rides on an exit callback rather than by
    // adding a field the client does not expect.
    runScript('publish-launcher.mjs', argv, res, {
      onExit: (code) => {
        if (code === 0 && !payload.dryRun) lastLauncherPublishAt = Date.now();
      },
    });
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

    // A release bumps the version a later publish ships, so the inventory's
    // picture of the launcher is about to move.
    invalidateCache('/api/inventory');

    runScript('release.mjs', argv, res);
    return;
  }

  // --- Website -------------------------------------------------------------
  //
  // The public download page is a SEPARATE repository, so this panel reports on
  // it rather than managing it. It is here because the page's data comes from
  // THIS repo's bucket: publish-launcher.mjs writes launcher/downloads.json and
  // the site reads it through a Cloudflare Pages Function. So a launcher publish
  // changes what the site shows without the site being deployed, and the panel
  // has to be able to say both things without implying either one is stale.

  if (url.pathname === '/api/website' && req.method === 'GET') {
    try {
      // Cached like the other reads: this shells out to git and to wrangler and
      // then makes a request per artifact. ?refresh=1 bypasses it, and a deploy
      // drops it below.
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

    // The site repo's own `npm run verify`, not a reimplementation. It prints
    // exactly what the page will render using the LIVE downloads.json and exits
    // non-zero on a problem, which is the single most valuable check available
    // here: it catches "published a launcher build whose .msi never landed on the
    // bucket" before a player clicks it.
    //
    // It makes real network requests to R2 (one GET for the index plus a HEAD per
    // artifact). That is the point rather than a side effect - the check is only
    // worth anything against the bucket as it actually is right now.
    invalidateCache('/api/website');
    runSiteScript('verify', [], res);
    return;
  }

  if (url.pathname === '/api/website/deploy' && req.method === 'POST') {
    const payload = await readJson(req, res);
    if (!payload) return;

    const missing = siteAbsentResponse(res);
    if (missing) return;

    // This publishes to the LIVE public site - `npm run deploy` is
    // "npm run build && wrangler pages deploy dist", which replaces what every
    // visitor sees. There is no dry run and no undo, so it is refused unless the
    // request says so explicitly. Strictly `=== true`: a truthy string from a
    // form would otherwise sail through a check meant to be deliberate.
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

    // Warn about a dirty tree rather than blocking on it, and say what is
    // uncommitted: a deploy that silently ships a half-finished edit is the
    // failure this exists to prevent, but the operator may well have intended
    // exactly those changes - refusing would be the dashboard overruling them
    // about their own repository.
    const git = readSiteGit();
    if (git.dirty) {
      const detail = `${git.changedFiles} uncommitted change(s) in the site repo`;
      const ahead = git.ahead === null ? null : `${git.ahead} commit(s) not pushed`;
      process.stdout.write(
        `[website] deploying with ${detail}${ahead ? `, ${ahead}` : ''} - the deploy ships the working tree, not the remote.\n`
      );
    }

    // `npm run deploy` runs build then `wrangler pages deploy dist`. Nothing is
    // written to the site repo by the dashboard itself; wrangler only reads the
    // checkout and uploads dist.
    invalidateCache('/api/website');
    runSiteScript('deploy', [], res);
    return;
  }

  // --- Static files -------------------------------------------------------
  //
  // The React build's own files, and its app shell for any path that is not a
  // file - so `/` and a deep client-side link like /games/catalog both load.
  if (await serveAppDist(res, url.pathname)) return;

  // An unknown /api/ path is a bug in the caller, not a client-side route, and
  // answering it with the app shell would turn "this endpoint does not exist"
  // into a 200 of HTML that a JSON parser reports as an unexplained syntax
  // error. Explicitly not falling through.
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
  // Once, at startup. A missing build is now the only thing that can serve
  // nothing, so it is stated plainly rather than buried per request in scrollback.
  console.log(
    appBuilt
      ? 'UI: React build (scripts/dashboard/app/dist)'
      : 'UI: NOT BUILT - run `npm run dashboard:build`'
  );
  // Both TTLs are printed, and their values are what an operator needs when a
  // panel looks stale: "which cache was this, and how old can it get". The
  // effective value is the default unless the environment overrides it, so the
  // override itself is echoed rather than guessed at.
  console.log(
    `Read cache TTL: ${CACHE_TTL_ONLINE_MS}ms online (DASHBOARD_CACHE_TTL_MS), ` +
      `${CACHE_TTL_LOCAL_MS}ms local (DASHBOARD_CACHE_TTL_LOCAL_MS)`
  );
});
