import { describe, it, expect } from 'vitest';

import {
  artworkObjectName,
  describeArtwork,
  formatBytes,
  MAX_ARTWORK_BYTES,
  safeLocalName,
  selectArtworkObjects,
  sortArtwork,
  validateArtwork,
} from './artwork.mjs';

const CDN = 'https://cdn.test';
const PREFIX = 'games/misspell/alpha';

const listed = (key: string, extra: Record<string, unknown> = {}) => ({ key, ...extra });

describe('choosing where an upload is stored', () => {
  it('keeps the extension of the chosen file instead of forcing png', () => {
    // A JPEG stored as .png is uploaded with a Content-Type that does not match
    // its bytes, and renders unpredictably or not at all.
    const name = artworkObjectName({
      baseName: 'icon',
      hash: 'ab12cd34',
      fileName: 'my icon.JPG',
      fallbackName: 'icon.png',
    });

    expect(name).toBe('icon-ab12cd34.jpg');
  });

  it('falls back to the contract name when the file has no extension', () => {
    // The stem comes from IMAGE_FIELDS, so a file called "logo" still lands on the
    // icon rather than being published as "logo".
    const name = artworkObjectName({
      baseName: 'banner',
      hash: 'ffff0000',
      fileName: 'banner',
      fallbackName: 'banner.png',
    });

    expect(name).toBe('banner-ffff0000.png');
  });
});

describe('validating a chosen file', () => {
  it('accepts a normal image', () => {
    expect(validateArtwork({ fileName: 'icon.png', sizeBytes: 2048 })).toEqual({
      error: null,
      name: 'icon.png',
    });
  });

  it('refuses an svg', () => {
    // An SVG served from a bucket can carry script and is rendered through <img>
    // from a remote origin. The SVG placeholders ship inside the bundle instead.
    expect(validateArtwork({ fileName: 'logo.svg', sizeBytes: 10 }).error).toContain('Unsupported');
  });

  it('refuses an empty file rather than publishing a broken image', () => {
    expect(validateArtwork({ fileName: 'icon.png', sizeBytes: 0 }).error).toBe(
      'The file is empty.'
    );
  });

  it('refuses a file past the size limit and says what the limit is', () => {
    const result = validateArtwork({
      fileName: 'banner.png',
      sizeBytes: MAX_ARTWORK_BYTES + 1,
    });

    expect(result.error).toContain('the limit is');
  });
});

describe('staging names', () => {
  it('keeps only the basename so a path cannot escape the staging directory', () => {
    expect(safeLocalName('../../../windows/system32/evil.png')).toBe('evil.png');
    expect(safeLocalName('C:\\Users\\me\\icon.png')).toBe('icon.png');
  });

  it('disarms characters that have no business in an object key', () => {
    expect(safeLocalName('my icon (final).png')).toBe('my-icon--final-.png');
  });

  it('never returns an empty name for a name made entirely of separators', () => {
    // An empty name would resolve to the staging directory itself and the write
    // below it would fail in a way the operator cannot act on.
    expect(safeLocalName('///')).toBe('artwork');
  });
});

describe('byte formatting', () => {
  it('scales to a readable unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('says nothing for a size the bucket did not report', () => {
    // A listing can omit the size column; an invented 0 B would read as a real
    // measurement and invite a pointless re-upload.
    expect(formatBytes(undefined)).toBe('');
    expect(formatBytes(-1)).toBe('');
  });
});

describe('listing what is published', () => {
  const keys = [
    listed(`${PREFIX}/manifest.json`, { size: 900 }),
    listed(`${PREFIX}/icon-11111111.png`, { size: 12_000, lastModified: '2026-09-01' }),
    listed(`${PREFIX}/banner-22222222.png`, { size: 3_000_000, lastModified: '2026-10-01' }),
    // A build's own textures must not be offered as the game's banner.
    listed(`${PREFIX}/0.4.0/data/tex/logo.png`, { size: 400 }),
    listed(`${PREFIX}/0.4.0/Game.exe`, { size: 900 }),
    listed('games/other/alpha/icon-33333333.png', { size: 10 }),
  ];

  const objects = selectArtworkObjects(keys, { prefix: PREFIX, cdnOrigin: CDN });

  it('reports only images sitting directly in the channel directory', () => {
    expect(objects.map((o) => o.name).sort()).toEqual(['banner-22222222.png', 'icon-11111111.png']);
  });

  it('gives each object a URL players can actually load', () => {
    const icon = objects.find((o) => o.name.startsWith('icon'));
    expect(icon?.url).toBe(`${CDN}/games/misspell/alpha/icon-11111111.png`);
  });

  it('reports a readable size rather than raw bytes', () => {
    const banner = objects.find((o) => o.name.startsWith('banner'));
    expect(banner?.size).toBe('2.9 MB');
  });

  it('does not double the slash when the origin already ends in one', () => {
    const withSlash = selectArtworkObjects(keys, { prefix: PREFIX, cdnOrigin: `${CDN}/` });
    expect(withSlash[0].url.startsWith(`${CDN}//`)).toBe(false);
  });

  it('returns nothing rather than failing for a game that has no art', () => {
    const empty = selectArtworkObjects([listed(`${PREFIX}/manifest.json`)], {
      prefix: PREFIX,
      cdnOrigin: CDN,
    });

    expect(empty).toEqual([]);
  });
});

describe('saying which field each image belongs to', () => {
  const objects = selectArtworkObjects(
    [
      listed(`${PREFIX}/icon-11111111.png`, { lastModified: '2026-09-01' }),
      listed(`${PREFIX}/banner-22222222.png`, { lastModified: '2026-10-01' }),
      listed(`${PREFIX}/shot-33333333.png`, { lastModified: '2026-08-01' }),
    ],
    { prefix: PREFIX, cdnOrigin: CDN }
  );

  it('marks the image a field points at', () => {
    // Without this the operator cannot tell which of several hash-named files
    // players are seeing, because the bucket records nothing about the mapping.
    const described = describeArtwork(objects, {
      'icon-url': `${CDN}/games/misspell/alpha/icon-11111111.png`,
      'banner-url': `/${PREFIX}/banner-22222222.png`,
      screenshots: `${PREFIX}/shot-33333333.png`,
    });

    const byName = Object.fromEntries(described.map((o) => [o.name, o]));
    expect(byName['icon-11111111.png'].field).toBe('icon-url');
    expect(byName['icon-11111111.png'].inUse).toBe(true);
    expect(byName['shot-33333333.png'].inUse).toBe(true);
  });

  it('matches a URL stored the documented way, as a relative path', () => {
    // Relative is how catalog entries are normally written, so an exact compare
    // against the absolute object URL would label the live banner as unused.
    const described = describeArtwork(objects, {
      'banner-url': `/${PREFIX}/banner-22222222.png`,
    });
    const banner = described.find((o) => o.name.startsWith('banner'));

    expect(banner?.inUse).toBe(true);
  });

  it('leaves a superseded image in the list but marked unused', () => {
    // Content-addressed names accumulate, so the old picture stays valid forever.
    // It has to be visible as "not in use", not hidden, or the operator cannot
    // tell which of these players are seeing.
    const described = describeArtwork(objects, {
      'icon-url': `${CDN}/${PREFIX}/icon-11111111.png`,
    });
    const old = described.find((o) => o.name.startsWith('shot'));

    expect(old?.inUse).toBe(false);
    expect(old?.field).toBeNull();
  });

  it('leaves everything unused when no field is set', () => {
    const described = describeArtwork(objects, { 'icon-url': '', 'banner-url': '' });
    expect(described.every((o) => o.inUse === false)).toBe(true);
  });

  it('orders the newest upload first', () => {
    const sorted = sortArtwork(objects);
    expect(sorted[0].name).toBe('banner-22222222.png');
  });
});
