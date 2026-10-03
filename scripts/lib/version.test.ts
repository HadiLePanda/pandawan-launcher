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

function fixture({ json = '0.1.0', toml = '0.1.0' } = {}) {
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
  return root;
}

describe('version reading', () => {
  it('reads the package version from the [package] section, not a dependency', () => {
    expect(readVersion('src-tauri/Cargo.toml', CARGO)).toBe('0.1.0');
  });

  it('reads the first version field of a JSON file', () => {
    expect(readVersion('package.json', '{\n  "version": "1.2.3"\n}')).toBe('1.2.3');
  });

  it('reports a missing field as null rather than guessing', () => {
    expect(readVersion('package.json', '{\n  "name": "x"\n}')).toBe(null);
  });
});

describe('version parity', () => {
  it('passes when all three files agree', () => {
    expect(checkVersions(fixture()).ok).toBe(true);
  });

  it('fails when one file drifted', () => {
    const { ok, versions } = checkVersions(fixture({ toml: '0.2.0' }));
    expect(ok).toBe(false);
    expect(versions['src-tauri/Cargo.toml']).toBe('0.2.0');
  });
});

describe('version writing', () => {
  it('writes all three and leaves the rest of the file alone', () => {
    const root = fixture();
    const { changed } = writeVersion('0.2.0', root);
    expect(changed).toHaveLength(3);
    expect(checkVersions(root).ok).toBe(true);
    expect(readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8')).toContain(
      'tauri = { version = "2.0.0" }'
    );
  });

  it('reports no change when already at the target version', () => {
    const root = fixture();
    expect(writeVersion('0.1.0', root).changed).toEqual([]);
  });

  it('refuses a version that is not semver', () => {
    expect(() => writeVersion('0.2', fixture())).toThrow(/semver/);
  });
});
