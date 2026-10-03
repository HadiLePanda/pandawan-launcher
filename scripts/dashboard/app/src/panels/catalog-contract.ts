/**
 * The catalog field contract, mirrored from scripts/lib/metadata-fields.mjs.
 *
 * The browser cannot import the .mjs module (it is served, not bundled from
 * node_modules), so this file is a deliberate copy rather than an invention. It
 * is a copy with the same discipline the news field contract uses, which is why
 * the news one *travels in the response* instead: /api/news returns `fields`
 * because news-fields.mjs is the publisher's contract. For the catalog the
 * endpoints that exist return game documents rather than a field list, so the
 * list is pinned here.
 *
 * Two properties are asserted by the comment above each entry and must be kept
 * in step with the .mjs file:
 *
 *   - `flag` is the CLI option (`--icon-url`), the name the publish payload uses,
 *     and `catalog` is the key it lands on in catalog.json. They are not the
 *     same string: `icon-url` -> `iconUrl`.
 *   - `list: true` means the value is stored as an array and edited as a
 *     comma-separated string, and the publisher refuses to clear one (an empty
 *     comma list cannot express "no genres").
 *
 * A divergent copy here would offer a field the publisher silently ignores, which
 * is exactly the failure the contract module exists to prevent. If a field is
 * added in metadata-fields.mjs, add it here in the same position.
 *
 * The channel and platform lists are NOT duplicated: they are imported from
 * @types/api, which already carries them as the app-wide source of truth. Only
 * the field list has to be pinned here, because the catalog GET endpoint returns
 * game documents and carries no field list with it (the news endpoint does, which
 * is why the news form renders from the response).
 */
import {
  KNOWN_CHANNELS,
  PLATFORMS as PLATFORMS_SHARED,
  type CatalogEntry,
  type KnownChannel,
} from '@/types/api';
export interface CatalogField {
  /** CLI flag, and the key the create/update payload uses. */
  flag: string;
  /** Key on a catalog game entry. */
  catalog: string;
  label: string;
  /** Stored as an array; edited comma-separated; never clearable. */
  list?: boolean;
  /** Accepts an artwork upload as well as a URL. */
  image?: boolean;
  /** Renders as a textarea. */
  long?: boolean;
}

/** The channels the launcher knows. Mirrors CHANNELS in metadata-fields.mjs. */
export const CHANNELS = KNOWN_CHANNELS;
export type Channel = KnownChannel;

export const CATALOG_FIELDS: CatalogField[] = [
  { flag: 'name', catalog: 'name', label: 'Display name' },
  { flag: 'description', catalog: 'description', label: 'Description', long: true },
  { flag: 'developer', catalog: 'developer', label: 'Developer' },
  { flag: 'genre', catalog: 'genre', label: 'Genres', list: true },
  { flag: 'icon-url', catalog: 'iconUrl', label: 'Icon URL', image: true },
  { flag: 'banner-url', catalog: 'bannerUrl', label: 'Banner URL', image: true },
  { flag: 'screenshots', catalog: 'screenshots', label: 'Screenshots', list: true },
  {
    flag: 'supported-platforms',
    catalog: 'supportedPlatforms',
    label: 'Platforms',
    list: true,
  },
  {
    flag: 'available-channels',
    catalog: 'availableChannels',
    label: 'Available channels',
    list: true,
  },
];

export const PLATFORMS = PLATFORMS_SHARED;

/**
 * One entry in catalog.json.
 *
 * Re-exported from @types/api rather than redeclared, so the panel and the
 * shared wire types cannot disagree about which fields a catalog entry has. The
 * index signature is gone on purpose: the diff reports fields by name and a
 * hand-added CDN key must be renderable, which it is through the `fields`
 * string list, not through an `unknown` catch-all on every entry.
 */
export type CatalogGame = CatalogEntry;

export interface CatalogDoc {
  schemaVersion?: string;
  lastUpdated?: string;
  games?: CatalogGame[];
  [key: string]: unknown;
}

export interface CatalogChangedEntry {
  id: string;
  fields: string[];
}

export interface CatalogDiff {
  onlyLive: string[];
  onlyLocal: string[];
  changed: CatalogChangedEntry[];
}

export interface CatalogResponse {
  live: CatalogDoc | null;
  local: CatalogDoc | null;
  diff: CatalogDiff;
  /** Present only if the server could not read one side; rendered as a banner. */
  error?: string;
  liveError?: string;
  localError?: string;
}

/** The wire name of a catalog field's flag, e.g. `icon-url`. */
export function fieldByFlag(flag: string): CatalogField | undefined {
  return CATALOG_FIELDS.find((field) => field.flag === flag);
}

/** The human label for a diff field name, falling back to the raw key. */
export function labelForField(key: string): string {
  return CATALOG_FIELDS.find((field) => field.catalog === key)?.label ?? key;
}

/** "a, b, c" -> ["a","b","c"], the way the publisher splits a list field. */
export function splitList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((part) => String(part)).filter(Boolean);
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function joinList(value: unknown): string {
  return splitList(value).join(', ');
}

/** A catalog entry rendered as form values keyed by flag. */
export function gameToFields(game: CatalogGame | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of CATALOG_FIELDS) {
    // CatalogEntry is a closed shape, so a dynamic key needs the narrowing the
    // compiler will not do for us. Unknown keys simply read as undefined, which is
    // the same answer as an absent optional field.
    const raw = (game as Record<string, unknown> | null | undefined)?.[field.catalog];
    out[field.flag] = field.list ? joinList(raw) : String(raw ?? '');
  }
  return out;
}

/**
 * Form values back into a catalog entry, omitting anything emptied.
 *
 * An emptied optional field is dropped rather than written as "": the launcher
 * tests truthiness, and "" would be indistinguishable from absent but larger - the
 * same reasoning fieldsToNewsItem() applies on the news side.
 */
export function fieldsToGame(
  id: string,
  channel: string,
  values: Record<string, string>
): CatalogGame {
  const game: CatalogGame = { id: String(id).trim(), channel: channel.trim() };
  for (const field of CATALOG_FIELDS) {
    const text = String(values[field.flag] ?? '').trim();
    if (!text) continue;
    // Same narrowing as gameToFields: the write is by contract key, and a key
    // outside the contract is skipped rather than smuggled onto the entry.
    (game as unknown as Record<string, unknown>)[field.catalog] = field.list
      ? splitList(text)
      : text;
  }
  return game;
}

/**
 * Why a catalog entry cannot be created, or null when it can.
 *
 * Mirrors validateCatalog() in catalog-merge.mjs, which is the rule the publisher
 * will enforce anyway. Checking it here means the operator reads the constraint
 * against the field they are looking at rather than in a log after the fact:
 *
 *   - an entry needs an id, and the id is the join key between catalog.json and
 *     every manifest URL, so it cannot be invented per load,
 *   - an entry needs a channel, without one the launcher cannot build its
 *     manifest URL at all.
 *
 * `validateCatalog` additionally rejects a catalog with no games array, which is
 * a document-level rule and not an entry-level one, so it has no place here.
 */
export function validateGame(
  id: string,
  channel: string,
  fields: Record<string, string>
): string | null {
  const trimmedId = id.trim();
  if (!trimmedId)
    return 'A catalog entry needs an id. It is the key every manifest URL is built from.';
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(trimmedId)) {
    return 'Use letters, digits, dots, dashes and underscores only, starting with a letter or digit.';
  }
  if (!channel.trim())
    return 'A catalog entry needs a channel; the launcher builds its manifest URL from it.';
  if (!CHANNELS.includes(channel.trim() as Channel)) {
    return `Channel must be one of ${CHANNELS.join(', ')}.`;
  }
  if (!String(fields.name ?? '').trim()) {
    return 'A catalog entry needs a display name. The launcher shows that, not the id.';
  }
  const platforms = splitList(fields['supported-platforms']);
  for (const platform of platforms) {
    if (!PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) {
      return `Platform "${platform}" is not one of ${PLATFORMS.join(', ')}.`;
    }
  }
  for (const channelName of splitList(fields['available-channels'])) {
    if (!CHANNELS.includes(channelName as Channel)) {
      return `Available channel "${channelName}" is not one of ${CHANNELS.join(', ')}.`;
    }
  }
  return null;
}
