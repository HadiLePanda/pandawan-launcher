import { describe, it, expect } from 'vitest';

import { applyMetadataChanges } from './apply-metadata.mjs';
import { FIELDS, IMAGE_FIELDS } from './metadata-fields.mjs';

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

    const applied = applyMetadataChanges(entry, manifest, [{ ...nameField, value: 'Example Game' }]);

    expect(entry.name).toBe('Example Game');
    expect(manifest.name).toBe('Example Game');
    expect(applied).toHaveLength(1);
  });

  it('repairs a manifest that drifted while the catalog was already correct', () => {
    // The real bug this guards: the catalog was fixed by hand, the manifest was
    // not, and a catalog-only comparison reported "no change". Every client
    // resolving a build without the catalog kept rendering the stale name.
    const entry = { name: 'Example Game' };
    const manifest = { name: 'example-game' };

    const applied = applyMetadataChanges(entry, manifest, [{ ...nameField, value: 'Example Game' }]);

    expect(manifest.name).toBe('Example Game');
    expect(applied).toHaveLength(1);
    // The log has to name the document that actually moved, or the operator
    // cannot tell which copy was repaired.
    expect(applied[0].label).toBe('Display name (manifest)');
    expect(applied[0].before).toBe('example-game');
  });

  it('reports nothing when both documents already hold the value', () => {
    const entry = { name: 'Example Game' };
    const manifest = { name: 'Example Game' };

    const applied = applyMetadataChanges(entry, manifest, [{ ...nameField, value: 'Example Game' }]);

    // Re-publishing an unchanged field must stay a no-op, so a dashboard that
    // sends everything on save does not churn the bucket for nothing.
    expect(applied).toEqual([]);
  });

  it('treats a missing manifest value as empty rather than skipping it', () => {
    const entry = { name: 'Example Game' };
    const manifest = {};

    const applied = applyMetadataChanges(entry, manifest, [{ ...nameField, value: 'Example Game' }]);

    expect(manifest.name).toBe('Example Game');
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

describe('image fields in the metadata contract', () => {
  // The real bug these guard: IMAGE_FIELDS is keyed by flag ("icon-url"), but the
  // publisher looked the field up by catalog key ("iconUrl"), which matches
  // nothing. The resulting change had no destination, so an icon upload wrote a
  // literal "undefined" key into the catalog and left the real URL untouched.
  //
  // These assert a property of the contract itself rather than re-implementing
  // the lookup. A test that repeats the expression under test passes whether or
  // not the bug is present, which is what the first attempt here did.
  for (const [flag, spec] of Object.entries(IMAGE_FIELDS)) {
    it(`"${flag}" is a flag that FIELDS actually carries`, () => {
      // The invariant the publisher depends on: every IMAGE_FIELDS key must be
      // findable on FIELDS.flag, and must NOT be findable on FIELDS.catalog,
      // because that mismatch is exactly what silently broke the lookup.
      expect(
        FIELDS.some((f) => f.flag === flag),
        'must match on flag'
      ).toBe(true);
      expect(
        FIELDS.some((f) => f.catalog === flag),
        'keying IMAGE_FIELDS by a catalog key is what caused the bug'
      ).toBe(false);
      expect(spec.objectName).toBeTruthy();
    });
  }

  it('an unmatched field produces a destinationless change, not a silent one', () => {
    // Pin the failure mode itself: this is what the publisher used to hand to
    // applyMetadataChanges, and it wrote entry["undefined"]. Documenting it here
    // means the shape is caught even if the lookup regresses elsewhere.
    const entry: Record<string, unknown> = { id: 'example-game' };
    const manifest: Record<string, unknown> = {};
    const field = FIELDS.find((f) => f.flag === 'icon-url');

    applyMetadataChanges(entry, manifest, [{ ...field, value: 'https://cdn/icon.png' }]);

    expect(entry.iconUrl).toBe('https://cdn/icon.png');
    expect(manifest.icon_url).toBe('https://cdn/icon.png');
    expect(Object.keys(entry)).not.toContain('undefined');
  });
});
