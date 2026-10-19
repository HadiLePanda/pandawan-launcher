import { describe, expect, it } from 'vitest';

import {
  buildDownloadsIndex,
  mergeDownloadsIndex,
  classifyAsset,
  assetLabel,
  isSha256,
  PLATFORM_ORDER,
} from './downloads-index.mjs';

const BASE = 'https://cdn.example.com/launcher';
const HASH = 'a'.repeat(64);

const file = (name) => ({ name, sha256: HASH });
const build = (names, version = '0.2.1') =>
  buildDownloadsIndex({ version, files: (names ?? []).map(file), base: BASE });

describe('asset classification', () => {
  it('classifies the one installer each platform ships', () => {
    expect(classifyAsset('App_0.2.1_x64-setup.exe')).toBe('windows');
    expect(classifyAsset('App_0.2.1_aarch64.dmg')).toBe('macos');
  });

  it('does not list the formats the page must not offer', () => {
    // The updater archive and the MSI are not human downloads: Windows ships
    // NSIS only and macOS ships the dmg.
    expect(classifyAsset('App_0.2.1_x64.msi')).toBe(null);
    expect(classifyAsset('App_aarch64.app.tar.gz')).toBe(null);
    expect(classifyAsset('app_0.2.1_amd64.deb')).toBe(null);
  });

  it('returns null for something that is not a downloadable build', () => {
    expect(classifyAsset('latest.json')).toBe(null);
    expect(classifyAsset('assets-compact.json')).toBe(null);
    expect(classifyAsset('App_0.2.1_x64-setup.exe.sig')).toBe(null);
  });

  it('labels each artifact type the way the page shows it', () => {
    expect(assetLabel('App_0.2.1_x64-setup.exe')).toBe('EXE installer');
    expect(assetLabel('App_0.2.1_aarch64.dmg')).toBe('Disk image');
  });
});

describe('downloads index', () => {
  const full = ['App_0.2.1_x64-setup.exe', 'App_0.2.1_aarch64.dmg'];

  it('carries the version through', () => {
    expect(build(full).version).toBe('0.2.1');
    expect(build(full, '9.9.9').version).toBe('9.9.9');
  });

  it('groups each artifact under its platform with its label', () => {
    const index = build(full);
    expect(index.platforms.windows.map((i) => i.label)).toEqual(['EXE installer']);
    expect(index.platforms.macos.map((i) => i.label)).toEqual(['Disk image']);
  });

  it('builds the URL under the given base and percent-encodes the name', () => {
    const index = build(['App 0.2.1 x64-setup.exe']);
    expect(index.platforms.windows[0].url).toBe(`${BASE}/App%200.2.1%20x64-setup.exe`);
  });

  it('leads each platform with the installer a person wants, whatever order the files arrive in', () => {
    // The website takes items[0] as the download to offer, so this is the
    // load-bearing assertion: shuffled input, and macOS must not lead with the
    // updater tarball.
    const index = build(['App_0.2.1_aarch64.dmg', 'App_0.2.1_x64-setup.exe']);
    expect(index.platforms.windows[0].label).toBe('EXE installer');
    expect(index.platforms.macos[0].label).toBe('Disk image');
  });

  it('has an empty group for a platform with no artifacts', () => {
    const index = build(['App_0.2.1_x64-setup.exe']);
    expect(index.platforms.windows.map((i) => i.label)).toEqual(['EXE installer']);
    expect(index.platforms.macos).toEqual([]);
  });

  it('excludes signatures, latest.json and the CI asset map', () => {
    const index = build([
      'App_0.2.1_x64-setup.exe',
      'App_0.2.1_x64-setup.exe.sig',
      'latest.json',
      'assets-compact.json',
    ]);
    expect(index.platforms.windows).toHaveLength(1);
    expect(index.platforms.windows[0].label).toBe('EXE installer');
  });

  it('ignores a file extension it does not recognise instead of guessing a platform', () => {
    const index = build(['App_0.2.1_x64-setup.exe', 'App_0.2.1_arm64.pkg', 'App.AppImage']);
    expect(index.platforms.windows.map((i) => i.label)).toEqual(['EXE installer']);
    expect(index.platforms.macos).toEqual([]);
  });

  it('has a deliberate position for every label its own classifier can produce', () => {
    // buildDownloadsIndex throws on a label missing from PLATFORM_ORDER; this
    // proves that guard is unreachable for the extensions the classifier knows,
    // so adding one to classifyAsset without ordering it fails a test.
    const samples = {
      windows: ['App_0.2.1_x64-setup.exe'],
      macos: ['App_0.2.1_aarch64.dmg'],
    };
    for (const [platform, names] of Object.entries(samples)) {
      for (const name of names) {
        expect(classifyAsset(name)).toBe(platform);
        expect(PLATFORM_ORDER[platform]).toContain(assetLabel(name));
      }
    }
  });

  it('carries the sha256 of every artifact', () => {
    const index = build(['App_0.2.1_x64-setup.exe']);
    expect(index.platforms.windows[0].sha256).toBe(HASH);
  });

  it('refuses a download with no sha256 instead of listing it', () => {
    expect(() =>
      buildDownloadsIndex({
        version: '0.2.1',
        files: [{ name: 'App_0.2.1_x64-setup.exe' }],
        base: BASE,
      })
    ).toThrow(/sha256/);
  });

  it('accepts only a lowercase hex sha256', () => {
    expect(isSha256(HASH)).toBe(true);
    expect(isSha256(HASH.toUpperCase())).toBe(false);
    expect(isSha256('abc')).toBe(false);
    expect(isSha256(null)).toBe(false);
  });

  it('tolerates a missing file list', () => {
    expect(build(undefined).platforms).toEqual({ windows: [], macos: [] });
  });
});

describe('merging a built index into the live one', () => {
  const live = {
    version: '0.2.1',
    platforms: {
      windows: [{ label: 'EXE installer', url: 'https://cdn/w0.2.1.exe', sha256: 'b'.repeat(64) }],
      macos: [{ label: 'Disk image', url: 'https://cdn/m0.2.1.dmg', sha256: 'c'.repeat(64) }],
    },
  };

  it('replaces only the platform the new index built, keeping the others', () => {
    // The load-bearing case: a partial build must not erase the other platform's
    // download that another producer put in the bucket.
    const merged = mergeDownloadsIndex(live, build(['App_0.3.0_x64-setup.exe'], '0.3.0'));

    expect(merged.version).toBe('0.3.0');
    expect(merged.platforms.windows[0].url).toBe(`${BASE}/App_0.3.0_x64-setup.exe`);
    expect(merged.platforms.macos).toEqual(live.platforms.macos);
  });

  it('lists only the platforms that have a download, live or new', () => {
    const merged = mergeDownloadsIndex(null, build(['App_0.3.0_x64-setup.exe'], '0.3.0'));
    expect(Object.keys(merged.platforms)).toEqual(['windows']);
  });

  it('drops a live entry with no sha256 instead of signing it', () => {
    // Carrying an unverifiable entry forward would turn it into a signed one, and
    // the site would have no hash to check the bytes against.
    const unsafe = {
      version: '0.2.1',
      platforms: { windows: [{ label: 'EXE installer', url: 'https://cdn/planted.exe' }] },
    };

    const merged = mergeDownloadsIndex(unsafe, build(['App_0.3.0_aarch64.dmg'], '0.3.0'));

    expect(merged.platforms.windows).toBeUndefined();
    expect(merged.platforms.macos[0].url).toBe(`${BASE}/App_0.3.0_aarch64.dmg`);
  });
});
