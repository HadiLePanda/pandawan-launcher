import { describe, it, expect } from 'vitest';
import { detectPlatform, selectPlatformBuild, isPlatform } from './platform';
import type { FileEntry, GameManifest, PlatformBuild } from '@/types';

const file = (name: string, size: number): FileEntry => ({
  path: name,
  hash: 'abc',
  size,
  url: name,
});

const baseManifest: GameManifest = {
  game_id: 'misspell',
  name: 'Misspell',
  version: '0.4.0',
  build_number: 3,
  channel: 'alpha',
  executable: 'misspell.exe',
  base_url: 'https://cdn.test/games/misspell/alpha/0.4.0/',
  files: [file('misspell.exe', 100)],
};

function multiPlatform(): GameManifest {
  const platforms: Record<string, PlatformBuild> = {
    windows: {
      executable: 'misspell.exe',
      base_url: 'https://cdn.test/games/misspell/alpha/0.4.0/windows/',
      size_bytes: 200,
      files: [file('misspell.exe', 200)],
    },
    macos: {
      executable: 'Misspell.app/Contents/MacOS/misspell',
      base_url: 'https://cdn.test/games/misspell/alpha/0.4.0/macos/',
      size_bytes: 300,
      files: [file('Misspell.app/Contents/MacOS/misspell', 300)],
    },
  };
  return { ...baseManifest, platforms };
}

describe('isPlatform', () => {
  it('accepts the three known platforms', () => {
    expect(isPlatform('windows')).toBe(true);
    expect(isPlatform('macos')).toBe(true);
    expect(isPlatform('linux')).toBe(true);
  });

  it('rejects anything else, including prototype keys', () => {
    expect(isPlatform('mac')).toBe(false);
    expect(isPlatform('constructor')).toBe(false);
    expect(isPlatform(null)).toBe(false);
  });
});

describe('detectPlatform', () => {
  it('reads the user agent', () => {
    const original = globalThis.navigator;
    // jsdom's navigator is read-only, so it is swapped wholesale for these.
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      configurable: true,
    });
    expect(detectPlatform()).toBe('macos');

    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      configurable: true,
    });
    expect(detectPlatform()).toBe('windows');

    Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true });
  });
});

describe('selectPlatformBuild', () => {
  it('picks the windows slice on windows', () => {
    const build = selectPlatformBuild(multiPlatform(), 'windows', ['windows', 'macos']);
    expect(build?.executable).toBe('misspell.exe');
    expect(build?.sizeBytes).toBe(200);
    expect(build?.baseUrl).toContain('/windows/');
  });

  it('picks the macos slice on macos, and the .app binary', () => {
    const build = selectPlatformBuild(multiPlatform(), 'macos', ['windows', 'macos']);
    expect(build?.executable).toBe('Misspell.app/Contents/MacOS/misspell');
    expect(build?.sizeBytes).toBe(300);
  });

  it('returns null when the platform has no build', () => {
    // A Linux player must not be handed a Windows binary to download.
    expect(selectPlatformBuild(multiPlatform(), 'linux', ['windows', 'macos'])).toBeNull();
  });

  it('returns null when the platform cannot be determined', () => {
    // Better to refuse than to guess: a wrong guess downloads a build that
    // cannot run, after a long wait.
    expect(selectPlatformBuild(multiPlatform(), null, ['windows', 'macos'])).toBeNull();
  });

  it('falls back to the flat manifest when the declared platform matches', () => {
    const build = selectPlatformBuild(baseManifest, 'windows', ['windows']);
    expect(build?.executable).toBe('misspell.exe');
    expect(build?.files).toHaveLength(1);
  });

  it('rejects a flat manifest whose declared platforms exclude this one', () => {
    // A pre-platform manifest is only usable where the publisher said it runs.
    expect(selectPlatformBuild(baseManifest, 'macos', ['windows'])).toBeNull();
  });

  it('accepts a flat manifest with no declared platforms', () => {
    // Older catalog entries omit supportedPlatforms. Assume the build runs
    // rather than hiding every game published before that field existed.
    expect(selectPlatformBuild(baseManifest, 'macos', undefined)).not.toBeNull();
  });

  it('adds a trailing slash to a base url that lacks one', () => {
    const manifest: GameManifest = {
      ...baseManifest,
      platforms: {
        windows: { executable: 'g.exe', files: [], base_url: 'https://cdn.test/x' },
      },
    };
    expect(selectPlatformBuild(manifest, 'windows', ['windows'])?.baseUrl).toBe(
      'https://cdn.test/x/'
    );
  });

  it('sums file sizes when size_bytes is absent', () => {
    const manifest: GameManifest = {
      ...baseManifest,
      platforms: {
        windows: {
          executable: 'g.exe',
          files: [file('a', 10), file('b', 32)],
        },
      },
    };
    expect(selectPlatformBuild(manifest, 'windows', ['windows'])?.sizeBytes).toBe(42);
  });
});
