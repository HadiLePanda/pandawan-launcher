/**
 * An on-disk cache for the CDN documents the launcher reads.
 *
 * Versioned manifests are immutable by publication - the bytes at that URL never
 * change - so their entry never expires. The mutable documents (catalog,
 * latest.json, channel-root manifest) are reused for up to an hour. Without this
 * every launch refetched every manifest, and a failed read emptied the library
 * even though the last good copy was already on disk.
 */

import { readTextFile, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';

import { logger } from './logger';

const CACHE_FILE = 'http-cache.json';
const MAX_AGE_MS = 60 * 60 * 1000;
/**
 * Versioned manifest entries never expire, and a client accumulates one per
 * version it has seen. The cap bounds the file; age is deliberately not a prune
 * criterion, because an expired entry is still what a failed read is served from.
 */
export const MAX_CACHE_ENTRIES = 500;

interface Entry {
  fetchedAt: number;
  body: string;
}

type Store = Record<string, Entry>;

/**
 * Keep the newest entries, up to `limit`. Returns the store unchanged when it is
 * already inside the cap, so the common path does not rewrite it.
 */
export function pruneCache(store: Store, limit = MAX_CACHE_ENTRIES): Store {
  const entries = Object.entries(store);
  if (entries.length <= limit) return store;
  entries.sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
  return Object.fromEntries(entries.slice(0, limit));
}

/** `stale` means the network read failed and the stored copy was served instead. */
type ReadSource = 'network' | 'cache' | 'stale';

const lastSource = new Map<string, ReadSource>();

/**
 * Version-stamped, so it cannot change: `/games/<id>/<channel>/<version>/...`. A
 * `#signed` suffix is ignored: the document and its signature are one cache entry.
 */
export function isImmutable(url: string): boolean {
  const after = url.split('/games/')[1]?.split('#')[0];
  return after !== undefined && after.split('/').length >= 4;
}

/** Whether the most recent read of `url` came off the network or the cache. */
export function lastReadSource(url: string): ReadSource | null {
  return lastSource.get(url) ?? null;
}

// Read per call rather than memoised. A handful of documents per launch does not
// justify module state, and module state here leaks between tests that mock the
// fetch: a save whose disk write fails still cached in memory.
async function load(): Promise<Store> {
  try {
    const raw = await readTextFile(CACHE_FILE, { baseDir: BaseDirectory.AppLog });
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    // No cache yet, or unreadable. Starting empty is the correct answer.
    return {};
  }
}

// Serializes writes so two concurrent refreshes cannot each write a snapshot
// taken before the other's entry landed, and the second write silently dropped
// the first one's document from the file. The mutation runs against a read taken
// inside the queue, not against the map the caller captured, because that map is
// a snapshot from before any other refresh finished.
let writeChain: Promise<void> = Promise.resolve();

function commit(mutate: (current: Store) => Store): Promise<void> {
  const run = writeChain.then(async () => {
    try {
      // Pruned on every write, so the file is bounded by the next commit after
      // it grows past the cap rather than by a maintenance pass nobody runs.
      const merged = pruneCache(mutate(await load()));
      await writeTextFile(CACHE_FILE, JSON.stringify(merged), { baseDir: BaseDirectory.AppLog });
    } catch (err) {
      // The cache is an optimisation: losing it costs a refetch, never correctness.
      logger.warn('Could not persist the HTTP cache', { error: String(err) });
    }
  });
  // Keep the chain alive after a rejection so one failed write does not wedge
  // every write queued behind it.
  writeChain = run.catch(() => undefined);
  return run;
}

/**
 * Read through the cache.
 *
 * A failed network read with an entry on disk returns that entry, which is what
 * keeps the library populated offline. `fetchText` is injected rather than
 * imported so this module does not depend on the client that calls it.
 */
export async function fetchCachedText(
  url: string,
  fetchText: (url: string) => Promise<string>
): Promise<string> {
  const current = await load();
  const entry = current[url];

  if (entry && (isImmutable(url) || Date.now() - entry.fetchedAt < MAX_AGE_MS)) {
    lastSource.set(url, 'cache');
    return entry.body;
  }

  try {
    const body = await fetchText(url);
    lastSource.set(url, 'network');
    // Re-read inside the write queue: `current` was read before the network call
    // and would drop an entry another refresh landed in the meantime.
    await commit((disk) => ({ ...disk, [url]: { fetchedAt: Date.now(), body } }));
    return body;
  } catch (err) {
    if (entry) {
      logger.warn('Serving a cached copy after a failed read', { url, error: String(err) });
      lastSource.set(url, 'stale');
      return entry.body;
    }
    throw err;
  }
}

/** Drop every entry, in memory and on disk. */
export async function clearCache(): Promise<void> {
  lastSource.clear();
  await commit(() => ({}));
}
