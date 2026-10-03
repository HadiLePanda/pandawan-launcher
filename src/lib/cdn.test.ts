import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CDN_ORIGIN,
  fingerprintCatalog,
  handleImageError,
  NEWS_PLACEHOLDER,
  resolveBaseUrl,
  resolveCdnUrl,
  resolveNewsImage,
} from './cdn';
import { startCatalogPoll, CATALOG_POLL_MS } from './cdn';
import type { GameManifest } from '@/types';

describe('resolveNewsImage', () => {
  it('prefers the item own image', () => {
    expect(resolveNewsImage({ imageUrl: '/news/hero.png' })).toBe(`${CDN_ORIGIN}/news/hero.png`);
  });

  it('falls back to the game banner when the item has no image', () => {
    // The point of the feature: a news item about a game shows that game's art
    // rather than an empty hole in the card.
    expect(resolveNewsImage({ imageUrl: undefined }, { bannerUrl: '/games/a/banner.png' })).toBe(
      `${CDN_ORIGIN}/games/a/banner.png`
    );
  });

  it('ignores a bundled placeholder stored as the item image', () => {
    // Published as data, a placeholder would otherwise stop the chain at a grey
    // file and hide the banner the game does have.
    expect(
      resolveNewsImage(
        { imageUrl: '/placeholder-banner.svg' },
        { bannerUrl: '/games/a/banner.png' }
      )
    ).toBe(`${CDN_ORIGIN}/games/a/banner.png`);
  });

  it('prefers the banner over the icon', () => {
    // The banner is the wider of the two, so it crops correctly at both thumbnail
    // and article sizes. Reaching for the icon first would show a square image
    // stretched into a 16:9 slot.
    const art = { bannerUrl: '/games/a/banner.png', iconUrl: '/games/a/icon.png' };
    expect(resolveNewsImage({}, art)).toBe(`${CDN_ORIGIN}/games/a/banner.png`);
  });

  it('falls back to the icon when the game has no banner', () => {
    expect(resolveNewsImage({}, { iconUrl: '/games/a/icon.png' })).toBe(
      `${CDN_ORIGIN}/games/a/icon.png`
    );
  });

  it('falls back to the placeholder when nothing else exists', () => {
    // An item with no gameId - a launcher-wide announcement - has nothing to
    // borrow from, so the placeholder is the only correct answer.
    expect(resolveNewsImage({}, null)).toBe(NEWS_PLACEHOLDER);
  });

  it('never returns an empty string', () => {
    // The invariant that lets callers drop their `&& item.imageUrl` guard. If this
    // ever returns '', every call site regresses to an empty slot.
    const cases: Array<[Parameters<typeof resolveNewsImage>[0], unknown]> = [
      [{}, undefined],
      [{ imageUrl: '' }, null],
      [{ imageUrl: '   ' }, {}],
      [{}, { bannerUrl: '', iconUrl: null }],
      [{}, { bannerUrl: null, iconUrl: undefined }],
    ];
    for (const [item, art] of cases) {
      expect(resolveNewsImage(item, art as never)).not.toBe('');
    }
  });

  it('treats a whitespace-only image as absent', () => {
    // A publisher leaving a stray space should not produce a request to " ".
    expect(resolveNewsImage({ imageUrl: '  ' }, { bannerUrl: '/b.png' })).toBe(
      `${CDN_ORIGIN}/b.png`
    );
  });

  it('keeps an absolute URL untouched', () => {
    const url = 'https://cdn.elsewhere.test/hero.png';
    expect(resolveNewsImage({ imageUrl: url })).toBe(url);
  });
});

describe('handleImageError', () => {
  function fakeImg() {
    return { src: '' } as unknown as HTMLImageElement & { src: string };
  }

  it('substitutes the placeholder when an image fails', () => {
    const img = fakeImg();
    img.src = 'https://cdn.test/gone.png';
    handleImageError({ currentTarget: img });
    expect(img.src).toBe(NEWS_PLACEHOLDER);
  });

  it('does not loop if the placeholder also fails', () => {
    const img = fakeImg();
    handleImageError({ currentTarget: img });
    expect(img.src).toBe(NEWS_PLACEHOLDER);

    // A second error event for the same element must be a no-op. Otherwise a
    // placeholder that itself 404s re-triggers the handler forever, spinning the
    // main thread rather than just showing a broken image once.
    handleImageError({ currentTarget: img });
    expect(img.src).toBe(NEWS_PLACEHOLDER);
  });

  it('does nothing for an element with no src at all', () => {
    // Defensive: React can fire the handler for an unmounted node in some
    // versions, and touching a detached element is not worth handling.
    expect(() => handleImageError({ currentTarget: null as never })).not.toThrow();
  });
});

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

  it('changes when only artwork changes', () => {
    // The bug this exists for: republishing only the icon produced an identical
    // fingerprint, so a running launcher never offered the refresh and kept the
    // old art until it was restarted by hand.
    const before = fingerprintCatalog(
      catalog([{ id: 'a', version: '1.0.0', iconUrl: '/placeholder-icon.svg' }])
    );
    const after = fingerprintCatalog(
      catalog([
        { id: 'a', version: '1.0.0', iconUrl: 'https://cdn.test/games/a/icon-1a2b3c4d.png' },
      ])
    );
    expect(after).not.toBe(before);
  });

  it('changes when only the banner or copy changes', () => {
    const base = { id: 'a', version: '1.0.0' };
    const before = fingerprintCatalog(catalog([{ ...base, description: 'old', genre: ['A'] }]));
    const banner = fingerprintCatalog(catalog([{ ...base, bannerUrl: 'https://cdn.test/b.png' }]));
    const copy = fingerprintCatalog(catalog([{ ...base, description: 'new', genre: ['A'] }]));
    const genre = fingerprintCatalog(catalog([{ ...base, description: 'old', genre: ['A', 'B'] }]));
    for (const next of [banner, copy, genre]) expect(next).not.toBe(before);
  });
});

describe('resolveCdnUrl', () => {
  it('leaves a bundled placeholder app-local', () => {
    // The placeholder is served out of the app bundle. Prefixing the CDN origin
    // asked the bucket for a file it does not have, which is why a game with no
    // artwork showed a bare fallback glyph instead of the placeholder.
    for (const url of ['/placeholder-icon.svg', '/placeholder-banner.svg']) {
      expect(resolveCdnUrl(url)).toBe(url);
    }
  });

  it('still pins any other root-relative path to the CDN origin', () => {
    // Regression guard: `/news/hero.png` and friends are bucket paths, and the
    // news resolver's tests assert this behaviour.
    expect(resolveCdnUrl('/news/hero.png')).toBe(`${CDN_ORIGIN}/news/hero.png`);
    expect(resolveCdnUrl('games/a/icon.png')).toBe(`${CDN_ORIGIN}/games/a/icon.png`);
    expect(resolveCdnUrl('https://elsewhere.test/a.png')).toBe('https://elsewhere.test/a.png');
    expect(resolveCdnUrl(undefined)).toBe('');
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
