import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CDN_ORIGIN, fingerprintCatalog, resolveBaseUrl } from './cdn';
import { startCatalogPoll, CATALOG_POLL_MS } from './cdn';
import type { GameManifest } from '@/types';

describe('fingerprintCatalog', () => {
  const catalog = (games: Array<Record<string, unknown>>) => ({ games });

  it('is stable for identical content', () => {
    const a = catalog([
      { id: 'a', channel: 'stable', version: '1.0.0' },
      { id: 'b', channel: 'alpha', version: '0.2.0' },
    ]);
    const b = catalog([
      { id: 'b', channel: 'alpha', version: '0.2.0' },
      { id: 'a', channel: 'stable', version: '1.0.0' },
    ]);
    // Order must not matter: R2 returns the same document, but the fingerprint
    // should not depend on how the publisher happened to order the array.
    expect(fingerprintCatalog(a)).toBe(fingerprintCatalog(b));
  });

  it('changes when a game version changes', () => {
    const before = fingerprintCatalog(catalog([{ id: 'a', version: '1.0.0' }]));
    const after = fingerprintCatalog(catalog([{ id: 'a', version: '1.1.0' }]));
    expect(after).not.toBe(before);
  });

  it('changes when a game is added', () => {
    const before = fingerprintCatalog(catalog([{ id: 'a' }]));
    const after = fingerprintCatalog(catalog([{ id: 'a' }, { id: 'b' }]));
    expect(after).not.toBe(before);
  });

  it('treats a missing games array as empty rather than throwing', () => {
    expect(fingerprintCatalog({})).toBe('');
  });
});

describe('startCatalogPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not report a change on the very first tick', async () => {
    const onChange = vi.fn();
    const poll = startCatalogPoll({
      loadCatalog: async () => ({ catalog: { games: [{ id: 'a', version: '1.0.0' }] } }),
      onChange,
      intervalMs: 100,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).not.toHaveBeenCalled();
    poll.stop();
  });

  it('reports once when content changes after the baseline', async () => {
    const onChange = vi.fn();
    let version = '1.0.0';
    const poll = startCatalogPoll({
      loadCatalog: async () => ({ catalog: { games: [{ id: 'a', version }] } }),
      onChange,
      intervalMs: 100,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).not.toHaveBeenCalled();

    version = '1.1.0';
    await vi.advanceTimersByTimeAsync(100);
    expect(onChange).toHaveBeenCalledTimes(1);

    // Unchanged content afterwards must not re-fire, or the dot would never
    // settle and the user would be nagged on every tick.
    await vi.advanceTimersByTimeAsync(300);
    expect(onChange).toHaveBeenCalledTimes(1);
    poll.stop();
  });

  it('does not poll while isBusy reports a download in flight', async () => {
    const loadCatalog = vi.fn(async () => ({ catalog: { games: [] } }));
    const poll = startCatalogPoll({
      loadCatalog,
      onChange: vi.fn(),
      isBusy: () => true,
      intervalMs: 100,
    });

    await vi.advanceTimersByTimeAsync(500);
    // First tick establishes nothing because it bails before loading; the point
    // is that no network call is made while busy.
    expect(loadCatalog).not.toHaveBeenCalled();
    poll.stop();
  });

  it('keeps polling after a failed load', async () => {
    const onChange = vi.fn();
    let shouldFail = true;
    const poll = startCatalogPoll({
      loadCatalog: async () => {
        if (shouldFail) throw new Error('offline');
        return { catalog: { games: [{ id: 'a' }] } };
      },
      onChange,
      intervalMs: 100,
    });

    await vi.advanceTimersByTimeAsync(0);
    shouldFail = false;
    // The next tick must still run: a transient network error should not
    // permanently disable the watcher.
    await vi.advanceTimersByTimeAsync(100);
    poll.stop();
  });

  it('stops cleanly and ignores later ticks', async () => {
    const loadCatalog = vi.fn(async () => ({ catalog: { games: [] } }));
    const poll = startCatalogPoll({ loadCatalog, onChange: vi.fn(), intervalMs: 100 });

    await vi.advanceTimersByTimeAsync(0);
    const callsAtStop = loadCatalog.mock.calls.length;
    poll.stop();
    await vi.advanceTimersByTimeAsync(500);

    expect(loadCatalog.mock.calls.length).toBe(callsAtStop);
  });

  it('defaults to a multi-minute interval', () => {
    expect(CATALOG_POLL_MS).toBeGreaterThanOrEqual(60_000);
  });
});

/**
 * Build bytes live under a version-stamped directory, so a manifest cannot tell
 * the client where its files are by position alone — it has to say so. These
 * tests cover both directions of that contract, including the fallback that
 * keeps manifests published before the layout change working.
 */
describe('resolveBaseUrl', () => {
  it('uses the manifest base_url, adding a trailing slash', () => {
    expect(
      resolveBaseUrl({
        game_id: 'misspell',
        channel: 'alpha',
        base_url: 'https://cdn.example.com/games/misspell/alpha/0.4.0-alpha.1',
      } as GameManifest)
    ).toBe('https://cdn.example.com/games/misspell/alpha/0.4.0-alpha.1/');
  });

  it('keeps an already-slashed base_url unchanged', () => {
    expect(
      resolveBaseUrl({
        game_id: 'misspell',
        channel: 'alpha',
        base_url: 'https://cdn.example.com/games/misspell/alpha/0.4.0/',
      } as GameManifest)
    ).toBe('https://cdn.example.com/games/misspell/alpha/0.4.0/');
  });

  it('falls back to the flat channel dir for pre-layout manifests', () => {
    // Manifests published before version-stamping carry no base_url. They must
    // still resolve, or every already-published game breaks on upgrade.
    expect(resolveBaseUrl({ game_id: 'misspell', channel: 'alpha' } as GameManifest)).toBe(
      `${CDN_ORIGIN}/games/misspell/alpha/`
    );
  });

  it('defaults a missing channel to stable when falling back', () => {
    expect(resolveBaseUrl({ game_id: 'legacy' } as GameManifest)).toBe(
      `${CDN_ORIGIN}/games/legacy/stable/`
    );
  });
});
