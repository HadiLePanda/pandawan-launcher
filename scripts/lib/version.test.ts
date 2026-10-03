import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkVersions, readVersion, writeVersion } from './version.mjs';

const CARGO = `[package]
name = "pandawan-launcher"
version = "0.1.0"
edition = "2021"

[dependencies]
tauri = { version = "2.0.0" }
serde = "1"
`;

const LOCK = `version = 4

[[package]]
name = "serde"
version = "1.0.200"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "pandawan-launcher"
version = "0.1.0"
dependencies = [
 "serde",
]
`;

function fixture({ json = '0.1.0', toml = '0.1.0', lock = '0.1.0' } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'version-'));
  writeFileSync(path.join(root, 'package.json'), `{\n  "name": "x",\n  "version": "${json}"\n}\n`);
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  writeFileSync(
    path.join(root, 'src-tauri', 'tauri.conf.json'),
    `{\n  "$schema": "s",\n  "version": "${json}"\n}\n`
  );
  writeFileSync(
    path.join(root, 'src-tauri', 'Cargo.toml'),
    toml === '0.1.0' ? CARGO : CARGO.replace('"0.1.0"', `"${toml}"`)
  );
  writeFileSync(
    path.join(root, 'src-tauri', 'Cargo.lock'),
    lock === '0.1.0'
      ? LOCK
      : LOCK.replace(
          'name = "pandawan-launcher"\nversion = "0.1.0"',
          `name = "pandawan-launcher"\nversion = "${lock}"`
        )
  );
  return root;
}

describe('version reading', () => {
  it('reads the package version from the [package] section, not a dependency', () => {
    expect(readVersion('src-tauri/Cargo.toml', CARGO)).toBe('0.1.0');
  });

  it('reads our crate version from the lock, not a dependency in the same file', () => {
    expect(readVersion('src-tauri/Cargo.lock', LOCK)).toBe('0.1.0');
  });

  it('reads the first version field of a JSON file', () => {
    expect(readVersion('package.json', '{\n  "version": "1.2.3"\n}')).toBe('1.2.3');
  });

  it('reports a missing field as null rather than guessing', () => {
    expect(readVersion('package.json', '{\n  "name": "x"\n}')).toBe(null);
  });
});

describe('version parity', () => {
  it('passes when all four files agree', () => {
    expect(checkVersions(fixture()).ok).toBe(true);
  });

  it('fails when the lock has drifted, which is how a release used to slip', () => {
    const { ok, versions } = checkVersions(fixture({ lock: '0.0.9' }));
    expect(ok).toBe(false);
    expect(versions['src-tauri/Cargo.lock']).toBe('0.0.9');
  });

  it('fails when one file drifted', () => {
    const { ok, versions } = checkVersions(fixture({ toml: '0.2.0' }));
    expect(ok).toBe(false);
    expect(versions['src-tauri/Cargo.toml']).toBe('0.2.0');
  });
});

describe('version writing', () => {
  it('writes all four and leaves the rest of the files alone', () => {
    const root = fixture();
    const { changed } = writeVersion('0.2.0', root);
    expect(changed).toHaveLength(4);
    expect(checkVersions(root).ok).toBe(true);
    expect(readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8')).toContain(
      'tauri = { version = "2.0.0" }'
    );
    // The lock carries a version for every dependency too: only ours may move.
    const lock = readFileSync(path.join(root, 'src-tauri', 'Cargo.lock'), 'utf8');
    expect(lock).toContain('name = "pandawan-launcher"\nversion = "0.2.0"');
    expect(lock).toContain('name = "serde"\nversion = "1.0.200"');
  });

  it('reports no change when already at the target version', () => {
    const root = fixture();
    expect(writeVersion('0.1.0', root).changed).toEqual([]);
  });

  it('refuses a version that is not semver', () => {
    expect(() => writeVersion('0.2', fixture())).toThrow(/semver/);
  });
});
