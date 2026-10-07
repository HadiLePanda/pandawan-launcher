import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { commands } from './commands';
import { resolveManifestForPlatform } from './catalog-service';
import { resolveUnavailableGameInfo } from './cdn';
import type { CatalogGameEntry } from '@/types';

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  BaseDirectory: { AppData: 'AppData' },
}));

vi.mock('./commands', () => ({ commands: { fetchRemoteText: vi.fn() } }));

const fetchRemoteText = commands.fetchRemoteText as unknown as Mock;

// commands.fetchRemoteText returns the discriminated union that unwrapResult
// unwraps, so the mock must answer in that shape rather than a bare string.
function respond(routes: Record<string, string>): void {
  fetchRemoteText.mockImplementation((url: string) => {
    const hit = Object.keys(routes).find((suffix) => url.endsWith(suffix));
    if (!hit) return Promise.reject(new Error(`no route for ${url}`));
    return Promise.resolve({ status: 'ok', data: routes[hit] });
  });
}

const manifestFor = (version: string, platforms: string[]) =>
  JSON.stringify({
    game_id: 'example-game',
    version,
    build_number: 1,
    channel: 'stable',
    executable: 'game.exe',
    files: [],
    platforms: Object.fromEntries(platforms.map((p) => [p, { executable: 'game', files: [] }])),
  });

beforeEach(() => {
  fetchRemoteText.mockReset();
});

describe('resolveManifestForPlatform', () => {
  it('falls back to the channel-root manifest when there is no per-platform index', async () => {
    // Channels published before latest.json existed must keep working, or every
    // already-published game breaks on upgrade.
    respond({ '/stable/manifest.json': manifestFor('0.4.0', ['windows']) });

    const result = await resolveManifestForPlatform('example-game', 'stable', 'windows');

    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.manifest.version).toBe('0.4.0');
  });

  it('fetches the version this platform is pinned to', async () => {
    respond({
      '/stable/latest.json': JSON.stringify({
        windows: { version: '0.4.0', build: 3 },
        macos: { version: '0.3.9', build: 1 },
      }),
      '/0.3.9/manifest.json': manifestFor('0.3.9', ['macos']),
    });

    const result = await resolveManifestForPlatform('example-game', 'stable', 'macos');

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.manifest.version).toBe('0.3.9');
    }
    expect(fetchRemoteText).toHaveBeenCalledWith(expect.stringContaining('/0.3.9/manifest.json'));
  });

  it('reports unavailable when the platform has no build, keeping what is offered', async () => {
    respond({
      '/stable/latest.json': JSON.stringify({ windows: { version: '0.4.0', build: 3 } }),
    });

    const result = await resolveManifestForPlatform('example-game', 'stable', 'macos');

    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toBe('no-build-for-platform');
      // The UI needs this to explain the greyed-out state instead of just showing it.
      expect(result.availableVersions.windows!.version).toBe('0.4.0');
    }
  });

  it('does not fetch a manifest when the platform is unavailable', async () => {
    respond({
      '/stable/latest.json': JSON.stringify({ windows: { version: '0.4.0', build: 3 } }),
    });

    await resolveManifestForPlatform('example-game', 'stable', 'linux');

    expect(fetchRemoteText).toHaveBeenCalledTimes(1);
    expect(fetchRemoteText).toHaveBeenCalledWith(expect.stringContaining('/latest.json'));
  });

  it('treats a malformed index as absent rather than crashing the catalog', async () => {
    respond({
      '/stable/latest.json': 'not json at all',
      '/stable/manifest.json': manifestFor('0.4.0', ['windows']),
    });

    const result = await resolveManifestForPlatform('example-game', 'stable', 'windows');

    expect(result.status).toBe('ok');
  });
});

describe('resolveUnavailableGameInfo', () => {
  const entry = {
    id: 'example-game',
    name: 'Example Game',
    channel: 'stable',
    description: 'A co-op game',
  } as CatalogGameEntry;

  it('marks the game unavailable and reports the newest version the channel offers', async () => {
    respond({
      '/stable/latest.json': JSON.stringify({
        windows: { version: '0.4.0', build: 3 },
        macos: { version: '0.3.9', build: 1 },
      }),
    });

    const result = await resolveManifestForPlatform('example-game', 'stable', 'linux');
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;

    const info = resolveUnavailableGameInfo(entry, result.availableVersions);

    expect(info.isAvailableOnThisPlatform).toBe(false);
    // Newest by version string, so the card shows what exists, not an arbitrary one.
    expect(info.version).toBe('0.4.0');
    expect(info.availableVersions).toEqual({
      windows: { version: '0.4.0', build: 3 },
      macos: { version: '0.3.9', build: 1 },
    });
  });

  it('prefers the catalog entry over nothing when there are no versions', async () => {
    respond({ '/stable/latest.json': '{}' });

    const result = await resolveManifestForPlatform('example-game', 'stable', 'macos');
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;

    const info = resolveUnavailableGameInfo(entry, result.availableVersions);

    expect(info.name).toBe('Example Game');
    expect(info.version).toBe('');
    expect(info.availableVersions).toEqual({});
  });
});
