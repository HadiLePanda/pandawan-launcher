import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { resolveGameUrls } from './cdn';
import type { GameCatalog, GameManifest } from '@/types';

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  BaseDirectory: { AppData: 'AppData' },
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

vi.mock('./cdn', async () => {
  const actual = await vi.importActual<typeof import('./cdn')>('./cdn');
  return {
    ...actual,
    CdnUrl: {
      catalog: vi.fn(() => 'https://cdn.example.com/launcher/catalog.json'),
      gamesPath: vi.fn((id: string, channel: string = 'stable') => `https://cdn.example.com/games/${id}/${channel}`),
      manifest: vi.fn((id: string, channel: string = 'stable') => `https://cdn.example.com/games/${id}/${channel}/manifest.json`),
      news: vi.fn(() => 'https://cdn.example.com/launcher/news.json'),
      withCacheBust: actual.CdnUrl.withCacheBust,
    },
    resolveGameUrls: vi.fn((id: string, channel: string = 'stable') => ({
      manifestUrl: `https://cdn.example.com/games/${id}/${channel}/manifest.json`,
      baseUrl: `https://cdn.example.com/games/${id}/${channel}`,
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
      sizeBytes: manifest.size_bytes ?? 0,
      releaseDate: manifest.release_date ?? new Date().toISOString(),
      supportedPlatforms: entry.supportedPlatforms ?? ['windows'],
      patchNotes: manifest.patch_notes,
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

function errorResponse(status: number, statusText = 'Not Found'): Response {
  return {
    ok: false,
    status,
    statusText,
    json: async () => ({ error: statusText }),
    text: async () => statusText,
    headers: new Headers(),
  } as Response;
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
      baseUrl: `https://cdn.example.com/games/${id}/${channel}`,
    }));
  });

  describe('loadCatalog', () => {
    it('uses the remote catalog when it is available', async () => {
      const catalog = makeCatalog();
      const manifest = makeManifest();

      (tauriFetch as Mock).mockImplementation(async (url: string) => {
        if (url.includes('/launcher/catalog.json')) return okResponse(catalog);
        if (url.includes('/games/')) return okResponse(manifest);
        return errorResponse(404);
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

      (tauriFetch as Mock).mockImplementation(async (url: string) => {
        if (url.includes('/launcher/catalog.json')) return errorResponse(503);
        if (url.includes('/games/')) return okResponse(manifest);
        return errorResponse(404);
      });

      (globalThis.fetch as Mock).mockResolvedValue(okResponse(catalog));

      const result = await service.loadCatalog();

      expect(result.source).toBe('embedded');
      expect(result.catalog).toEqual(catalog);
      expect(result.games).toHaveLength(1);
      expect(result.unreachable).toBe(true);
    });

    it('prefers a local override file over the embedded catalog', async () => {
      const overrideCatalog = makeCatalog({ games: [{ id: 'override-game', name: 'Override Game' }] });
      const manifest = makeManifest({ game_id: 'override-game', name: 'Override Game' });

      (readTextFile as Mock).mockResolvedValue(JSON.stringify(overrideCatalog));

      (tauriFetch as Mock).mockImplementation(async (url: string) => {
        if (url.includes('/launcher/catalog.json')) return errorResponse(503);
        if (url.includes('/games/override-game/')) return okResponse(manifest);
        return errorResponse(404);
      });

      const result = await service.loadCatalog();

      expect(result.source).toBe('local');
      expect(result.catalog.games[0].id).toBe('override-game');
      expect(result.games).toHaveLength(1);
    });

    it('throws when no catalog source is available', async () => {
      (tauriFetch as Mock).mockResolvedValue(errorResponse(503));
      (readTextFile as Mock).mockRejectedValue(new Error('No such file or directory'));
      (globalThis.fetch as Mock).mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(service.loadCatalog()).rejects.toThrow('No catalog could be loaded');
    });

    it('still returns embedded source when their manifests cannot be resolved', async () => {
      const catalog = makeCatalog();

      (tauriFetch as Mock).mockImplementation(async (url: string) => {
        if (url.includes('/launcher/catalog.json')) return errorResponse(503);
        return errorResponse(404);
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
      (tauriFetch as Mock).mockResolvedValue(okResponse(catalog));

      const result = await service.fetchRemoteCatalog('https://cdn.example.com/launcher/catalog.json');
      expect(result).toEqual(catalog);
    });

    it('throws on non-ok responses', async () => {
      (tauriFetch as Mock).mockResolvedValue(errorResponse(500, 'Internal Server Error'));

      await expect(service.fetchRemoteCatalog('https://cdn.example.com/launcher/catalog.json')).rejects.toThrow(
        'Remote catalog returned 500: Internal Server Error'
      );
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
      (globalThis.fetch as Mock).mockResolvedValue(errorResponse(404));

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
      expect(() => service.validateCatalog({ schemaVersion: '1.0.0' })).toThrow('missing the games array');
    });

    it('rejects a game without an id', () => {
      expect(() => service.validateCatalog({ schemaVersion: '1.0.0', games: [{}] })).toThrow('missing a valid id');
    });
  });
});
