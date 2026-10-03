import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { commands } from './commands';
import { resolveGameUrls } from './cdn';
import type { GameCatalog, GameManifest } from '@/types';

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  BaseDirectory: { AppData: 'AppData' },
}));

// Remote fetches go through the Rust `fetch_remote_text` command, which returns
// the body as text. The Tauri HTTP plugin is no longer used by this module.
vi.mock('./commands', () => ({
  commands: {
    fetchRemoteText: vi.fn(),
  },
}));

vi.mock('./cdn', async () => {
  const actual = await vi.importActual<typeof import('./cdn')>('./cdn');
  return {
    ...actual,
    CdnUrl: {
      catalog: vi.fn(() => 'https://cdn.example.com/launcher/catalog.json'),
      gamesPath: vi.fn(
        (id: string, channel: string = 'stable') => `https://cdn.example.com/games/${id}/${channel}`
      ),
      manifest: vi.fn(
        (id: string, channel: string = 'stable') =>
          `https://cdn.example.com/games/${id}/${channel}/manifest.json`
      ),
      news: vi.fn(() => 'https://cdn.example.com/launcher/news.json'),
    },
    // Tests of resolveBaseUrl need the real implementation, not this stub, so they
    // import it through importActual below rather than from './cdn'.
    resolveGameUrls: vi.fn((id: string, channel: string = 'stable') => ({
      manifestUrl: `https://cdn.example.com/games/${id}/${channel}/manifest.json`,
    })),
    resolveGameInfo: vi.fn((entry, manifest) => ({
      id: entry.id,
      channel: entry.channel ?? 'stable',
      name: entry.name ?? manifest.name ?? entry.id,
      description: entry.description ?? manifest.description ?? '',
      developer: entry.developer ?? 'Pandawan Corp',
      genre: entry.genre ?? [],
      iconUrl: entry.iconUrl ?? manifest.icon_url ?? '',
      bannerUrl: entry.bannerUrl ?? manifest.banner_url ?? '',
      screenshots: entry.screenshots ?? [],
      version: manifest.version,
      sizeBytes: manifest.files.reduce(
        (sum: number, f: { size?: number }) => sum + (f.size ?? 0),
        0
      ),
      releaseDate: new Date().toISOString(),
      supportedPlatforms: entry.supportedPlatforms ?? ['windows'],
    })),
  };
});

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as Response;
}

/**
 * Mimics the Rust command's discriminated result. `commands.fetchRemoteText`
 * returns `{ status: 'ok', data }`, which `unwrapResult` unwraps, so the mock has
 * to return the same shape rather than a bare string.
 */
function okBody(body: unknown) {
  return Promise.resolve({ status: 'ok' as const, data: JSON.stringify(body) });
}

function networkError(message = 'not found') {
  return Promise.resolve({
    status: 'error' as const,
    error: { code: 'Network' as const, details: message },
  });
}

function makeCatalog(overrides?: Partial<GameCatalog>): GameCatalog {
  return {
    schemaVersion: '1.0.0',
    lastUpdated: '2026-07-08T00:00:00Z',
    games: [
      {
        id: 'test-game',
        channel: 'stable',
        name: 'Test Game',
        description: 'A test game',
        developer: 'Pandawan Corp',
        genre: ['Action'],
        iconUrl: '',
        bannerUrl: '',
        screenshots: [],
        supportedPlatforms: ['windows'],
      },
    ],
    ...overrides,
  };
}

function makeManifest(overrides?: Partial<GameManifest>): GameManifest {
  return {
    game_id: 'test-game',
    name: 'Test Game',
    version: '1.0.0',
    build_number: 1,
    channel: 'stable',
    executable: 'TestGame.exe',
    files: [{ path: 'TestGame.exe', hash: 'abc', size: 1000, url: 'files/TestGame.exe' }],
    ...overrides,
  };
}

describe('catalog-service', () => {
  let service: typeof import('./catalog-service');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('DEV', false);
    service = await import('./catalog-service');
    (resolveGameUrls as Mock).mockImplementation((id: string, channel: string = 'stable') => ({
      manifestUrl: `https://cdn.example.com/games/${id}/${channel}/manifest.json`,
    }));
  });

  describe('channel handling', () => {
    it('keeps a manifest-declared channel', async () => {
      (commands.fetchRemoteText as Mock).mockResolvedValue(
        okBody(makeManifest({ channel: 'alpha' }))
      );

      const manifest = await service.fetchGameManifest(
        'https://cdn.example.com/games/test-game/alpha/manifest.json'
      );

      expect(manifest.channel).toBe('alpha');
    });

    it('defaults a pre-channel manifest to stable', async () => {
      // Manifests published before channels existed have no `channel` key. They
      // must still load rather than leaving the field undefined downstream.
      const legacy: Record<string, unknown> = { ...makeManifest() };
      delete legacy.channel;
      (commands.fetchRemoteText as Mock).mockResolvedValue(okBody(legacy));

      const manifest = await service.fetchGameManifest(
        'https://cdn.example.com/games/test-game/stable/manifest.json'
      );

      expect(manifest.channel).toBe('stable');
    });

    it('exposes stable/beta/alpha and normalizes unknown channels', () => {
      expect(service.KNOWN_CHANNELS).toEqual(['stable', 'beta', 'alpha']);
      expect(service.normalizeChannel('beta')).toBe('beta');
      expect(service.normalizeChannel('nightly')).toBe('stable');
      expect(service.normalizeChannel(undefined)).toBe('stable');
      expect(service.normalizeChannel(null)).toBe('stable');
    });

    it('agrees with channels.ts on which channels exist', async () => {
      // Two frontend copies of the same list is a drift risk on its own. The
      // channel picker reads channels.ts and the catalog resolver reads this
      // module, so a channel added to one and not the other would let a player
      // pick a channel the launcher cannot resolve a manifest for.
      const { KNOWN_CHANNELS: fromChannels } = await import('./channels');
      expect([...service.KNOWN_CHANNELS]).toEqual([...fromChannels]);
    });

    it('agrees with the Rust KNOWN_CHANNELS', () => {
      // The third copy lives in src-tauri/src/types.rs and cannot be imported
      // from here, so read the declaration as text. That is a weaker check than
      // an import, but it turns "someone added a channel to Rust and forgot the
      // frontend" from a runtime surprise into a failing test.
      const rust = readFileSync(resolve(__dirname, '../../src-tauri/src/types.rs'), 'utf-8');
      const match = rust.match(/KNOWN_CHANNELS: \[&str; \d+\] = \[([^\]]+)\]/);
      expect(match, 'KNOWN_CHANNELS declaration not found in types.rs').not.toBeNull();

      const parsed = (match as RegExpMatchArray)[1]
        .split(',')
        .map((part) => part.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
      expect(parsed).toEqual([...service.KNOWN_CHANNELS]);
    });
  });

  describe('loadCatalog', () => {
    it('uses the remote catalog when it is available', async () => {
      const catalog = makeCatalog();
      const manifest = makeManifest();

      (commands.fetchRemoteText as Mock).mockImplementation(async (url: string) => {
        if (url.includes('/launcher/catalog.json')) return okBody(catalog);
        if (url.includes('/games/')) return okBody(manifest);
        return networkError('HTTP 404');
      });

      const result = await service.loadCatalog();

      expect(result.source).toBe('remote');
      expect(result.catalog).toEqual(catalog);
      expect(result.games).toHaveLength(1);
      expect(result.unreachable).toBeUndefined();
    });

    it('falls back to the embedded catalog when the remote server is unreachable', async () => {
      const catalog = makeCatalog();
      const manifest = makeManifest();

      (commands.fetchRemoteText as Mock).mockImplementation(async (url: string) => {
        if (url.includes('/launcher/catalog.json')) return networkError('HTTP 503');
        if (url.includes('/games/')) return okBody(manifest);
        return networkError('HTTP 404');
      });

      (globalThis.fetch as Mock).mockResolvedValue(okResponse(catalog));

      const result = await service.loadCatalog();

      expect(result.source).toBe('embedded');
      expect(result.catalog).toEqual(catalog);
      expect(result.games).toHaveLength(1);
      expect(result.unreachable).toBe(true);
    });

    it('prefers a local override file over the embedded catalog', async () => {
      const overrideCatalog = makeCatalog({
        games: [{ id: 'override-game', name: 'Override Game' }],
      });
      const manifest = makeManifest({ game_id: 'override-game', name: 'Override Game' });

      (readTextFile as Mock).mockResolvedValue(JSON.stringify(overrideCatalog));

      (commands.fetchRemoteText as Mock).mockImplementation(async (url: string) => {
        if (url.includes('/launcher/catalog.json')) return networkError('HTTP 503');
        if (url.includes('/games/override-game/')) return okBody(manifest);
        return networkError('HTTP 404');
      });

      const result = await service.loadCatalog();

      expect(result.source).toBe('local');
      expect(result.catalog.games[0].id).toBe('override-game');
      expect(result.games).toHaveLength(1);
    });

    it('throws when no catalog source is available', async () => {
      (commands.fetchRemoteText as Mock).mockResolvedValue({
        status: 'error',
        error: { code: 'Network', details: 'HTTP 503' },
      });
      (readTextFile as Mock).mockRejectedValue(new Error('No such file or directory'));
      (globalThis.fetch as Mock).mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(service.loadCatalog()).rejects.toThrow('No catalog could be loaded');
    });

    it('still returns embedded source when their manifests cannot be resolved', async () => {
      const catalog = makeCatalog();

      (commands.fetchRemoteText as Mock).mockImplementation(async (url: string) => {
        if (url.includes('/launcher/catalog.json')) return networkError('HTTP 503');
        return networkError('HTTP 404');
      });

      (globalThis.fetch as Mock).mockResolvedValue(okResponse(catalog));

      const result = await service.loadCatalog();

      expect(result.source).toBe('embedded');
      expect(result.games).toHaveLength(0);
      expect(result.unreachable).toBe(true);
    });
  });

  describe('fetchRemoteCatalog', () => {
    it('parses and validates a successful response', async () => {
      const catalog = makeCatalog();
      (commands.fetchRemoteText as Mock).mockResolvedValue(okBody(catalog));

      const result = await service.fetchRemoteCatalog(
        'https://cdn.example.com/launcher/catalog.json'
      );
      expect(result).toEqual(catalog);
    });

    it('throws on non-ok responses', async () => {
      (commands.fetchRemoteText as Mock).mockResolvedValue({
        status: 'error',
        error: { code: 'Network', details: 'HTTP 500 Internal Server Error' },
      });

      await expect(
        service.fetchRemoteCatalog('https://cdn.example.com/launcher/catalog.json')
      ).rejects.toThrow();
    });
  });

  describe('loadEmbeddedCatalog', () => {
    it('fetches and caches the bundled catalog', async () => {
      const catalog = makeCatalog();
      (globalThis.fetch as Mock).mockResolvedValue(okResponse(catalog));

      const first = await service.loadEmbeddedCatalog();
      const second = await service.loadEmbeddedCatalog();

      expect(first).toEqual(catalog);
      expect(second).toBe(first);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledWith('/catalog.json');
    });

    it('returns null when the bundled catalog is missing', async () => {
      (globalThis.fetch as Mock).mockRejectedValue(new Error('HTTP 404'));

      const result = await service.loadEmbeddedCatalog();
      expect(result).toBeNull();
    });
  });

  describe('loadLocalOverrideCatalog', () => {
    it('reads and parses a valid override file', async () => {
      const catalog = makeCatalog();
      (readTextFile as Mock).mockResolvedValue(JSON.stringify(catalog));

      const result = await service.loadLocalOverrideCatalog();
      expect(result).toEqual(catalog);
    });

    it('returns null when the override file is missing', async () => {
      (readTextFile as Mock).mockRejectedValue(new Error('No such file or directory (os error 2)'));

      const result = await service.loadLocalOverrideCatalog();
      expect(result).toBeNull();
    });
  });

  describe('validateCatalog', () => {
    it('accepts a valid catalog', () => {
      expect(() => service.validateCatalog(makeCatalog())).not.toThrow();
    });

    it('rejects a catalog without games', () => {
      expect(() => service.validateCatalog({ schemaVersion: '1.0.0' })).toThrow(
        'missing the games array'
      );
    });

    it('rejects a game without an id', () => {
      expect(() => service.validateCatalog({ schemaVersion: '1.0.0', games: [{}] })).toThrow(
        'missing a valid id'
      );
    });
  });
});
