import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const files = vi.hoisted(() => new Map<string, string>());

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppLog: 'AppLog' },
  readTextFile: vi.fn(async (name: string) => {
    const body = files.get(name);
    if (body === undefined) throw new Error('No such file');
    return body;
  }),
  writeTextFile: vi.fn(async (name: string, body: string) => {
    files.set(name, body);
  }),
}));

import { clearCache, fetchCachedText, isImmutable, lastReadSource } from './http-cache';

const MUTABLE = 'https://cdn.test/games/misspell/alpha/manifest.json';
const VERSIONED = 'https://cdn.test/games/misspell/alpha/0.4.0-alpha.1/manifest.json';
const CATALOG = 'https://cdn.test/launcher/catalog.json';

describe('http cache', () => {
  beforeEach(async () => {
    files.clear();
    await clearCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('knows a version-stamped path cannot change', () => {
    // Everything under <channel>/<version>/ is published immutable.
    expect(isImmutable(VERSIONED)).toBe(true);
    expect(isImmutable(MUTABLE)).toBe(false);
    expect(isImmutable(CATALOG)).toBe(false);
  });

  it('serves a second read from the cache instead of the network', () => {
    const fetchText = vi.fn(async () => 'body');
    // The point of the cache: a restart should not refetch what it already has.
    return (async () => {
      expect(await fetchCachedText(CATALOG, fetchText)).toBe('body');
      expect(lastReadSource(CATALOG)).toBe('network');
      expect(await fetchCachedText(CATALOG, fetchText)).toBe('body');
      expect(lastReadSource(CATALOG)).toBe('cache');
      expect(fetchText).toHaveBeenCalledTimes(1);
    })();
  });

  it('re-reads a mutable document once the hour is up', async () => {
    const fetchText = vi.fn(async () => 'body');
    await fetchCachedText(CATALOG, fetchText);
    vi.advanceTimersByTime(61 * 60 * 1000);
    await fetchCachedText(CATALOG, fetchText);
    expect(fetchText).toHaveBeenCalledTimes(2);
  });

  it('never re-reads a versioned manifest', async () => {
    // Immutable by publication, so the cache is the truth forever.
    const fetchText = vi.fn(async () => 'body');
    await fetchCachedText(VERSIONED, fetchText);
    vi.advanceTimersByTime(72 * 60 * 60 * 1000);
    await fetchCachedText(VERSIONED, fetchText);
    expect(fetchText).toHaveBeenCalledTimes(1);
  });

  it('serves the stored copy and reports stale when the read fails', async () => {
    await fetchCachedText(CATALOG, async () => 'last good');
    vi.advanceTimersByTime(61 * 60 * 1000);
    const body = await fetchCachedText(CATALOG, async () => {
      throw new Error('offline');
    });
    // Offline shows the last known catalogue rather than an empty library, but it
    // must not claim to be live.
    expect(body).toBe('last good');
    expect(lastReadSource(CATALOG)).toBe('stale');
  });

  it('rethrows when there is nothing stored to fall back on', async () => {
    await expect(
      fetchCachedText(CATALOG, async () => {
        throw new Error('offline');
      })
    ).rejects.toThrow('offline');
  });
});
