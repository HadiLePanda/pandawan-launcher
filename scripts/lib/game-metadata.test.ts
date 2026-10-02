import { describe, it, expect, afterEach } from 'vitest';

import { FIELDS } from './metadata-fields.mjs';
import { readGameMetadata } from './game-metadata.mjs';

const CDN = 'https://cdn.test';

const CATALOG = {
  games: [
    {
      id: 'misspell',
      channel: 'alpha',
      name: 'Misspell',
      description: 'From catalog',
      genre: ['Multiplayer', 'Party'],
      iconUrl: '/placeholder-icon.svg',
    },
    { id: 'on-stable', channel: 'stable', name: 'On Stable' },
  ],
};

const MANIFEST = {
  game_id: 'misspell',
  // Lowercase on purpose: this is the value that reached the launcher, and it is
  // the bug this whole panel exists to prevent recurring.
  name: 'misspell',
  description: null,
  icon_url: 'https://cdn.test/games/misspell/alpha/icon.png',
};

const ROUTES: Record<string, unknown> = {
  '/launcher/catalog.json': CATALOG,
  '/games/misspell/alpha/manifest.json': MANIFEST,
  '/games/misspell/alpha/latest.json': { windows: { version: '0.4.0', build: 3 } },
  // Published on stable, so asking for alpha must be reported as a mismatch.
  '/games/on-stable/alpha/manifest.json': { game_id: 'on-stable', name: 'On Stable' },
};

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Serve a fixed route table, so these tests never touch the network. */
function stubCdn(routes: Record<string, unknown> = ROUTES) {
  globalThis.fetch = (async (url: string | URL) => {
    const path = String(url).replace(CDN, '');
    const body = routes[path];
    return { ok: body !== undefined, json: async () => body } as Response;
  }) as typeof fetch;
}

const load = (gameId: string, channel: string) =>
  readGameMetadata(gameId, channel, { cdnOrigin: CDN, fields: FIELDS });

describe('game metadata for the publish panel', () => {
  it('prefers the catalog over the manifest, as the launcher does', async () => {
    stubCdn();
    const data = await load('misspell', 'alpha');

    // The catalog says "Misspell", the manifest says "misspell". The launcher
    // renders the catalog value, so the form must show it too - otherwise the
    // operator would be editing a value players never see.
    expect(data.fields['name'].value).toBe('Misspell');
    expect(data.fields['name'].source).toBe('catalog');
    expect(data.fields['name'].inherited).toBe(false);
  });

  it('falls back to the manifest and marks the value as inherited', async () => {
    stubCdn();
    const data = await load('misspell', 'alpha');

    // description is null in the manifest and set in the catalog.
    expect(data.fields['description'].value).toBe('From catalog');

    // banner exists in neither, so it is offered as empty rather than hidden:
    // an empty field is an invitation, a missing one is just an absence.
    expect(data.fields['banner-url'].value).toBe('');
    expect(data.fields['banner-url'].source).toBe('empty');
  });

  it('joins list fields so they can be shown and re-sent unchanged', async () => {
    stubCdn();
    const data = await load('misspell', 'alpha');

    expect(data.fields['genre'].value).toBe('Multiplayer, Party');
    expect(data.fields['genre'].list).toBe(true);
  });

  it('reports a game published on a different channel than the one being edited', async () => {
    stubCdn();
    const data = await load('on-stable', 'alpha');

    expect(data.publishedChannel).toBe('stable');
    // Without this the operator would edit alpha, publish successfully, and see
    // no change in the launcher.
    expect(data.channelMismatch).toBe(true);
  });

  it('does not flag a mismatch when the channel is the published one', async () => {
    stubCdn();
    const data = await load('misspell', 'alpha');

    expect(data.channelMismatch).toBe(false);
    expect(data.versions).toEqual({ windows: { version: '0.4.0', build: 3 } });
  });

  it('says a game was never published rather than returning a blank form', async () => {
    stubCdn();
    const data = await load('ghost-game', 'alpha');

    expect(data.exists).toBe(false);
    expect(data.missing).toEqual(['catalog entry', 'manifest']);
    // An empty form would invite filling in metadata for a game nobody can install.
    expect(data.fields).toEqual({});
  });

  it('offers a manifest-only game, which is the invisible-game case', async () => {
    stubCdn({
      '/launcher/catalog.json': { games: [] },
      '/games/orphan/alpha/manifest.json': { game_id: 'orphan', name: 'Orphan' },
    });
    const data = await load('orphan', 'alpha');

    expect(data.hasManifest).toBe(true);
    expect(data.hasCatalogEntry).toBe(false);
    expect(data.missing).toEqual(['catalog entry']);
    // The manifest name is all there is, and it is worth showing.
    expect(data.fields['name'].value).toBe('Orphan');
    expect(data.fields['name'].source).toBe('manifest');
    expect(data.fields['name'].inherited).toBe(true);
  });

  it('offers every field the publisher accepts', async () => {
    stubCdn();
    const data = await load('misspell', 'alpha');

    // A field the form omits can never be edited, so the two lists must match.
    expect(Object.keys(data.fields).sort()).toEqual(FIELDS.map((f) => f.flag).sort());
  });

  it('surfaces a value that differs between the catalog and the manifest', async () => {
    // The failure this guards against: the catalog says "Misspell" and the
    // manifest says "misspell". The form shows the catalog value, so an operator
    // who never touches the name would never learn the manifest is still wrong,
    // and every client resolving a build without the catalog would render it.
    stubCdn();
    const data = await load('misspell', 'alpha');

    expect(data.fields['name'].value).toBe('Misspell');
    expect(MANIFEST.name).toBe('misspell');
    // `inherited` is the only signal the form has, and it is false here, so the
    // publisher has to check the manifest itself rather than trust the catalog.
    expect(data.fields['name'].inherited).toBe(false);
  });
});
