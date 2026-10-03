/**
 * The shapes the dashboard server sends.
 *
 * Declared by hand rather than generated: dashboard.mjs is a plain .mjs file
 * with no types, and these four interfaces are the whole contract the client
 * depends on. Anything optional here is optional because the SERVER makes it
 * optional - not to avoid writing a type.
 *
 * GET /api/catalog is treated as optional throughout. Another agent is adding
 * it, so every consumer must degrade gracefully when it 404s: the inventory is
 * the only source of games that is guaranteed to exist today.
 */

/** The platforms the launcher can install on, in the order the grid shows them. */
export const PLATFORMS = ['windows', 'macos', 'linux'] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * The channels the launcher knows.
 *
 * Mirrors CHANNELS in scripts/lib/metadata-fields.mjs. The browser cannot
 * import that module, so this is the one hand-maintained copy - and it is
 * deliberate that it cannot drift silently: `KNOWN_CHANNELS` is exported and
 * every select in the app renders from it, so a divergence shows up as an
 * extra or missing option rather than as a form that offers an invalid value.
 * See scripts/dashboard/app/README-channels.md.
 */
export const KNOWN_CHANNELS = ['stable', 'beta', 'alpha'] as const;
export type KnownChannel = (typeof KNOWN_CHANNELS)[number];

/** Anything the server sent us that we have not validated as a KnownChannel. */
export function asChannel(value: string | null | undefined): KnownChannel | null {
  if (!value) return null;
  return (KNOWN_CHANNELS as readonly string[]).includes(value) ? (value as KnownChannel) : null;
}

/** One platform's entry in latest.json. */
export interface PlatformRelease {
  version: string;
  build: number;
}

/** A game and the channels it is published on. */
export interface InventoryChannel {
  channel: string;
  /** Version + build per platform. Absent platforms are simply not keys. */
  latest: Record<string, PlatformRelease> | null;
  /** Every version on the bucket for this channel, newest first. */
  published: { version: string; platforms: string[] }[];
  /** Ship time per platform, from the bucket listing. */
  updated: Record<string, string | null> | null;
  platforms: string[];
}

export interface InventoryGame {
  id: string;
  channels: InventoryChannel[];
}

export interface DriftEntry {
  gameId: string;
  channel: string;
  versions: Record<string, PlatformRelease> | null;
}

export interface InventoryPayload {
  inventory: InventoryGame[];
  drift: DriftEntry[];
}

/** One catalog entry. GET /api/catalog is optional, so every field may be absent. */
export interface CatalogEntry {
  id: string;
  channel?: string | null;
  name?: string | null;
  description?: string | null;
  developer?: string | null;
  genre?: string[];
  iconUrl?: string | null;
  bannerUrl?: string | null;
  screenshots?: string[];
  supportedPlatforms?: string[];
  availableChannels?: string[];
}

export interface CatalogPayload {
  games: CatalogEntry[];
  lastUpdated?: string | null;
}

/** A catalog document as the panel reads it; every field may be absent. */
export interface CatalogDoc {
  games?: CatalogEntry[];
  lastUpdated?: string | null;
  [key: string]: unknown;
}

/** One game present on both sides with at least one display field differing. */
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
  /** The served metadata field contract, used for diff field labels. */
  fieldSpec?: MetaFieldSpec[];
  /**
   * Per side, how the read went. The server reports a status plus a detail rather
   * than one error string, because a side can be absent (nothing published yet,
   * which is normal) separately from unreadable, which is a problem to explain.
   */
  liveStatus?: string;
  liveDetail?: string;
  localStatus?: string;
  localDetail?: string;
  /** Where the local copy was read from, so the operator can open it. */
  localPath?: string;
}

/**
 * One entry of the metadata field contract, as the server sends it.
 *
 * This is the server's FIELDS list, so it carries `catalog` (the key the field
 * lands on) as well as `flag`, and `image` / `long` name the control to render.
 * The form is built from this array in order; the client never keeps its own.
 */
export interface MetaFieldSpec {
  /** CLI flag, and the key the publish payload uses. */
  flag: string;
  /** Key on a catalog game entry. */
  catalog: string;
  label: string;
  /** Stored as an array; edited as a comma list; an emptied one is never sent. */
  list: boolean;
  /** Accepts an artwork upload as well as a URL. */
  image: boolean;
  /** Renders as a textarea. */
  long: boolean;
}

/**
 * What a catalog publish would do, as `GET /api/catalog` reports it.
 *
 * Computed server-side by the publisher's own `publishPlan` (the same merge the
 * script runs), so the panel cannot promise something the script would not do.
 * Optional throughout the same way the rest of /api/catalog is: an older server
 * that does not send a `plan` must still render.
 */
export interface CatalogPlanEntry {
  id: string;
  channel: string | null;
}

/** A field both documents carry with different values, under --force. */
export interface CatalogPlanFieldDiff {
  field: string;
  cdn: unknown;
  local: unknown;
}

/** A game the local file edits that the live catalog overrides. */
export interface CatalogPlanConflict extends CatalogPlanEntry {
  differs: CatalogPlanFieldDiff[];
  cdnOnly: string[];
}

export interface CatalogPlan {
  /** Games the local file would add to the live catalog. */
  added: CatalogPlanEntry[];
  /** Games kept because the local file omits them. */
  preserved: CatalogPlanEntry[];
  /** Local edits the live catalog wins, so they will not reach the launcher. */
  cdnWins: CatalogPlanConflict[];
  /** Local entries with no usable id; never merged. */
  unusable: Array<{ id: null; channel: string | null }>;
  /** Whether the upload would change anything at all. */
  changed: boolean;
}

/** One field of a game's presentation, as /api/meta reports it. */
export interface MetaField {
  label: string;
  list: boolean;
  /** Already joined for editing when `list` is true. */
  value: string;
  /** 'catalog' | 'manifest' | 'empty' */
  source: string;
  /** True when the launcher renders it but the catalog does not own it. */
  inherited: boolean;
}

export interface MetaPayload {
  exists: boolean;
  hasManifest: boolean;
  hasCatalogEntry: boolean;
  gameId: string;
  channel: string;
  /** The channel the catalog entry actually points at, when it disagrees. */
  publishedChannel?: string | null;
  channelMismatch?: boolean;
  versions?: Record<string, PlatformRelease> | null;
  fields: Record<string, MetaField>;
  /** The packed field contract this form renders from, served in this response. */
  fieldSpec?: MetaFieldSpec[];
  missing: string[];
}

/** One published artwork object. */
export interface ArtworkObject {
  key: string;
  name: string;
  url: string;
  sizeBytes: number;
  size: string;
  lastModified: string | null;
  /** The metadata flag pointing at this object, when one does. */
  field: string | null;
  inUse: boolean;
}

export interface ArtworkPayload {
  scope: 'game' | 'news';
  prefix: string;
  objects: ArtworkObject[];
}

/** The response from POST /api/art/stage. */
export interface StagedFile {
  localPath: string;
  name: string;
  sizeBytes: number;
}

/** One entry of POST /api/services. Owned by another agent's screen. */
export interface ServiceStatus {
  id: string;
  name: string;
  note: string;
  port: number;
  url: string | null;
  up: boolean;
  ours: boolean;
  opened: boolean;
  log: string | null;
}
