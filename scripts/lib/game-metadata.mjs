/**
 * Reading a game current metadata for the publishing dashboard.
 *
 * Split out of dashboard.mjs so it can be tested without a server holding R2
 * credentials.
 */

import { IMAGE_FIELDS } from './metadata-fields.mjs';

function artPreviewUrl(value, cdnOrigin) {
  const text = (Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')).trim();
  if (!text || /^https?:\/\//i.test(text) || text.startsWith('/')) return text;
  return `${String(cdnOrigin).replace(/\/+$/, '')}/${text}`;
}

/**
 * Everything the metadata form needs to show the current truth for one channel.
 *
 * A game's presentation is split across two documents and they disagree more
 * often than you would expect: the catalog carries the publisher's display
 * fields, the manifest carries whatever the build was published with. The
 * launcher prefers the catalog and falls back to the manifest, so that precedence
 * is reproduced here exactly - otherwise the form would show one value and the
 * launcher would render another, which is exactly the confusion this panel
 * exists to remove.
 *
 * `source` records where each displayed value came from, which is what lets the
 * panel label a field as inherited rather than pretending the catalog owns it.
 */
export async function readGameMetadata(gameId, channel, { cdnOrigin, fields }) {
  const [catalog, manifest] = await Promise.all([
    fetchJson(`${cdnOrigin}/launcher/catalog.json`),
    fetchJson(`${cdnOrigin}/games/${gameId}/${channel}/manifest.json`),
  ]);

  const entry = (catalog?.games ?? []).find((game) => game && game.id === gameId) ?? null;
  const hasManifest = Boolean(manifest);

  if (!entry && !hasManifest) {
    // Nothing to edit. Said plainly rather than as an empty form, which would
    // let someone fill in metadata for a game that was never published.
    return {
      exists: false,
      hasManifest: false,
      hasCatalogEntry: false,
      gameId,
      channel,
      fields: {},
      missing: ['catalog entry', 'manifest'],
    };
  }

  const merged = {};
  for (const field of fields) {
    const fromCatalog = entry?.[field.catalog];
    const fromManifest = field.manifest ? manifest?.[field.manifest] : undefined;

    const present = (value) => value !== undefined && value !== null && value !== '';
    let value = '';
    let source = 'empty';
    // Same order the launcher uses in resolveGameInfo: catalog wins, manifest is
    // the fallback.
    if (present(fromCatalog)) {
      value = fromCatalog;
      source = 'catalog';
    } else if (present(fromManifest)) {
      value = fromManifest;
      source = 'manifest';
    }

    merged[field.flag] = {
      label: field.label,
      list: Boolean(field.list),
      // Lists are joined for editing so the input can be displayed and re-sent
      // as-is without the operator retyping the separators.
      value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
      source,
      // A value the launcher is already rendering but which the catalog does not
      // own. Worth surfacing: it is why an edit here may appear to do nothing.
      inherited: source === 'manifest',
      // Display only; `value` above is what gets saved.
      previewUrl: field.flag in IMAGE_FIELDS ? artPreviewUrl(value, cdnOrigin) : undefined,
    };
  }

  const publishedChannel = entry?.channel ?? null;
  const latest = await fetchJson(`${cdnOrigin}/games/${gameId}/${channel}/latest.json`);

  return {
    exists: true,
    hasManifest,
    hasCatalogEntry: Boolean(entry),
    gameId,
    channel,
    // A catalog entry on a different channel is a real trap: the operator edits
    // alpha, but the launcher reads the entry's own channel, so the change would
    // not appear until that channel is resolved.
    publishedChannel,
    channelMismatch: Boolean(publishedChannel && publishedChannel !== channel),
    versions: latest ?? null,
    fields: merged,
    missing: [hasManifest ? null : 'manifest', entry ? null : 'catalog entry'].filter(Boolean),
  };
}

/** Fetch a JSON document, or null when it is absent or unparseable. */
export async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
