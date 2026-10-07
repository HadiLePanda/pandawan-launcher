import { describe, it, expect } from 'vitest';

import {
  CATALOG_GAME_FIELDS,
  DIFFED_GAME_FIELDS,
  catalogDiff,
  catalogDiffIsEmpty,
  catalogEntryFrom,
  catalogGames,
  catalogGameId,
  removeCatalogEntry,
} from './catalog-edit.mjs';
import { FIELDS } from './metadata-fields.mjs';

// The state the dashboard actually sees in production: the published catalog was
// edited in place by publish-metadata.mjs (corrected name, uploaded artwork), and
// public/catalog.json still carries what it shipped with. That is the exact
// disagreement the Catalog tab has to show, and the one a plain overwrite would
// silently revert.
const CDN_EXAMPLE_GAME = {
  id: 'example-game',
  channel: 'alpha',
  availableChannels: ['alpha'],
  name: 'Example Game',
  description: 'A local multiplayer word game.',
  developer: 'Pandawan Corp',
  genre: ['Multiplayer', 'Party'],
  iconUrl: 'https://cdn.test/games/example-game/alpha/icon-a1b2c3d4.png',
  bannerUrl: 'https://cdn.test/games/example-game/alpha/banner-e5f6a7b8.png',
  screenshots: ['https://cdn.test/games/example-game/alpha/shot-1.png'],
  supportedPlatforms: ['windows', 'macos'],
};

const LOCAL_EXAMPLE_GAME = {
  id: 'example-game',
  channel: 'alpha',
  availableChannels: ['alpha'],
  name: 'example-game',
  description: 'A local multiplayer word game. Alpha playtest build.',
  developer: 'Pandawan Corp',
  genre: ['Multiplayer', 'Party'],
  iconUrl: '/placeholder-icon.svg',
  bannerUrl: '/placeholder-banner.svg',
  screenshots: [],
  supportedPlatforms: ['windows'],
};

const localDoc = (games) => ({
  schemaVersion: '1.0.0',
  lastUpdated: '2026-09-30T00:00:00Z',
  games,
});
const remoteDoc = (games) => ({
  schemaVersion: '1.0.0',
  lastUpdated: '2026-10-01T00:00:00Z',
  games,
});
const NOW = Date.parse('2026-10-02T12:00:00Z');

describe('catalogDiff', () => {
  it('reports nothing for two identical documents', () => {
    const diff = catalogDiff(remoteDoc([CDN_EXAMPLE_GAME]), localDoc([{ ...CDN_EXAMPLE_GAME }]));

    expect(diff).toEqual({ onlyLive: [], onlyLocal: [], changed: [] });
    expect(catalogDiffIsEmpty(diff)).toBe(true);
  });

  it('lists a game the published catalog has and the repo does not', () => {
    const diff = catalogDiff(remoteDoc([CDN_EXAMPLE_GAME]), localDoc([]));

    expect(diff.onlyLive).toEqual([{ id: 'example-game', channel: 'alpha', name: 'Example Game' }]);
    expect(diff.onlyLocal).toEqual([]);
    expect(catalogDiffIsEmpty(diff)).toBe(false);
  });

  it('lists a game the repo has that is not published - what a publish would add', () => {
    const diff = catalogDiff(remoteDoc([]), localDoc([LOCAL_EXAMPLE_GAME]));

    expect(diff.onlyLocal).toEqual([
      { id: 'example-game', channel: 'alpha', name: 'example-game' },
    ]);
    expect(diff.onlyLive).toEqual([]);
  });

  it('names the differing fields of a game both copies carry', () => {
    const diff = catalogDiff(remoteDoc([CDN_EXAMPLE_GAME]), localDoc([LOCAL_EXAMPLE_GAME]));

    expect(diff.onlyLive).toEqual([]);
    expect(diff.onlyLocal).toEqual([]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].id).toBe('example-game');
    expect(diff.changed[0].fields.sort()).toEqual([
      'bannerUrl',
      'description',
      'iconUrl',
      'name',
      'screenshots',
      'supportedPlatforms',
    ]);
  });

  it('reports field names, never values', () => {
    // The table renders both columns already, so shipping the values would double
    // the payload and invite the client to render a second, disagreeing view.
    const diff = catalogDiff(remoteDoc([CDN_EXAMPLE_GAME]), localDoc([LOCAL_EXAMPLE_GAME]));

    for (const game of diff.changed) {
      // Nothing on a changed row may hold a nested object: `fields` is the one
      // array, and it carries names only.
      expect(Object.keys(game).sort()).toEqual(['channel', 'fields', 'id', 'name']);
      expect(Array.isArray(game.fields)).toBe(true);
      for (const field of game.fields) expect(typeof field).toBe('string');
      for (const value of Object.values(game)) {
        if (value === game.fields) continue;
        expect(value === null || typeof value === 'string').toBe(true);
      }
    }

    // And the names themselves must be the field names, not the values they hold.
    expect(diff.changed[0].fields).not.toContain('Example Game');
    expect(diff.changed[0].fields).not.toContain('/placeholder-icon.svg');
  });

  it('notices a game that moved channel', () => {
    // channel is compared on purpose: a game promoted alpha -> stable is a real
    // change, and it is the field a stale local copy most often disagrees about.
    const promoted = { ...CDN_EXAMPLE_GAME, channel: 'stable' };
    const diff = catalogDiff(remoteDoc([promoted]), localDoc([{ ...CDN_EXAMPLE_GAME }]));

    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].fields).toEqual(['channel']);
  });

  it('notices a changed availableChannels list', () => {
    const diff = catalogDiff(
      remoteDoc([{ ...CDN_EXAMPLE_GAME, availableChannels: ['alpha', 'beta'] }]),
      localDoc([{ ...CDN_EXAMPLE_GAME, availableChannels: ['alpha'] }])
    );

    expect(diff.changed[0].fields).toEqual(['availableChannels']);
  });

  it('treats a reordering of a list as no difference', () => {
    // JSON comparison, not set comparison: the launcher reads these lists as
    // lists, and reporting a reorder as drift would make the tab cry wolf on
    // every publish that regenerates a list.
    const a = { ...LOCAL_EXAMPLE_GAME, genre: ['Party', 'Multiplayer'] };
    const diff = catalogDiff(remoteDoc([a]), localDoc([{ ...a }]));

    expect(diff.changed).toEqual([]);
  });

  it('treats a missing field and a null as equal', () => {
    // Absent and explicitly null both mean "not set" to the launcher, and the
    // merge's own sameValue compares them that way. The diff has to agree with it,
    // or every game with a sparse published entry would look changed.
    const sparse = { id: 'example-game', channel: 'alpha' };
    const diff = catalogDiff(remoteDoc([sparse]), localDoc([{ ...sparse, name: null }]));

    expect(diff.changed).toEqual([]);
  });

  it('compares a missing side as knowing nothing', () => {
    const absentLocal = catalogDiff(remoteDoc([CDN_EXAMPLE_GAME]), null);
    expect(absentLocal.onlyLive.map((g) => g.id)).toEqual(['example-game']);

    const absentLive = catalogDiff(null, localDoc([LOCAL_EXAMPLE_GAME]));
    expect(absentLive.onlyLocal.map((g) => g.id)).toEqual(['example-game']);
  });

  it('never lets an unusable entry become a key', () => {
    const diff = catalogDiff(
      remoteDoc([{ id: 'example-game' }, null, { channel: 'alpha' }]),
      localDoc([{ id: 'example-game' }, { id: 'ghost' }])
    );

    expect(diff.onlyLocal.map((g) => g.id)).toEqual(['ghost']);
    expect(diff.changed).toEqual([]);
  });

  it('does not compare a game against two copies of itself', () => {
    // A duplicated id in the published document would otherwise appear as a
    // changed game disagreeing with an identical entry - a row that says
    // "changed" with an empty meaning.
    const diff = catalogDiff(
      remoteDoc([
        { id: 'example-game', name: 'A' },
        { id: 'example-game', name: 'B' },
      ]),
      localDoc([{ id: 'example-game', name: 'A' }])
    );

    expect(diff.changed).toEqual([]);
  });

  it('never mutates either input', () => {
    const live = remoteDoc([{ ...CDN_EXAMPLE_GAME }]);
    const local = localDoc([{ ...LOCAL_EXAMPLE_GAME }]);
    const before = JSON.stringify([live, local]);

    catalogDiff(live, local);

    expect(JSON.stringify([live, local])).toBe(before);
  });
});

describe('the diff field list stays in step with the metadata contract', () => {
  it('compares every field the publisher can write to a catalog entry', () => {
    // If a new field is added to metadata-fields.mjs and not here, a game's edit
    // would be invisible in the diff - and invisible is exactly what this tab
    // exists to prevent.
    // `id` and `channel` are the two fields the contract does not carry: id is the
    // join key and channel is validated against CHANNELS, both owned elsewhere.
    const catalogFields = FIELDS.map((field) => field.catalog).sort();
    const covered = CATALOG_GAME_FIELDS.filter((f) => f !== 'channel' && f !== 'id').sort();

    expect(covered).toEqual(catalogFields);
  });

  it('excludes only the join key from the compared set', () => {
    expect(DIFFED_GAME_FIELDS).toContain('channel');
    expect(DIFFED_GAME_FIELDS).not.toContain('id');
  });
});

describe('catalogGameId', () => {
  it('accepts the ids the repo actually uses', () => {
    expect(catalogGameId('example-game')).toEqual({ ok: true, id: 'example-game' });
    expect(catalogGameId('example-test-game')).toEqual({
      ok: true,
      id: 'example-test-game',
    });
    expect(catalogGameId('  space-trimmed  ')).toEqual({ ok: true, id: 'space-trimmed' });
  });

  it('rejects an id that would be read as an option', () => {
    // Scripts in scripts/ treat any bare `--token` as a flag. A game id of
    // `--force` typed into the form would become a destructive switch.
    const result = catalogGameId('--force');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('--');
  });

  it('rejects an empty id', () => {
    expect(catalogGameId('')).toEqual({ ok: false, error: 'a game id is required' });
    expect(catalogGameId('   ')).toEqual({ ok: false, error: 'a game id is required' });
    expect(catalogGameId(undefined).ok).toBe(false);
  });

  it('rejects a path separator or a climb', () => {
    // Both become a bucket prefix rather than a key inside the game's own
    // prefix: `../` is the one prune deletes recursively.
    for (const bad of ['a/b', '../escape', 'a..b/x', 'a\\b', './x']) {
      expect(catalogGameId(bad).ok, `${bad} should be rejected`).toBe(false);
    }
  });

  it('rejects characters a bucket path segment should not carry', () => {
    for (const bad of ['with space', 'emoji🎮', 'a?b=1', 'a#b', 'a%2Fb', '-leading', '.hidden']) {
      expect(catalogGameId(bad).ok, `${bad} should be rejected`).toBe(false);
    }
  });

  it('rejects an absurdly long id', () => {
    expect(catalogGameId('a'.repeat(65)).ok).toBe(false);
    expect(catalogGameId('a'.repeat(64)).ok).toBe(true);
  });
});

describe('catalogEntryFrom', () => {
  it('builds an entry from the fields the operator sent', () => {
    const result = catalogEntryFrom({
      id: 'brand-new',
      channel: 'beta',
      name: 'Brand New',
      description: 'Not shipped yet.',
      genre: ['Test'],
      supportedPlatforms: ['windows', 'macos'],
    });

    expect(result.ok).toBe(true);
    expect(result.entry).toEqual({
      id: 'brand-new',
      channel: 'beta',
      name: 'Brand New',
      description: 'Not shipped yet.',
      genre: ['Test'],
      supportedPlatforms: ['windows', 'macos'],
    });
  });

  it('invents nothing the publisher would not write', () => {
    // No defaulted availableChannels, no placeholder iconUrl. A tab that showed a
    // placeholder as if it were published would disagree with the very next real
    // publish, which is the confusion this tab exists to remove.
    const result = catalogEntryFrom({ id: 'brand-new', channel: 'stable' });

    expect(result.entry).toEqual({ id: 'brand-new', channel: 'stable' });
    expect(Object.keys(result.entry).sort()).toEqual(['channel', 'id']);
  });

  it('rejects a bad id or channel, naming which', () => {
    expect(catalogEntryFrom({ id: '--force', channel: 'stable' }).error).toContain('option');
    expect(catalogEntryFrom({ id: 'ok', channel: 'nightly' }).error).toContain(
      'channel must be one of'
    );
    expect(catalogEntryFrom({ id: 'ok' }).error).toContain('channel must be one of');
  });

  it('drops a field the catalog does not have rather than smuggling it through', () => {
    const result = catalogEntryFrom({
      id: 'brand-new',
      channel: 'stable',
      name: 'Brand New',
      isAdmin: true,
      verifiedBadge: 'example-pick',
    });

    expect(result.entry.isAdmin).toBeUndefined();
    expect(result.entry.verifiedBadge).toBeUndefined();
  });

  it('drops an emptied string instead of writing a blank label', () => {
    const result = catalogEntryFrom({ id: 'brand-new', channel: 'stable', name: '   ' });

    expect('name' in result.entry).toBe(false);
  });

  it('keeps an emptied list, because [] is a real value', () => {
    // The opposite of the string rule, deliberately: `screenshots: []` means "no
    // screenshots" and the launcher needs to be able to say it. Silently dropping
    // it would leave the previous entry's screenshots behind.
    const result = catalogEntryFrom({
      id: 'brand-new',
      channel: 'stable',
      screenshots: [],
    });

    expect(result.entry.screenshots).toEqual([]);
  });

  it('rejects a list field sent as a scalar', () => {
    // The launcher would crash or silently mis-render; better to refuse at the
    // form than to publish a document every client has to survive.
    const result = catalogEntryFrom({ id: 'brand-new', channel: 'stable', genre: 'Puzzle' });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('genre must be a list');
  });

  it('rejects a text field sent as an object', () => {
    const result = catalogEntryFrom({ id: 'brand-new', channel: 'stable', name: { x: 1 } });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('name must be text');
  });

  it('rejects a payload that is not an object', () => {
    expect(catalogEntryFrom(null).ok).toBe(false);
    expect(catalogEntryFrom([{ id: 'x' }]).ok).toBe(false);
  });

  it('trims text but not list contents', () => {
    const result = catalogEntryFrom({
      id: 'brand-new',
      channel: 'stable',
      name: '  Padded  ',
      genre: [' Puzz le '],
    });

    expect(result.entry.name).toBe('Padded');
    // Trimming list items would silently rewrite what the operator typed; the
    // publisher owns that decision, not the dashboard.
    expect(result.entry.genre).toEqual([' Puzz le ']);
  });
});

describe('removeCatalogEntry', () => {
  const twoGames = remoteDoc([CDN_EXAMPLE_GAME, { id: 'example-test-game', channel: 'stable' }]);

  it('removes the entry and leaves everything else byte-identical', () => {
    const result = removeCatalogEntry(twoGames, 'example-test-game', { now: NOW });

    expect(result.ok).toBe(true);
    expect(result.removed).toBe('example-test-game');
    expect(result.remaining).toBe(1);
    expect(result.catalog.games).toEqual([CDN_EXAMPLE_GAME]);
  });

  it('stamps lastUpdated, because an index that moved should say so', () => {
    const result = removeCatalogEntry(twoGames, 'example-test-game', { now: NOW });

    expect(result.catalog.lastUpdated).toBe('2026-10-02T12:00:00.000Z');
  });

  it('refuses to remove the last game', () => {
    // validateCatalog rejects an empty games array and every launcher reads this
    // document, so an accidental double-click must not be able to produce one.
    const result = removeCatalogEntry(remoteDoc([CDN_EXAMPLE_GAME]), 'example-game', { now: NOW });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('last game');
  });

  it('refuses an id that is not published, so a typo is visible', () => {
    const result = removeCatalogEntry(twoGames, 'misspel', { now: NOW });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('is not in the published catalog');
  });

  it('refuses an unusable id before touching the document', () => {
    expect(removeCatalogEntry(twoGames, '--force', { now: NOW }).error).toContain('option');
    expect(removeCatalogEntry(twoGames, '', { now: NOW }).error).toContain('required');
    expect(removeCatalogEntry(twoGames, '../etc', { now: NOW }).ok).toBe(false);
  });

  it('refuses a document whose remaining entries would not validate', () => {
    // The publisher's own check, reused rather than restated: this function must
    // not be able to produce a document publish-catalog.mjs would refuse.
    const broken = remoteDoc([CDN_EXAMPLE_GAME, { id: 'no-channel', name: 'No Channel' }]);
    const result = removeCatalogEntry(broken, 'example-game', { now: NOW });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('has no channel');
  });

  it('does not mutate the document it was given', () => {
    const before = JSON.stringify(twoGames);
    removeCatalogEntry(twoGames, 'example-test-game', { now: NOW });

    expect(JSON.stringify(twoGames)).toBe(before);
  });

  it('removes every entry sharing an id, not just the first', () => {
    // A duplicated id is a broken document; leaving the second copy would mean
    // the game is still listed after a "successful" delete.
    const dupes = remoteDoc([
      { id: 'example-game', channel: 'alpha' },
      { ...CDN_EXAMPLE_GAME },
      {
        id: 'other',
        channel: 'stable',
      },
    ]);
    const result = removeCatalogEntry(dupes, 'example-game', { now: NOW });

    expect(result.ok).toBe(true);
    expect(catalogGames(result.catalog).map((g) => g.id)).toEqual(['other']);
  });
});
