import { describe, it, expect } from 'vitest';

import { mergeCatalog, remoteCatalogRefusal, validateCatalog } from './catalog-merge.mjs';

// The published copy, as publish-metadata.mjs would have left it after someone
// fixed the display name in the dashboard. The local copy still carries the typo
// it shipped with. Running the old publisher turned the first object into the
// second, which is the bug these tests exist to pin shut.
const CDN_MISSPELL = {
  id: 'misspell',
  channel: 'alpha',
  availableChannels: ['alpha'],
  // Corrected on the CDN by `publish:meta --name "Misspell"`.
  name: 'Misspell',
  description: 'A local multiplayer word game.',
  developer: 'Pandawan Corp',
  genre: ['Multiplayer', 'Party'],
  // Content-addressed by publish-metadata.mjs; the local file has no idea this
  // URL exists.
  iconUrl: 'https://cdn.test/games/misspell/alpha/icon-a1b2c3d4.png',
  bannerUrl: 'https://cdn.test/games/misspell/alpha/banner-e5f6a7b8.png',
  screenshots: [],
  supportedPlatforms: ['windows'],
};

const LOCAL_MISSPELL = {
  id: 'misspell',
  channel: 'alpha',
  availableChannels: ['alpha'],
  name: 'misspell',
  description: 'A local multiplayer word game. Alpha playtest build.',
  developer: 'Pandawan Corp',
  genre: ['Multiplayer', 'Party'],
  iconUrl: '/placeholder-icon.svg',
  bannerUrl: '/placeholder-banner.svg',
  screenshots: [],
  supportedPlatforms: ['windows'],
};

const local = (games) => ({ schemaVersion: '1.0.0', lastUpdated: '2026-09-30T00:00:00Z', games });
const remote = (games) => ({ schemaVersion: '1.0.0', lastUpdated: '2026-10-01T00:00:00Z', games });
const NOW = Date.parse('2026-10-02T12:00:00Z');
const opts = { now: NOW };

const entryFor = (catalog, id) => catalog.games.find((game) => game.id === id);

describe('merging a catalog into the published one', () => {
  it('adds a game the CDN does not have yet', () => {
    const result = mergeCatalog(remote([]), local([LOCAL_MISSPELL]), opts);

    expect(result.added).toEqual([{ id: 'misspell', channel: 'alpha' }]);
    expect(entryFor(result.catalog, 'misspell')).toEqual(LOCAL_MISSPELL);
    expect(result.changed).toBe(true);
  });

  it('keeps a game the CDN already lists, field for field', () => {
    // The regression this whole change exists for: the local file's stale name,
    // description and placeholder artwork must not reach the launcher.
    const result = mergeCatalog(remote([CDN_MISSPELL]), local([LOCAL_MISSPELL]), opts);

    const entry = entryFor(result.catalog, 'misspell');
    expect(result.added).toEqual([]);
    expect(result.skipped.map((item) => item.id)).toEqual(['misspell']);
    // Asserted key by key rather than with toEqual(LOCAL_MISSPELL): the point is
    // that no field moved, so naming them is what makes a regression legible.
    expect(entry.name).toBe('Misspell');
    expect(entry.description).toBe('A local multiplayer word game.');
    expect(entry.iconUrl).toBe('https://cdn.test/games/misspell/alpha/icon-a1b2c3d4.png');
    expect(entry.bannerUrl).toBe('https://cdn.test/games/misspell/alpha/banner-e5f6a7b8.png');
    expect(entry).toEqual(CDN_MISSPELL);
  });

  it('reports what an overwrite would have reverted', () => {
    const result = mergeCatalog(remote([CDN_MISSPELL]), local([LOCAL_MISSPELL]), opts);

    const skip = result.skipped[0];
    expect(skip.forced).toBe(false);
    // Every field the two copies disagree on, with both values, so the operator
    // can see exactly what a plain upload was about to throw away.
    expect(skip.differs.map((change) => change.field).sort()).toEqual([
      'bannerUrl',
      'description',
      'iconUrl',
      'name',
    ]);
    const name = skip.differs.find((change) => change.field === 'name');
    expect(name.cdn).toBe('Misspell');
    expect(name.local).toBe('misspell');
    // artwork in `screenshots` and every other field is absent from the local
    // copy only if the CDN added it, which is what cdnOnly records.
    expect(skip.cdnOnly).toEqual([]);
  });

  it('flags a CDN field the local file never mentions', () => {
    // A field added on the CDN after the local file was checked out - a
    // hand-edited entry, or a new field the launcher learned to read. An upload
    // of the local file drops it without saying so.
    const cdn = { ...CDN_MISSPELL, verifiedBadge: 'pandawan-pick' };
    const result = mergeCatalog(remote([cdn]), local([LOCAL_MISSPELL]), opts);

    expect(result.skipped[0].cdnOnly).toEqual(['verifiedBadge']);
    expect(entryFor(result.catalog, 'misspell').verifiedBadge).toBe('pandawan-pick');
  });

  it('separates a local-only field from a CDN-side edit', () => {
    // The published entry is sparse - a hand-written CDN entry, or one written
    // before a field existed. Every local field is missing from it, and none of
    // those is a CDN-side edit the merge "saved": it is the other direction.
    // Counting them as saved edits is what made the first version of this report
    // claim every skip rescued something.
    const sparse = { id: 'misspell', channel: 'alpha', name: 'misspell' };
    const result = mergeCatalog(remote([sparse]), local([LOCAL_MISSPELL]), opts);

    const skip = result.skipped[0];
    expect(skip.differs).toEqual([]);
    expect(skip.cdnOnly).toEqual([]);
    expect(skip.localOnly).toEqual([
      'availableChannels',
      'bannerUrl',
      'description',
      'developer',
      'genre',
      'iconUrl',
      'screenshots',
      'supportedPlatforms',
    ]);
    // The sparse published entry is still what gets kept.
    expect(entryFor(result.catalog, 'misspell')).toEqual(sparse);
  });

  it('does not delete a game the local file omits', () => {
    // Not a removal request: a stale local copy is not a request to remove a
    // live game from every launcher.
    const other = { id: 'pandawan-test-game', channel: 'stable', name: 'Pandawan Test Game' };
    const result = mergeCatalog(remote([CDN_MISSPELL, other]), local([LOCAL_MISSPELL]), opts);

    expect(entryFor(result.catalog, 'pandawan-test-game')).toEqual(other);
    expect(result.preserved).toEqual([{ id: 'pandawan-test-game', channel: 'stable' }]);
    expect(result.changed).toBe(false);
  });

  it('adds and keeps in the same run, reporting each separately', () => {
    const brandNew = { id: 'brand-new', channel: 'beta', name: 'Brand New' };
    const result = mergeCatalog(remote([CDN_MISSPELL]), local([LOCAL_MISSPELL, brandNew]), opts);

    expect(result.added).toEqual([{ id: 'brand-new', channel: 'beta' }]);
    expect(result.skipped).toHaveLength(1);
    expect(result.catalog.games.map((game) => game.id)).toEqual(['misspell', 'brand-new']);
    // Order is preserved: the CDN entries keep their slots, additions append.
    expect(entryFor(result.catalog, 'misspell')).toEqual(CDN_MISSPELL);
  });

  it('adds nothing from an empty games array and still keeps the CDN copy', () => {
    const result = mergeCatalog(remote([CDN_MISSPELL]), local([]), opts);

    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.catalog.games).toEqual([CDN_MISSPELL]);
    // The published document is left alone, so nothing is uploaded.
    expect(result.changed).toBe(false);
  });

  it('adds nothing from a local file with no games array at all', () => {
    const result = mergeCatalog(remote([CDN_MISSPELL]), { schemaVersion: '1.0.0' }, opts);

    expect(result.added).toEqual([]);
    expect(result.catalog.games).toEqual([CDN_MISSPELL]);
    expect(result.changed).toBe(false);
  });

  it('treats a remote document with no games array as knowing nothing', () => {
    // The script refuses this document before the merge runs; the module itself
    // must not throw, and must not lose what the local file offers.
    const result = mergeCatalog({ schemaVersion: '1.0.0' }, local([LOCAL_MISSPELL]), opts);

    expect(result.catalog.games).toEqual([LOCAL_MISSPELL]);
    expect(result.added).toHaveLength(1);
  });

  it('stamps lastUpdated only when the document actually changes', () => {
    const merged = mergeCatalog(remote([CDN_MISSPELL]), local([LOCAL_MISSPELL]), opts);
    expect(merged.changed).toBe(false);
    expect(merged.catalog.lastUpdated).toBe('2026-10-01T00:00:00Z');

    const added = mergeCatalog(
      remote([CDN_MISSPELL]),
      local([{ id: 'new', channel: 'stable' }]),
      opts
    );
    expect(added.changed).toBe(true);
    expect(added.catalog.lastUpdated).toBe('2026-10-02T12:00:00.000Z');
  });

  it('does not mutate either input', () => {
    const published = remote([{ ...CDN_MISSPELL }]);
    const checkedIn = local([{ ...LOCAL_MISSPELL }]);
    const before = JSON.stringify([published, checkedIn]);

    mergeCatalog(published, checkedIn, opts);

    // The merge is the publisher's only copy of the published document; mutating
    // it in place would make a dry run change what the next run compares against.
    expect(JSON.stringify([published, checkedIn])).toBe(before);
  });

  it('carries schemaVersion from the local file only when the CDN lacks one', () => {
    const legacy = mergeCatalog({ games: [CDN_MISSPELL] }, local([LOCAL_MISSPELL]), opts);
    expect(legacy.catalog.schemaVersion).toBe('1.0.0');

    const current = mergeCatalog(remote([CDN_MISSPELL]), local([LOCAL_MISSPELL]), opts);
    expect(current.catalog.schemaVersion).toBe('1.0.0');
  });
});

describe('force', () => {
  it('lets the local entry win for a game both sides know', () => {
    const result = mergeCatalog(remote([CDN_MISSPELL]), local([LOCAL_MISSPELL]), {
      ...opts,
      force: true,
    });

    const entry = entryFor(result.catalog, 'misspell');
    expect(entry.name).toBe('misspell');
    expect(entry.iconUrl).toBe('/placeholder-icon.svg');
    expect(entry).toEqual(LOCAL_MISSPELL);
    // Still reported as a skip, and still carrying what the operator gave up -
    // that is what makes --force an informed choice rather than a leap.
    expect(result.skipped[0].forced).toBe(true);
    expect(result.skipped[0].differs.map((change) => change.field)).toContain('name');
  });

  it('does not delete a CDN-only game even under force', () => {
    // --force is an escape hatch for "the local file should win", not for "the
    // local file is the complete truth". Making a live game vanish stays
    // impossible.
    const other = { id: 'pandawan-test-game', channel: 'stable', name: 'Pandawan Test Game' };
    const result = mergeCatalog(remote([CDN_MISSPELL, other]), local([LOCAL_MISSPELL]), {
      ...opts,
      force: true,
    });

    expect(entryFor(result.catalog, 'pandawan-test-game')).toEqual(other);
    expect(result.preserved).toEqual([{ id: 'pandawan-test-game', channel: 'stable' }]);
  });

  it('reports no change when the forced entries are identical to the CDN ones', () => {
    const result = mergeCatalog(remote([CDN_MISSPELL]), local([{ ...CDN_MISSPELL }]), {
      ...opts,
      force: true,
    });

    // Otherwise every push rewrites the index every launcher reads, for nothing.
    expect(result.changed).toBe(false);
  });

  it('still adds a game the CDN does not have', () => {
    const brandNew = { id: 'brand-new', channel: 'beta', name: 'Brand New' };
    const result = mergeCatalog(remote([CDN_MISSPELL]), local([LOCAL_MISSPELL, brandNew]), {
      ...opts,
      force: true,
    });

    expect(entryFor(result.catalog, 'brand-new')).toEqual(brandNew);
  });
});

describe('validateCatalog', () => {
  it('accepts a well-formed catalog', () => {
    expect(validateCatalog(local([LOCAL_MISSPELL]))).toBeNull();
  });

  it('rejects a missing or empty games array', () => {
    expect(validateCatalog({ schemaVersion: '1.0.0' })).toBe(
      'catalog.json has no games array (or it is empty).'
    );
    expect(validateCatalog(local([]))).toBe('catalog.json has no games array (or it is empty).');
  });

  it('rejects an entry without a usable id', () => {
    expect(validateCatalog(local([{ channel: 'alpha' }]))).toBe(
      'catalog.json has a game entry without a valid id.'
    );
    expect(validateCatalog(local([null]))).toBe(
      'catalog.json has a game entry without a valid id.'
    );
  });

  it('rejects an entry with no channel, naming the game', () => {
    expect(validateCatalog(local([{ id: 'misspell' }]))).toBe(
      'Game "misspell" has no channel; the launcher needs one to build its manifest URL.'
    );
  });
});

describe('refusing to publish from an unreadable remote catalog', () => {
  // The catastrophic case, and the reason the script reads before it writes.
  // Publishing the local file because the CDN was unreachable would remove
  // every game the local file does not mention from every launcher.
  it('states that a new catalog will not be written from scratch', () => {
    const url = 'https://cdn.test/launcher/catalog.json';

    expect(remoteCatalogRefusal(url)).toBe(
      `Could not read ${url}. Refusing to write a new catalog from scratch.`
    );
    // Wording that names the outcome matters: it is what an operator greps for
    // when a publish fails.
    expect(remoteCatalogRefusal(url)).toContain('Refusing to write a new catalog from scratch');
  });

  it('has no merge path that turns an absent remote document into an upload', () => {
    // A null remote must not be a special case anywhere in the module: the
    // script refuses before calling mergeCatalog, so nothing here may treat
    // "could not read" as "publish the local file".
    const result = mergeCatalog(null, local([LOCAL_MISSPELL]), opts);

    // With nothing published, the only additions are the local ones and the
    // caller is the thing that has to refuse - pinned here so that assumption
    // cannot drift silently into "absent means empty, upload anyway".
    expect(result.catalog.games).toEqual([LOCAL_MISSPELL]);
    expect(result.added).toHaveLength(1);
    expect(remoteCatalogRefusal('https://cdn.test/launcher/catalog.json')).toMatch(/Refusing/);
  });
});
