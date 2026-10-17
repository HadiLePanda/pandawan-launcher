import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { indexEntries, indexEntriesIn, sha256OfFile } from './index-assets.mjs';

describe('download index assets', () => {
  it('hashes the file bytes, not its name', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'index-assets-'));
    const file = path.join(dir, 'app.msi');
    writeFileSync(file, 'installer');
    const expected = createHash('sha256').update('installer').digest('hex');

    expect(sha256OfFile(file)).toBe(expected);
    expect(indexEntries(dir, ['app.msi'])).toEqual([{ name: 'app.msi', sha256: expected }]);
  });

  it('lists regular files and skips directories', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'index-assets-'));
    writeFileSync(path.join(dir, 'app.deb'), 'deb');
    mkdirSync(path.join(dir, 'nested'));

    expect(indexEntriesIn(dir).map((entry) => entry.name)).toEqual(['app.deb']);
  });
});
