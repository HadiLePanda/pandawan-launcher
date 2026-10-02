/// <reference types="node" />
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as http from 'http';

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(() => Promise.reject(new Error('No override file'))),
  writeTextFile: vi.fn(),
  BaseDirectory: { AppData: 'AppData', AppLocalData: 'AppLocalData' },
}));

// Stands in for the Rust command that performs the real fetch. Delegating to
// globalThis.fetch keeps this test exercising a genuine HTTP round trip against
// the example server, minus the Tauri runtime that vitest cannot provide.
vi.mock('./commands', () => ({
  commands: {
    fetchRemoteText: async (url: string) => {
      const response = await globalThis.fetch(url);
      return response.ok
        ? { status: 'ok', data: await response.text() }
        : { status: 'error', error: { code: 'Network', details: `HTTP ${response.status}` } };
    },
  },
}));

const CATALOG = {
  schemaVersion: '1.0.0',
  lastUpdated: '2026-01-01T00:00:00Z',
  games: [
    {
      id: 'fixture-game',
      channel: 'alpha',
      name: 'Fixture Game',
      description: 'Served by the in-test HTTP server.',
      genre: ['Test'],
      supportedPlatforms: ['windows'],
    },
  ],
};

// A channel root holds a manifest plus a per-platform pointer. The launcher reads
// latest.json to learn which version this machine should install, then fetches
// that version's manifest, so both have to exist for a real resolution.
const MANIFEST = {
  game_id: 'fixture-game',
  name: 'Fixture Game',
  version: '0.1.0-alpha.1',
  build_number: 1,
  channel: 'alpha',
  executable: 'fixture-game.exe',
  base_url: null,
  files: [],
  platforms: {
    windows: {
      executable: 'fixture-game.exe',
      base_url: null,
      size_bytes: 1024,
      files: [
        {
          path: 'fixture-game.exe',
          hash: 'a'.repeat(64),
          size: 1024,
          url: 'fixture-game.exe',
        },
      ],
    },
  },
};

const LATEST = { windows: { version: '0.1.0-alpha.1', build: 1 } };

// Published to Windows only. Its latest.json therefore has no macOS entry, which
// is what makes it the subject of the "no build for this machine" case below.
const WINDOWS_ONLY_LATEST = { windows: { version: '2.0.0', build: 7 } };

const FILES: Record<string, unknown> = {
  '/launcher/catalog.json': CATALOG,
  '/games/fixture-game/alpha/latest.json': LATEST,
  '/games/fixture-game/alpha/0.1.0-alpha.1/manifest.json': MANIFEST,
  // Channels published before the per-platform pointer existed keep a single flat
  // manifest at the channel root; the resolver must still find it.
  '/games/flat-game/stable/manifest.json': {
    game_id: 'flat-game',
    name: 'Flat Game',
    version: '1.0.0',
    build_number: 1,
    channel: 'stable',
    executable: 'flat-game.exe',
    files: [
      { path: 'flat-game.exe', hash: 'b'.repeat(64), size: 2048, url: 'flat-game.exe' },
    ],
  },
  '/games/windows-only/stable/latest.json': WINDOWS_ONLY_LATEST,
};

/**
 * Serve a fixed route table over real HTTP on an ephemeral port.
 *
 * The routes are inlined rather than read from disk so this test stays a test:
 * it exercises the genuine fetch -> parse -> resolve pipeline, including the
 * backend error branch, without depending on a checked-in fixture tree that
 * would rot independently of the code.
 */
function serveCdn(): Promise<{ server: http.Server; origin: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
      const route = (req.url ?? '').split('?')[0];
      const body = FILES[route];
      res.setHeader('Access-Control-Allow-Origin', '*');
      if (body === undefined) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

describe('catalog integration over HTTP', () => {
  let server: http.Server;
  let origin: string;

  beforeAll(async () => {
    const started = await serveCdn();
    server = started.server;
    origin = started.origin;
    vi.stubEnv('VITE_CDN_ORIGIN', origin);
    vi.stubEnv('DEV', false);
  }, 10000);

  afterAll(() => {
    server?.close();
  });

  it('loads the remote catalog and resolves a versioned channel manifest', async () => {
    // loadCatalog sniffs the platform itself, and under Node there is no
    // navigator, so it resolves to null and reports every game as unavailable.
    // Claiming to be Windows is what lets this assert the available path.
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });

    const service = await import('./catalog-service');
    const result = await service.loadCatalog();

    expect(result.source).toBe('remote');
    expect(result.unreachable).toBeUndefined();
    expect(result.games.some((g) => g.id === 'fixture-game')).toBe(true);

    const game = result.games.find((g) => g.id === 'fixture-game');
    // Presentation comes from the catalog entry and overrides the manifest, so
    // this asserts the override precedence as much as the fetch.
    expect(game?.name).toBe('Fixture Game');
    expect(game?.genre).toEqual(['Test']);
    expect(game?.channel).toBe('alpha');
    // Version comes from the versioned manifest named by latest.json.
    expect(game?.version).toBe('0.1.0-alpha.1');
    expect(game?.isAvailableOnThisPlatform).toBe(true);
    // Size is the platform build's, not the manifest total.
    expect(game?.sizeBytes).toBe(1024);

    vi.unstubAllGlobals();
  });

  it('falls back to the channel-root manifest when latest.json is absent', async () => {
    const service = await import('./catalog-service');
    const result = await service.resolveManifestForPlatform('flat-game', 'stable', 'windows');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.manifest.version).toBe('1.0.0');
  });

  it('reports unavailable rather than throwing when the platform has no build', async () => {
    const service = await import('./catalog-service');
    // This channel was published to Windows only, so its latest.json has no macOS
    // entry. That must come back as a normal "unavailable" outcome the UI can grey
    // out and explain, not a thrown error.
    const result = await service.resolveManifestForPlatform(
      'windows-only',
      'stable',
      'macos'
    );

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.reason).toBe('no-build-for-platform');
    // The pointer is still reported, so the UI can say what is on offer.
    expect(result.availableVersions).toEqual(WINDOWS_ONLY_LATEST);
  });
});
