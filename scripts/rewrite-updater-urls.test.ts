import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// The CI step runs this script with --from-config AND --assets, which is the
// combination that used to die on a ReferenceError before it rewrote anything.
const SCRIPT = path.resolve(process.cwd(), 'scripts', 'rewrite-updater-urls.mjs');
const BASE = 'https://pub-test.r2.dev/launcher/';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'rewrite-'));
  const write = (name, value) => {
    const file = path.join(root, name);
    writeFileSync(file, JSON.stringify(value, null, 2));
    return file;
  };

  const latest = write('latest.json', {
    version: '0.2.0',
    platforms: {
      'windows-x86_64': {
        signature: 'sig',
        url: 'https://github.com/o/r/releases/download/v0.2.0/Pandawan.Launcher_0.2.0_x64-setup.exe',
      },
      // The id form: macOS URLs point at a release asset id, not a filename.
      'darwin-aarch64': {
        signature: 'sig',
        url: 'https://api.github.com/repos/o/r/releases/assets/123',
      },
    },
  });
  const config = write('tauri.conf.json', {
    plugins: { updater: { endpoints: [`${BASE}latest.json`] } },
  });
  const assets = write('assets.json', [{ id: 123, name: 'Pandawan-Launcher-0.2.0.app.tar.gz' }]);
  return { latest, config, assets, out: path.join(root, 'out.json') };
}

describe('rewrite updater urls', () => {
  it('rewrites both a filename url and an asset-id url, with --assets passed', () => {
    const { latest, config, assets, out } = fixture();

    execFileSync('node', [SCRIPT, latest, '--from-config', config, '--assets', assets, out], {
      stdio: 'pipe',
    });

    const rewritten = JSON.parse(readFileSync(out, 'utf-8'));
    expect(rewritten.platforms['windows-x86_64'].url).toBe(
      `${BASE}Pandawan.Launcher_0.2.0_x64-setup.exe`
    );
    expect(rewritten.platforms['darwin-aarch64'].url).toBe(
      `${BASE}Pandawan-Launcher-0.2.0.app.tar.gz`
    );
    expect(rewritten.version).toBe('0.2.0');
  });
});
