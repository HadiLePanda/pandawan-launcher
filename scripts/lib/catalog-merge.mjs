/**
 * How a catalog publish is merged into the copy the CDN already serves.
 *
 * Pure, with no r2 import: it takes two plain documents and returns the one to
 * upload plus a report, so the transport stays dumb and this is testable without
 * credentials.
 *
 * The rule is additive in one direction only:
 *
 *   - a game the CDN already lists is authoritative and is left byte-identical,
 *   - a game the CDN has never seen is added from the local file,
 *   - a game the local file omits is NOT a removal. A stale local copy is not a
 *     delete request, and honouring it as one would make a live game vanish.
 *
 * `--force` inverts only the first rule. It deliberately does not resurrect a
 * delete: a script that rewrites the index every launcher reads must not be able
 * to make a published game disappear.
 */

/** True when two catalog field values are equal, by content rather than identity. */
function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Why a catalog document cannot be published, or null when it can.
 *
 * The messages are what an operator greps for in CI output. A malformed catalog
 * breaks every client, so this runs before anything is uploaded.
 *
 * The games array may legitimately be empty *for the merge* (it then adds
 * nothing); this rejection is the script's, not the merge's.
 */
export function validateCatalog(catalog) {
  if (!Array.isArray(catalog?.games) || catalog.games.length === 0) {
    return 'catalog.json has no games array (or it is empty).';
  }
  for (const game of catalog.games) {
    if (!game || typeof game.id !== 'string' || !game.id) {
      return 'catalog.json has a game entry without a valid id.';
    }
    if (!game.channel) {
      return `Game "${game.id}" has no channel; the launcher needs one to build its manifest URL.`;
    }
  }
  return null;
}

/**
 * The refusal printed when the published catalog cannot be read.
 *
 * Publishing from the local file alone would drop every game it does not list -
 * a total outage from a transient network error. Refusing is the only safe
 * answer, so this returns the message the caller exits through fail() with.
 */
export function remoteCatalogRefusal(url) {
  return `Could not read ${url}. Refusing to write a new catalog from scratch.`;
}

/**
 * How a CDN entry and a local entry disagree, split by direction so the report
 * says what was at stake rather than just that something differed.
 *
 * `differs` - a field both sides carry with different values - is the dangerous
 * list: a real CDN-side edit the local file would revert. `cdnOnly` is a field
 * only the CDN has, which an overwrite would blank. `localOnly` is the opposite
 * and NOT a save: an omission rather than a reversal, so it is excluded from the
 * "would have been reverted" count.
 *
 * Keys rather than a fixed field list, so a hand-added CDN field cannot be
 * reverted by a merge that checks only the fields it knows about.
 */
function describeConflict(cdn, local) {
  const differs = [];
  const cdnOnly = [];
  const localOnly = [];
  const fields = new Set([...Object.keys(cdn), ...Object.keys(local)]);
  for (const field of [...fields].sort()) {
    // The id is the join key and is equal by construction here.
    if (field === 'id') continue;
    if (!Object.hasOwn(local, field)) {
      cdnOnly.push(field);
      continue;
    }
    if (!Object.hasOwn(cdn, field)) {
      localOnly.push(field);
      continue;
    }
    if (sameValue(cdn[field], local[field])) continue;
    differs.push({ field, cdn: cdn[field], local: local[field] });
  }
  return { differs, cdnOnly, localOnly };
}

/**
 * Merge the local catalog into the published one.
 *
 * Pure: `remote` and `local` are only read, and the returned `games` array is a
 * fresh array holding the untouched CDN entry objects, so a caller cannot
 * corrupt the input by mutating it.
 *
 * @param remote the catalog as served today. Expected to have been checked with
 *   validateCatalog already; a malformed one is treated as "no games known".
 * @param local  public/catalog.json
 * @param options.force  apply the local entry over the CDN entry for games both
 *   know about. Additions and preservation are unchanged.
 * @param options.now    epoch ms, injectable so tests pin `lastUpdated`.
 * @returns {{catalog: object, added: Array, skipped: Array, preserved: Array, changed: boolean}}
 *   `skipped` entries carry `differs`/`cdnOnly` describing what an overwrite
 *   would have lost, and `forced` when --force applied the local entry.
 */
export function mergeCatalog(remote, local, { force = false, now = Date.now() } = {}) {
  const published = Array.isArray(remote?.games) ? remote.games : [];
  const merged = [...published];

  // Index by id so a duplicate in either document cannot be missed, and so an
  // entry without a usable id cannot become the key for a real one.
  const byId = new Map();
  for (const entry of merged) {
    if (entry && typeof entry.id === 'string' && entry.id) byId.set(entry.id, entry);
  }

  const added = [];
  const skipped = [];

  for (const entry of Array.isArray(local?.games) ? local.games : []) {
    const id = entry && typeof entry.id === 'string' && entry.id ? entry.id : null;

    // Unusable rather than unknown: reported, never merged. validateCatalog
    // rejects this upstream, so reaching it means the merge was handed
    // something the script had already promised not to publish.
    if (!id) {
      skipped.push({
        id: null,
        channel: entry?.channel ?? null,
        differs: [],
        cdnOnly: [],
        localOnly: [],
        forced: false,
      });
      continue;
    }

    const existing = byId.get(id);
    if (!existing) {
      merged.push(entry);
      byId.set(id, entry);
      added.push({ id, channel: entry.channel ?? null });
      continue;
    }

    const { differs, cdnOnly, localOnly } = describeConflict(existing, entry);

    if (force) {
      const at = merged.indexOf(existing);
      merged[at] = entry;
      byId.set(id, entry);
    }

    skipped.push({
      id,
      channel: existing.channel ?? entry.channel ?? null,
      differs,
      cdnOnly,
      localOnly,
      forced: Boolean(force),
    });
  }

  // Everything the CDN lists that the local file did not mention. Kept, always:
  // see the header. `forced` entries are compared before the local entry was
  // applied, so the set is still "ids the local file lacks".
  const localIds = new Set(
    (Array.isArray(local?.games) ? local.games : [])
      .filter((entry) => entry && typeof entry.id === 'string' && entry.id)
      .map((entry) => entry.id)
  );
  const preserved = [];
  for (const entry of published) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
    if (localIds.has(entry.id)) continue;
    preserved.push({ id: entry.id, channel: entry.channel ?? null });
  }

  const catalog = { ...remote, games: merged };
  // A remote document predating the schemaVersion field is the one case where
  // the local file has something worth copying in; without it the launcher has
  // nothing to version-check against.
  if (catalog.schemaVersion === undefined && local?.schemaVersion !== undefined) {
    catalog.schemaVersion = local.schemaVersion;
  }

  // Compared against the remote document rather than inferred from `added`, so a
  // --force run that rewrites entries with identical values reports no change
  // and skips the upload instead of churning a file every launcher reads.
  const changed = JSON.stringify(catalog) !== JSON.stringify(remote);

  if (changed) {
    // Only when the document actually moves: bumping the stamp on a no-op
    // publish would claim freshness it did not create.
    catalog.lastUpdated = new Date(now).toISOString();
  }

  return { catalog, added, skipped, preserved, changed };
}

/**
 * What a publish would do, in the terms an operator needs before pressing it.
 *
 * The same merge the publisher runs, summarized rather than re-derived: a second
 * opinion about the diff could disagree with what actually happens. `cdnWins` is
 * the only list that means "this local edit will not reach the launcher".
 */
export function publishPlan(remote, local) {
  const { added, preserved, skipped, changed } = mergeCatalog(remote, local);
  return {
    added,
    preserved,
    cdnWins: skipped.filter((one) => one.differs.length > 0 || one.cdnOnly.length > 0),
    unusable: skipped.filter((one) => one.id === null),
    changed,
  };
}
