/**
 * The pure catalog decisions the dashboard's read and CRUD paths share.
 *
 * Extracted from dashboard.mjs for the same reason catalog-merge.mjs lives where
 * it does: a dashboard holds R2 credentials and boots an HTTP server, so nothing
 * about what a catalog edit *means* can be checked there. Every function here is
 * a total function over plain JSON - no network, no filesystem, no credentials -
 * and the transports in dashboard.mjs stay as dumb as publish-catalog.mjs's is.
 *
 * Three questions live here, and they are deliberately separate:
 *
 *   1. What differs between the published catalog and public/catalog.json?
 *      (catalogDiff) The Games -> Catalog tab used to be empty because there was
 *      no read endpoint at all, so it could only publish. An operator could not
 *      see what a publish would do before doing it.
 *
 *   2. What entry does a create request describe? (catalogEntryFrom, catalogGameId)
 *      A game id becomes a bucket path segment and is printed by scripts that
 *      treat a bare `--token` as a flag, so it is validated in one place rather
 *      than in a route handler.
 *
 *   3. What does removing an entry produce? (removeCatalogEntry)
 *      This is the one decision catalog-merge.mjs deliberately does NOT own:
 *      that module's whole promise is that a catalog publish can never make a
 *      live game vanish. A delete in the dashboard is an explicit, confirmed
 *      request from the operator, so it needs its own rule - and its own test.
 *
 * What is deliberately NOT here: the create path. Creating an entry into the
 * published catalog is an *add*, and catalog-merge.mjs already owns what an add
 * means, including the refusal to overwrite an entry the CDN already lists.
 * Reusing it is the point - a second, subtly different "add" rule in this file
 * is exactly how the two would drift.
 */

import { CHANNELS } from './metadata-fields.mjs';
import { validateCatalog } from './catalog-merge.mjs';

/**
 * The fields compared by catalogDiff, and the columns the Catalog tab can show.
 *
 * `id` is the join key and is therefore excluded from the comparison by
 * construction; it is in the list only because the UI needs it as a column.
 * `channel` IS compared: a game that moved from alpha to stable is a real change
 * the launcher would act on, and it is the field a stale local copy most often
 * disagrees about.
 *
 * Spelled out rather than derived from FIELDS at runtime so the list is readable
 * on its own; catalog-edit.test.ts asserts that every `catalog` field in
 * metadata-fields.mjs appears here, so the two cannot fall apart silently.
 */
export const CATALOG_GAME_FIELDS = [
  'id',
  'channel',
  'name',
  'description',
  'developer',
  'genre',
  'iconUrl',
  'bannerUrl',
  'screenshots',
  'supportedPlatforms',
  'availableChannels',
];

/** The subset compared between two copies of the same game: everything but the key. */
export const DIFFED_GAME_FIELDS = CATALOG_GAME_FIELDS.filter((field) => field !== 'id');

/**
 * Fields stored as arrays. A scalar where the launcher expects a list is a
 * silently broken game, so it is an error here rather than something the JSON
 * carries through to every client.
 */
const LIST_FIELDS = new Set(['genre', 'screenshots', 'supportedPlatforms', 'availableChannels']);

/** Two field values, equal by content rather than by identity. */
function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** The games array of a catalog document, or [] when there isn't a usable one. */
export function catalogGames(catalog) {
  return Array.isArray(catalog?.games) ? catalog.games : [];
}

/** A usable entry id, or null. Guards the index against `undefined` as a key. */
function idOf(entry) {
  return entry && typeof entry.id === 'string' && entry.id ? entry.id : null;
}

/**
 * Catalog games keyed by id, first occurrence winning.
 *
 * First-wins rather than last-wins so a duplicated id cannot make a diff report
 * a field as changed against itself: the same game compared against two copies
 * of the same entry would otherwise appear in `changed` with an empty meaning.
 */
function indexById(catalog) {
  const byId = new Map();
  for (const entry of catalogGames(catalog)) {
    const id = idOf(entry);
    if (id && !byId.has(id)) byId.set(id, entry);
  }
  return byId;
}

/** Enough of an entry for a diff row: the id, plus the two fields a table shows. */
function summarise(entry) {
  return {
    id: idOf(entry),
    channel: typeof entry?.channel === 'string' ? entry.channel : null,
    name: typeof entry?.name === 'string' && entry.name ? entry.name : null,
  };
}

/**
 * Which games differ between the published catalog and the checked-in copy.
 *
 * Split by direction on purpose, because the three lists mean different things
 * to the operator and lumping them together is what makes a catalog diff
 * unreadable:
 *
 *   - `onlyLive`  published but not in public/catalog.json. A publish will NOT
 *                 remove these (catalog-merge.mjs preserves them); they are games
 *                 that exist for players and are missing from the repo.
 *   - `onlyLocal` in the repo but not published. These are exactly what a publish
 *                 ADDS, which makes this the list an operator actually acts on.
 *   - `changed`   in both, with at least one display field differing. Report is
 *                 field NAMES, not values: the table renders both columns anyway,
 *                 and shipping every value twice doubles the payload for no gain.
 *                 Note this is informational - the merge keeps the published
 *                 entry, so a `changed` game is not at risk from a publish.
 *
 * Pure, and tolerant of a missing document: a null side compares as "knows
 * nothing", which is exactly what an absent file or an unreadable CDN document
 * means. Callers are responsible for telling the operator which side was real -
 * see the `liveStatus` / `localStatus` the GET carries alongside this.
 *
 * @param live  the catalog as published, or null
 * @param local public/catalog.json, or null
 */
export function catalogDiff(live, local) {
  const liveById = indexById(live);
  const localById = indexById(local);

  const onlyLive = [];
  const onlyLocal = [];
  const changed = [];

  for (const [id, entry] of liveById) {
    const other = localById.get(id);
    if (!other) {
      onlyLive.push(summarise(entry));
      continue;
    }
    const fields = DIFFED_GAME_FIELDS.filter((field) => !sameValue(entry[field], other[field]));
    if (fields.length) changed.push({ ...summarise(entry), fields });
  }

  for (const [id, entry] of localById) {
    if (!liveById.has(id)) onlyLocal.push(summarise(entry));
  }

  return { onlyLive, onlyLocal, changed };
}

/** True when the two documents agree completely; the empty-state test for the tab. */
export function catalogDiffIsEmpty(diff) {
  return diff.onlyLive.length === 0 && diff.onlyLocal.length === 0 && diff.changed.length === 0;
}

/**
 * Why a game id cannot be used, or null when it can.
 *
 * Checked before the id is ever used as a path segment or handed to a publishing
 * script:
 *
 *   - a leading `--` would be read as an option by every script in scripts/
 *     (prune-builds treats a bare `--token` as a flag), so `--force` as a game id
 *     would turn a form field into a destructive switch;
 *   - a `/` would create a nested key, turning one catalog entry into a prefix
 *     another object could be written under;
 *   - `..` would climb out of the game's own prefix, which prune then deletes
 *     recursively.
 *
 * The character class is the intersection of what the repo's ids look like
 * (misspell, pandawan-test-game) and what a bucket path segment safely accepts.
 */
export function catalogGameId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) return { ok: false, error: 'a game id is required' };
  if (id.startsWith('--')) {
    return { ok: false, error: 'a game id may not start with "--"; it would be read as an option' };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    return {
      ok: false,
      error:
        'a game id must be 1-64 characters of letters, digits, dot, dash or underscore, ' +
        'starting with a letter or a digit',
    };
  }
  return { ok: true, id };
}

/**
 * The catalog entry a create request describes, or an error explaining why not.
 *
 * Only the fields the operator actually sent are copied. Nothing is defaulted
 * except what the launcher requires to build a manifest URL (`id` and
 * `channel`): inventing an `availableChannels: [channel]` or a placeholder
 * `iconUrl` here would write fields the publisher does not write, and the next
 * real publish would then disagree with what the tab just showed as published.
 *
 * A key the catalog does not have is dropped rather than copied through, so this
 * endpoint cannot be used to smuggle an arbitrary field into a document every
 * launcher reads.
 *
 * @param values a plain object of catalog field names, straight from the payload
 */
export function catalogEntryFrom(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return { ok: false, error: 'a catalog entry object is required' };
  }

  const id = catalogGameId(values.id);
  if (!id.ok) return { ok: false, error: id.error };

  const channel = typeof values.channel === 'string' ? values.channel.trim() : '';
  if (!CHANNELS.includes(channel)) {
    return { ok: false, error: `channel must be one of ${CHANNELS.join(', ')}` };
  }

  const entry = { id: id.id, channel };
  for (const field of CATALOG_GAME_FIELDS) {
    if (field === 'id' || field === 'channel') continue;
    const value = values[field];
    if (value === undefined || value === null) continue;

    if (LIST_FIELDS.has(field)) {
      if (!Array.isArray(value)) {
        return { ok: false, error: `${field} must be a list` };
      }
      entry[field] = value;
      continue;
    }

    if (typeof value !== 'string') {
      return { ok: false, error: `${field} must be text` };
    }
    const text = value.trim();
    // An emptied string is dropped rather than written: the launcher renders
    // `undefined` as "not set" and `""` as a blank label, and the difference is
    // not something an operator can see in a table cell.
    if (text) entry[field] = text;
  }

  return { ok: true, entry };
}

/**
 * The catalog with one entry removed, or an error explaining why not.
 *
 * The rules, each one a guard against an irreversible player-visible change:
 *
 *   - the id must be a usable one, for the same reason it is on create;
 *   - it must actually be published, so a typo is a clear "no such game" instead
 *     of a silent success;
 *   - it must not be the last entry. A catalog with no games is rejected by
 *     validateCatalog and breaks every launcher that reads it, so an accidental
 *     double-click on Delete must not be able to produce one;
 *   - the result is run back through the publisher's own validateCatalog before
 *     it is returned, so this function cannot produce a document
 *     publish-catalog.mjs would have refused to write.
 *
 * Note what is NOT checked: that a build exists for the game, or that anything
 * else references it. catalog.json is the index the launcher reads; removing an
 * entry hides the game, it does not delete its objects. That is the operator's
 * call, made with `confirm: true`.
 *
 * @param catalog the published document
 * @param id      the entry to remove
 * @param options.now epoch ms, injectable so tests pin `lastUpdated`
 */
export function removeCatalogEntry(catalog, id, { now = Date.now() } = {}) {
  const check = catalogGameId(id);
  if (!check.ok) return { ok: false, error: check.error };

  const games = catalogGames(catalog);
  if (!games.some((entry) => idOf(entry) === check.id)) {
    return { ok: false, error: `"${check.id}" is not in the published catalog.` };
  }

  const remaining = games.filter((entry) => idOf(entry) !== check.id);
  if (remaining.length === 0) {
    return {
      ok: false,
      error:
        `"${check.id}" is the last game in the published catalog. Removing it would ` +
        'leave every launcher with an index it cannot read.',
    };
  }

  // Stamped unconditionally: unlike a merge, a removal is always a real change,
  // and lastUpdated is the only record that the index moved.
  const next = { ...catalog, games: remaining, lastUpdated: new Date(now).toISOString() };

  const problem = validateCatalog(next);
  if (problem) return { ok: false, error: problem };

  return { ok: true, catalog: next, removed: check.id, remaining: remaining.length };
}
