import { describe, expect, it } from 'vitest';

import {
  buildDownloadsIndex,
  classifyAsset,
  assetLabel,
  PLATFORM_ORDER,
} from './downloads-index.mjs';

const BASE = 'https://cdn.example.com/launcher';

const build = (files, version = '0.2.1') => buildDownloadsIndex({ version, files, base: BASE });

describe('asset classification', () => {
  it('classifies every installer extension', () => {
    expect(classifyAsset('App_0.2.1_x64.msi')).toBe('windows');
    expect(classifyAsset('App_0.2.1_x64-setup.exe')).toBe('windows');
    expect(classifyAsset('App_0.2.1_aarch64.dmg')).toBe('macos');
    expect(classifyAsset('App_aarch64.app.tar.gz')).toBe('macos');
    expect(classifyAsset('app_0.2.1_amd64.deb')).toBe('linux');
    expect(classifyAsset('app-0.2.1-1.x86_64.rpm')).toBe('linux');
  });

  it('returns null for something that is not a downloadable build', () => {
    expect(classifyAsset('latest.json')).toBe(null);
    expect(classifyAsset('assets-compact.json')).toBe(null);
    expect(classifyAsset('App_0.2.1_x64.msi.sig')).toBe(null);
  });

  it('labels each artifact type the way the page shows it', () => {
    expect(assetLabel('App_0.2.1_x64.msi')).toBe('MSI installer');
    expect(assetLabel('App_0.2.1_x64-setup.exe')).toBe('EXE installer');
    expect(assetLabel('App_0.2.1_aarch64.dmg')).toBe('Disk image');
    expect(assetLabel('App_aarch64.app.tar.gz')).toBe('App archive');
    expect(assetLabel('app_0.2.1_amd64.deb')).toBe('Debian / Ubuntu');
    expect(assetLabel('app-0.2.1-1.x86_64.rpm')).toBe('Fedora / RHEL');
  });
});

describe('downloads index', () => {
  const full = [
    'App_0.2.1_x64-setup.exe',
    'App_0.2.1_x64_en-US.msi',
    'App_0.2.1_aarch64.dmg',
    'App_aarch64.app.tar.gz',
    'app_0.2.1_amd64.deb',
    'app-0.2.1-1.x86_64.rpm',
  ];

  it('carries the version through', () => {
    expect(build(full).version).toBe('0.2.1');
    expect(build(full, '9.9.9').version).toBe('9.9.9');
  });

  it('groups each artifact under its platform with its label', () => {
    const index = build(full);
    expect(index.platforms.windows.map((i) => i.label)).toEqual(['MSI installer', 'EXE installer']);
    expect(index.platforms.macos.map((i) => i.label)).toEqual(['Disk image', 'App archive']);
    expect(index.platforms.linux.map((i) => i.label)).toEqual(['Debian / Ubuntu', 'Fedora / RHEL']);
  });

  it('builds the URL under the given base and percent-encodes the name', () => {
    const index = build(['App 0.2.1 x64.msi']);
    expect(index.platforms.windows[0].url).toBe(`${BASE}/App%200.2.1%20x64.msi`);
  });

  it('leads each platform with the installer a person wants, whatever order the files arrive in', () => {
    // The website takes items[0] as the download to offer, so this is the
    // load-bearing assertion: shuffled input, and macOS must not lead with the
    // updater tarball.
    const index = build([
      'App_aarch64.app.tar.gz',
      'App_0.2.1_aarch64.dmg',
      'App_0.2.1_x64-setup.exe',
      'App_0.2.1_x64_en-US.msi',
      'app-0.2.1-1.x86_64.rpm',
      'app_0.2.1_amd64.deb',
    ]);
    expect(index.platforms.windows[0].label).toBe('MSI installer');
    expect(index.platforms.macos[0].label).toBe('Disk image');
    expect(index.platforms.linux[0].label).toBe('Debian / Ubuntu');
  });

  it('has an empty group for a platform with no artifacts', () => {
    const index = build(['App_0.2.1_x64_en-US.msi']);
    expect(index.platforms.windows.map((i) => i.label)).toEqual(['MSI installer']);
    expect(index.platforms.macos).toEqual([]);
    expect(index.platforms.linux).toEqual([]);
  });

  it('excludes signatures, latest.json and the CI asset map', () => {
    const index = build([
      'App_0.2.1_x64_en-US.msi',
      'App_0.2.1_x64_en-US.msi.sig',
      'latest.json',
      'assets-compact.json',
    ]);
    expect(index.platforms.windows).toHaveLength(1);
    expect(index.platforms.windows[0].label).toBe('MSI installer');
  });

  it('ignores a file extension it does not recognise instead of guessing a platform', () => {
    const index = build(['App_0.2.1_x64.msi', 'App_0.2.1_arm64.pkg', 'App.AppImage']);
    expect(index.platforms.windows.map((i) => i.label)).toEqual(['MSI installer']);
    expect(index.platforms.macos).toEqual([]);
    expect(index.platforms.linux).toEqual([]);
  });

  it('has a deliberate position for every label its own classifier can produce', () => {
    // buildDownloadsIndex throws on a label missing from PLATFORM_ORDER; this
    // proves that guard is unreachable for the extensions the classifier knows,
    // so adding one to classifyAsset without ordering it fails a test.
    const samples = {
      windows: ['App_0.2.1_x64.msi', 'App_0.2.1_x64-setup.exe'],
      macos: ['App_0.2.1_aarch64.dmg', 'App_aarch64.app.tar.gz'],
      linux: ['app_0.2.1_amd64.deb', 'app-0.2.1-1.x86_64.rpm'],
    };
    for (const [platform, names] of Object.entries(samples)) {
      for (const name of names) {
        expect(classifyAsset(name)).toBe(platform);
        expect(PLATFORM_ORDER[platform]).toContain(assetLabel(name));
      }
    }
  });

  it('tolerates a missing file list', () => {
    expect(build(undefined).platforms).toEqual({ windows: [], macos: [], linux: [] });
  });
});
