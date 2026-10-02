import { describe, it, expect } from 'vitest';

import { applyMetadataChanges } from './apply-metadata.mjs';

const nameField = {
  flag: 'name',
  catalog: 'name',
  manifest: 'name',
  label: 'Display name',
};

const genreField = { flag: 'genre', catalog: 'genre', manifest: null, label: 'Genres', list: true };

describe('applying metadata changes', () => {
  it('writes to both the catalog and the manifest', () => {
    const entry = { name: 'wrong' };
    const manifest = { name: 'wrong' };

    const applied = applyMetadataChanges(entry, manifest, [{ ...nameField, value: 'Misspell' }]);

    expect(entry.name).toBe('Misspell');
    expect(manifest.name).toBe('Misspell');
    expect(applied).toHaveLength(1);
  });

  it('repairs a manifest that drifted while the catalog was already correct', () => {
    // The real bug this guards: the catalog was fixed by hand, the manifest was
    // not, and a catalog-only comparison reported "no change". Every client
    // resolving a build without the catalog kept rendering the stale name.
    const entry = { name: 'Misspell' };
    const manifest = { name: 'misspell' };

    const applied = applyMetadataChanges(entry, manifest, [{ ...nameField, value: 'Misspell' }]);

    expect(manifest.name).toBe('Misspell');
    expect(applied).toHaveLength(1);
    // The log has to name the document that actually moved, or the operator
    // cannot tell which copy was repaired.
    expect(applied[0].label).toBe('Display name (manifest)');
    expect(applied[0].before).toBe('misspell');
  });

  it('reports nothing when both documents already hold the value', () => {
    const entry = { name: 'Misspell' };
    const manifest = { name: 'Misspell' };

    const applied = applyMetadataChanges(entry, manifest, [{ ...nameField, value: 'Misspell' }]);

    // Re-publishing an unchanged field must stay a no-op, so a dashboard that
    // sends everything on save does not churn the bucket for nothing.
    expect(applied).toEqual([]);
  });

  it('treats a missing manifest value as empty rather than skipping it', () => {
    const entry = { name: 'Misspell' };
    const manifest = {};

    const applied = applyMetadataChanges(entry, manifest, [{ ...nameField, value: 'Misspell' }]);

    expect(manifest.name).toBe('Misspell');
    expect(applied).toHaveLength(1);
  });

  it('never writes to the manifest for a catalog-only field', () => {
    const entry = { genre: [] };
    const manifest = {};

    applyMetadataChanges(entry, manifest, [{ ...genreField, value: ['Party', 'Puzzle'] }]);

    expect(entry.genre).toEqual(['Party', 'Puzzle']);
    // genre has no manifest counterpart; inventing one would add a field the
    // backend does not read.
    expect(Object.keys(manifest)).toEqual([]);
  });

  it('compares list values by content, not by array identity', () => {
    const entry = { genre: ['Party', 'Puzzle'] };
    const manifest = {};

    const applied = applyMetadataChanges(entry, manifest, [
      { ...genreField, value: ['Party', 'Puzzle'] },
    ]);

    expect(applied).toEqual([]);
  });
});
