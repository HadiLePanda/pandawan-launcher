/**
 * Artwork naming, validation and listing.
 *
 * Objects are content-addressed (`icon-1a2b3c4d.png`) so a changed image lands on a
 * new URL: the CDN serves build bytes under an immutable one-year header, and a
 * stable name would leave clients stuck on the old picture forever.
 */

/** SVG is excluded: it renders through `<img>` from a remote origin, where it can carry script. */
const ARTWORK_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/** Largest upload accepted. Enough for a banner, small enough to bound memory. */
export const MAX_ARTWORK_BYTES = 12 * 1024 * 1024;

/** True when the path is a recognised image extension. */
function isArtworkExtension(name) {
  return ARTWORK_EXTENSIONS.includes(extensionOf(name));
}

/** The lowercase extension of a path, including the dot, or '' when it has none. */
function extensionOf(name) {
  const base = String(name ?? '')
    .split(/[\\/]/)
    .pop();
  const at = base.lastIndexOf('.');
  if (at <= 0) return '';
  return base.slice(at).toLowerCase();
}

/** The object name an upload is stored under, keeping the source file's extension. */
export function artworkObjectName({ baseName, hash, fileName, fallbackName }) {
  const fallbackExt = extensionOf(fallbackName) || '.png';
  const ext = extensionOf(fileName) || fallbackExt;
  const fallbackBase = fallbackName.slice(0, fallbackName.lastIndexOf('.')) || fallbackName;
  return `${baseName || fallbackBase}-${hash}${ext}`;
}

/** Returns `{ error }` rather than throwing: rejections are read in the operator's form. */
export function validateArtwork({ fileName, sizeBytes }) {
  if (!fileName || !String(fileName).trim()) return { error: 'No file was selected.' };
  if (!isArtworkExtension(fileName)) {
    return { error: `Unsupported image type. Use one of: ${ARTWORK_EXTENSIONS.join(', ')}.` };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return { error: 'The file is empty.' };
  if (sizeBytes > MAX_ARTWORK_BYTES) {
    return {
      error: `The file is ${formatBytes(sizeBytes)}; the limit is ${formatBytes(MAX_ARTWORK_BYTES)}.`,
    };
  }
  return { error: null, name: String(fileName).split(/[\\/]/).pop() };
}

/** Basename only, so a chosen filename cannot escape the staging directory. */
export function safeLocalName(fileName) {
  return (
    String(fileName ?? '')
      .split(/[\\/]/)
      .pop()
      .replace(/[^A-Za-z0-9._-]/g, '-')
      .replace(/^[.-]+/, '') || 'artwork'
  );
}

/** Bytes as a short human string, so the artwork list is readable. */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The artwork objects published directly under `prefix`.
 *
 * Only files in the directory itself count: a build's own files sit under a version
 * folder beneath it and are full of images, and descending would offer a game's
 * texture atlas as its banner.
 */
export function selectArtworkObjects(keys, { prefix, cdnOrigin }) {
  const head = `${prefix}/`;

  return (
    keys
      .map((entry) => String(entry?.key ?? ''))
      .filter((key) => key.startsWith(head))
      .map((key) => ({ key, name: key.slice(head.length) }))
      // No further slash: a version directory is a build, not art.
      .filter(({ name }) => !name.includes('/') && isArtworkExtension(name))
      .map(({ key, name }) => {
        const entry = keys.find((item) => item?.key === key) ?? {};
        return {
          key,
          name,
          url: `${String(cdnOrigin).replace(/\/+$/, '')}/${key}`,
          sizeBytes: Number(entry.size) || 0,
          size: formatBytes(entry.size),
          lastModified: entry.lastModified ?? null,
        };
      })
  );
}

/** Whether a stored URL points at this object. */
function references(value, object) {
  if (!value || !object?.key) return false;
  if (value === object.key) return true;
  if (value === object.url) return true;
  // A root-relative URL has no origin, so it can only match by key.
  return value === `/${object.key}` || value.endsWith(`/${object.key}`);
}

/**
 * Whether a stored value points at this object, by key, absolute URL or
 * relative path. Exported so a delete can prove an object is unreferenced
 * before removing it - the one decision that must match what the listing says.
 */
export function referencesObject(value, object) {
  return references(value, object);
}

/** A stored value as the individual references it may carry. */
function referenceCandidates(value) {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(',');
  return parts.map((part) => String(part).trim()).filter(Boolean);
}

/**
 * Attach each published image to the metadata field pointing at it.
 *
 * The bucket records no object-to-field mapping, so it is derived from the URLs
 * the form loaded. Without it a directory of hash-named files cannot be read.
 * A list field (screenshots) arrives comma-joined or as an array, so it is
 * split: otherwise the joined string matches no object and every screenshot
 * would read as unused.
 */
export function describeArtwork(objects, valuesByFlag) {
  const values = Object.entries(valuesByFlag ?? {}).flatMap(([flag, value]) =>
    referenceCandidates(value).map((one) => [flag, one])
  );

  return objects.map((object) => {
    const match = values.find(([, value]) => references(value, object));
    return { ...object, field: match?.[0] ?? null, inUse: Boolean(match) };
  });
}

/** Newest first, so the picture a player sees today leads the list. */
export function sortArtwork(objects) {
  return [...objects].sort(
    (a, b) =>
      String(b.lastModified ?? '').localeCompare(String(a.lastModified ?? '')) ||
      a.name.localeCompare(b.name)
  );
}
