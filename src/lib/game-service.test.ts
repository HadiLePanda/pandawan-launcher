import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { commands } from './commands';
import { checkForUpdates } from './game-service';
import { resolveManifestForPlatform } from './catalog-service';
import type { GameManifest } from '@/types';

vi.mock('./commands', () => ({
  commands: { checkGameUpdate: vi.fn(), fetchRemoteText: vi.fn() },
}));

vi.mock('./catalog-service', () => ({ resolveManifestForPlatform: vi.fn() }));

vi.mock('./platform', async () => {
  const actual = await vi.importActual<typeof import('./platform')>('./platform');
  return { ...actual, detectPlatform: () => 'windows' };
});

vi.mock('./cdn', () => ({ resolveBaseUrl: () => 'https://cdn.test/games/example-game/stable/' }));

vi.mock('./logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const checkGameUpdate = commands.checkGameUpdate as unknown as Mock;
const resolveManifest = resolveManifestForPlatform as unknown as Mock;

// A multi-platform manifest keeps the per-platform builds under `platforms` and
// leaves the top-level files/executable empty, exactly as publish-game writes it.
const multiPlatformManifest = (): GameManifest =>
  ({
    game_id: 'example-game',
    name: 'Example Game',
    version: '0.4.0',
    build_number: 150,
    channel: 'stable',
    description: null,
    icon_url: null,
    banner_url: null,
    executable: '',
    files: null,
    base_url: 'https://cdn.test/games/example-game/stable/0.4.0/',
    platforms: {
      windows: {
        executable: 'Example Game.exe',
        files: [
          { path: 'Example Game.exe', size: 1024, hash: 'aaa' },
          { path: 'Example Game_Data/globalgamemanagers', size: 2048, hash: 'bbb' },
        ],
        base_url: 'https://cdn.test/games/example-game/stable/0.4.0/windows/',
        size_bytes: 3072,
      },
    },
  }) as unknown as GameManifest;

beforeEach(() => {
  checkGameUpdate.mockReset();
  resolveManifest.mockReset();
  // unwrapResult expects the discriminated union the bindings return.
  checkGameUpdate.mockResolvedValue({ status: 'ok', data: true });
  resolveManifest.mockResolvedValue({
    status: 'ok',
    manifest: multiPlatformManifest(),
  });
});

describe('checkForUpdates', () => {
  it('passes a platform-narrowed manifest to the backend', async () => {
    // A multi-platform manifest has files: null at the top level. The Rust
    // command types `manifest` as `Vec<FileEntry>`, so the raw manifest is
    // rejected with "invalid type: null, expected a sequence" and the check
    // never reaches the update comparison.
    const result = await checkForUpdates('example-game', 'stable');

    expect(result).toBe(true);
    expect(checkGameUpdate).toHaveBeenCalledTimes(1);

    const [gameId, sent] = checkGameUpdate.mock.calls[0] as [string, GameManifest];
    expect(gameId).toBe('example-game');
    expect(Array.isArray(sent.files)).toBe(true);
    expect(sent.files).toHaveLength(2);
    expect(sent.executable).toBe('Example Game.exe');
    expect(sent.platforms).toBeUndefined();
    expect(sent.build_number).toBe(150);
  });

  it('does not reach the backend when the platform has no build', async () => {
    // selectPlatformBuild returns null for a platform the manifest does not
    // carry. The command must report that as an error rather than sending the
    // un-narrowed manifest and letting serde reject it.
    resolveManifest.mockResolvedValue({
      status: 'ok',
      manifest: {
        ...multiPlatformManifest(),
        platforms: { 'macos-aarch64': { executable: 'Example Game', files: [] } },
      } as unknown as GameManifest,
    });

    await expect(checkForUpdates('example-game', 'stable')).rejects.toThrow(
      /No build of "example-game" is available for this platform/
    );
    expect(checkGameUpdate).not.toHaveBeenCalled();
  });

  it('reports unavailable as an error and never calls the backend', async () => {
    resolveManifest.mockResolvedValue({ status: 'unavailable', reason: 'no-build-for-platform' });

    await expect(checkForUpdates('example-game', 'stable')).rejects.toThrow(
      /No build of example-game is available for this platform/
    );
    expect(checkGameUpdate).not.toHaveBeenCalled();
  });
});
