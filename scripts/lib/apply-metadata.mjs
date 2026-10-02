/**
 * How a metadata edit is decided, extracted from publish-metadata.mjs so it can
 * be tested without R2 credentials or a network.
 *
 * The subtlety worth testing: the catalog and the manifest are two independent
 * copies of the same fields, and they drift. A publisher that compared only the
 * catalog would report "no change" while leaving a stale display name in the
 * manifest, where every client that resolves a build without the catalog would
 * still read it.
 */

/**
 * Decide what to write for each requested change.
 *
 * @param {object} entry    the game's catalog entry, mutated in place
 * @param {object} manifest the game's manifest, mutated in place
 * @param {Array}  changes  [{ label, catalog, manifest, value }]
 * @returns {Array} one entry per document that actually moved
 */
export function applyMetadataChanges(entry, manifest, changes) {
  const applied = [];

  for (const change of changes) {
    const previous = entry[change.catalog];
    const before = Array.isArray(previous) ? previous.join(', ') : (previous ?? '');
    const after = Array.isArray(change.value) ? change.value.join(', ') : change.value;

    const previousManifest = change.manifest ? manifest[change.manifest] : undefined;
    const beforeManifest = previousManifest ?? '';
    const catalogChanged = before !== after;
    const manifestChanged = Boolean(change.manifest) && beforeManifest !== after;

    // Skipping only when both destinations already agree is the whole point: a
    // catalog-only comparison silently leaves the manifest stale.
    if (!catalogChanged && !manifestChanged) continue;

    entry[change.catalog] = change.value;
    if (change.manifest) manifest[change.manifest] = change.value;

    // Name the document that moved, so the operator can tell which copy changed.
    applied.push({
      label: catalogChanged ? change.label : `${change.label} (manifest)`,
      before: catalogChanged ? before : beforeManifest,
      after,
    });
  }

  return applied;
}
