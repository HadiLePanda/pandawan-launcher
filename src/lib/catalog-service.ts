import type { GameCatalog, GameInfo, GameManifest, PlatformVersion } from '@/types';
import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { detectPlatform, type Platform } from './platform';
import {
  CdnUrl,
  latestIndexUrl,
  resolveGameInfo,
  resolveGameUrls,
  resolveUnavailableGameInfo,
  versionedManifestUrl,
} from './cdn';
import { commands } from './commands';
import { CommandError, unwrapResult } from './errors';
import i18n from './i18n';
import { fetchCachedText, lastReadSource } from './http-cache';
import { logger } from './logger';

export const DEFAULT_CHANNEL = 'stable';

/**
 * Release channels a publisher can attach to a game, ordered most to least
 * stable. Mirrors KNOWN_CHANNELS in src-tauri/src/types.rs; the parity test
 * keeps the Rust side honest.
 */
export const KNOWN_CHANNELS = ['stable', 'beta', 'alpha'] as const;

export type Channel = (typeof KNOWN_CHANNELS)[number];

/** Coerce arbitrary input to a known channel, falling back to `stable`. */
export function normalizeChannel(value: string | null | undefined): string {
  if (value && (KNOWN_CHANNELS as readonly string[]).includes(value)) {
    return value;
  }
  if (value) {
    logger.warn('Unknown channel, falling back to stable', { channel: value });
  }
  return DEFAULT_CHANNEL;
}

/** Remote catalog endpoint. Lists game IDs + channels; no per-version URLs. */
const CATALOG_URL = CdnUrl.catalog();

const CATALOG_OVERRIDE_FILE_NAME = 'catalog.override.json';

let embeddedCatalog: GameCatalog | null = null;

/**
 * Fetch a remote document through the Rust backend rather than the webview.
 *
 * Going through reqwest means the Tauri HTTP capability scope never has to
 * list the CDN hostname, so pointing the launcher at a different bucket is a
 * configuration change instead of a code change.
 */
export async function fetchRemoteText(url: string): Promise<string> {
  return unwrapResult(await commands.fetchRemoteText(url));
}

/**
 * Fetch a document the publisher signed, and refuse it unless the signature is one this
 * build trusts. The check runs on the exact bytes, before they are parsed, and lives in
 * the backend because that is where the pinned key is.
 *
 * The pair is cached as ONE entry: two entries expire at different instants, so the read
 * that refreshed the document would check new bytes against an old signature.
 */
async function fetchSigned(remoteUrl: string): Promise<string> {
  const cached = await fetchCachedText(signedKey(remoteUrl), () => fetchSignedPair(remoteUrl));
  const pair = parseSignedPair(cached) ?? parseSignedPair(await fetchSignedPair(remoteUrl));
  if (!pair) throw new Error(`Could not read ${remoteUrl} with its signature`);

  unwrapResult(await commands.verifyManifestSignature(pair.body, pair.signature));
  return pair.body;
}

/**
 * The cache key a signed document is stored under. `lastReadSource` has to look
 * it up with the same key, or a network read reports as a cache hit.
 */
function signedKey(url: string): string {
  return `${url}#signed`;
}

/**
 * A document exists but its `.sig` does not.
 *
 * Distinct from a missing document: a channel published before the per-platform
 * index has no index at all, while this is one somebody published without a
 * signature. Only the first may fall back to the channel root.
 */
class UnsignedDocumentError extends Error {
  constructor(url: string) {
    super(`No signature for ${url}`);
    this.name = 'UnsignedDocumentError';
  }
}

/** A 404 from the fetch command, which is how a channel with no index reads. */
function isNotFound(err: unknown): boolean {
  return (
    err instanceof CommandError &&
    err.code === 'Network' &&
    typeof err.details === 'string' &&
    /^HTTP 404(\s|$)/.test(err.details)
  );
}

async function fetchSignedPair(remoteUrl: string): Promise<string> {
  // Sequential on purpose: a parallel fetch cannot say which URL 404ed, and the
  // difference between "no index" and "no signature" decides whether the caller
  // may fall back to the channel root.
  const body = await fetchRemoteText(remoteUrl);
  try {
    const signature = await fetchRemoteText(`${remoteUrl}.sig`);
    return JSON.stringify({ body, signature });
  } catch (err) {
    if (isNotFound(err)) throw new UnsignedDocumentError(remoteUrl);
    throw err;
  }
}

/** A malformed cache entry reads as absent, never as a refusal. */
function parseSignedPair(text: string): { body: string; signature: string } | null {
  try {
    const parsed = JSON.parse(text) as { body?: unknown; signature?: unknown };
    if (typeof parsed?.body === 'string' && typeof parsed?.signature === 'string') {
      return { body: parsed.body, signature: parsed.signature };
    }
  } catch {
    /* not a pair */
  }
  return null;
}

export interface ResolvedCatalog {
  games: GameInfo[];
  catalog: GameCatalog;
  source: 'remote' | 'cache' | 'local' | 'embedded';
  unreachable?: boolean;
}

/**
 * Load the company catalog and resolve every game against its live manifest.
 * Falls back to the embedded catalog if remote is unreachable.
 */
export async function loadCatalog(): Promise<ResolvedCatalog> {
  // 1. Try remote catalog first. This is the normal path for live deployments.
  try {
    const catalog = await fetchRemoteCatalog(CATALOG_URL);
    const games = await resolveCatalogGames(catalog);
    // A cached read is not a live one. Served after a failed read it is also
    // stale, which is the case the connectivity banner exists for. The signed
    // document is cached under its own key, so the lookup must use it too.
    const read = lastReadSource(signedKey(CATALOG_URL));
    return {
      catalog,
      games,
      source: read === 'network' ? 'remote' : 'cache',
      unreachable: read === 'stale' ? true : undefined,
    };
  } catch (err) {
    logger.warn('Failed to load remote catalog', { url: CATALOG_URL, error: String(err) });
  }

  // 2. Try a local override file in the app data directory (QA / dev only).
  //    Checked before embedded so QA can override a stale or broken bundled catalog.
  try {
    const localOverride = await loadLocalOverrideCatalog();
    if (localOverride) {
      const games = await resolveCatalogGames(localOverride);
      return { catalog: localOverride, games, source: 'local' };
    }
  } catch (err) {
    logger.warn('Failed to load local override catalog', { error: String(err) });
  }

  // 3. Fall back to the embedded catalog bundled with the app.
  const embedded = await loadEmbeddedCatalog();
  if (embedded) {
    const games = await resolveCatalogGames(embedded);
    return { catalog: embedded, games, source: 'embedded', unreachable: true };
  }

  throw new Error(i18n.t('errors.catalogLoadFailed'));
}

export async function fetchRemoteCatalog(url: string): Promise<GameCatalog> {
  // The catalog names each game's channel, and the launcher follows it. Unsigned,
  // an R2 writer can flip that field to a prerelease channel and every client
  // re-syncs onto it, so the document the app trusts is the one the release key
  // signed. A bucket still serving the pre-signing catalog falls back to the
  // embedded copy until `npm run publish:catalog -- --resign --confirm` runs.
  const body = await fetchSigned(url);
  const catalog = JSON.parse(body);
  validateCatalog(catalog);
  return catalog as GameCatalog;
}

export async function loadEmbeddedCatalog(): Promise<GameCatalog | null> {
  if (embeddedCatalog) return embeddedCatalog;

  try {
    const response = await fetch('/catalog.json');
    if (!response.ok) return null;

    const catalog = await response.json();
    validateCatalog(catalog);
    embeddedCatalog = catalog as GameCatalog;
    return embeddedCatalog;
  } catch (err) {
    logger.warn('No embedded catalog found', { error: String(err) });
    return null;
  }
}

export async function loadLocalOverrideCatalog(): Promise<GameCatalog | null> {
  try {
    const content = await readTextFile(CATALOG_OVERRIDE_FILE_NAME, {
      baseDir: BaseDirectory.AppData,
    });
    const parsed = JSON.parse(content) as GameCatalog;
    validateCatalog(parsed);
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('No such file') || message.includes('os error 2')) return null;
    logger.warn('Failed to read local override catalog', { error: message });
    return null;
  }
}

/** Why a manifest could not be resolved for this machine. */
export type UnavailableReason = 'no-build-for-platform' | 'platform-unknown';

export type ResolvedManifest =
  | { status: 'ok'; manifest: GameManifest }
  | {
      status: 'unavailable';
      reason: UnavailableReason;
      /** What the channel does offer, so the UI can explain rather than just grey out. */
      availableVersions: Record<string, PlatformVersion>;
    };

/**
 * The channel's per-platform pointer, or null when the channel predates it.
 *
 * A missing index is not an error: channels published before this existed have
 * a single flat manifest at the channel root and still work.
 */
async function fetchLatestIndex(
  id: string,
  channel: string
): Promise<Record<string, PlatformVersion> | null> {
  const url = latestIndexUrl(id, channel);
  try {
    const body = await fetchSigned(url);
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, PlatformVersion>;
  } catch (err) {
    if (err instanceof UnsignedDocumentError) {
      // An index that exists without its signature must not fall back: the
      // writer who stripped it can supply the old signed channel-root pair.
      logger.warn('Version index has no signature, refusing the channel root', {
        url,
        error: String(err),
      });
      throw err;
    }
    if (isNotFound(err) || err instanceof SyntaxError) {
      // Absent predates the per-platform layout; unparseable is a signed
      // document with junk in it. The signed channel-root manifest is still a
      // usable fallback for both.
      logger.warn('Version index unusable, falling back to the channel root', {
        url,
        error: String(err),
      });
      return null;
    }
    // A refused signature or a network failure is not "absent": falling back
    // would let the same writer steer the client to an older signed pair.
    throw err;
  }
}

/**
 * Resolve the manifest this machine should use.
 *
 * Platforms ship independently, so the channel root's manifest.json only ever
 * describes whichever platform was published last. The per-platform index names
 * this machine's version, and the versioned manifest is fetched from there.
 */
export async function resolveManifestForPlatform(
  id: string,
  channel: string = 'stable',
  platform: Platform | null = detectPlatform()
): Promise<ResolvedManifest> {
  const index = await fetchLatestIndex(id, channel);

  if (!index) {
    const { manifestUrl } = resolveGameUrls(id, channel);
    return { status: 'ok', manifest: await fetchGameManifest(manifestUrl) };
  }

  if (!platform) {
    return { status: 'unavailable', reason: 'platform-unknown', availableVersions: index };
  }

  const entry = index[platform];
  if (!entry) {
    return { status: 'unavailable', reason: 'no-build-for-platform', availableVersions: index };
  }

  // The index can name a version whose manifest is not on the bucket: an
  // interrupted publish, or a latest.json edited by hand. The channel-root
  // manifest is still there, so fall back to it rather than throwing - a throw
  // here drops the game out of the library entirely, artwork and all, over a
  // stale pointer.
  try {
    return {
      status: 'ok',
      manifest: await fetchGameManifest(versionedManifestUrl(id, channel, entry.version)),
    };
  } catch (err) {
    logger.warn('Versioned manifest unreadable, falling back to the channel root', {
      game: id,
      channel,
      version: entry.version,
      error: String(err),
    });
    const { manifestUrl } = resolveGameUrls(id, channel);
    return { status: 'ok', manifest: await fetchGameManifest(manifestUrl) };
  }
}
export async function fetchGameManifest(manifestUrl: string): Promise<GameManifest> {
  const body = await fetchSigned(manifestUrl);
  const manifest = JSON.parse(body);
  if (!manifest || typeof manifest !== 'object' || !manifest.game_id || !manifest.version) {
    throw new Error('Invalid manifest: missing game_id or version');
  }
  // Manifests published before channels existed omit the field. Normalize here,
  // at the single boundary where manifests enter the app, so nothing downstream
  // has to re-implement the default.
  return { ...(manifest as GameManifest), channel: manifest.channel || DEFAULT_CHANNEL };
}

export async function resolveCatalogGames(catalog: GameCatalog): Promise<GameInfo[]> {
  const entries = catalog.games ?? [];
  // Resolved once for the whole catalog: every game is judged against the same
  // machine, and calling this per entry would re-sniff the platform each time.
  const platform = detectPlatform();
  const resolved = await Promise.allSettled(
    entries.map(async (entry) => {
      const result = await resolveManifestForPlatform(
        entry.id,
        entry.channel ?? 'stable',
        platform
      );
      // No build for this machine is a normal outcome, not a failure: the game
      // still appears, greyed, with the tooltip explaining what is on offer.
      if (result.status === 'unavailable') {
        return resolveUnavailableGameInfo(entry, result.availableVersions);
      }
      return resolveGameInfo(entry, result.manifest, platform);
    })
  );

  const games: GameInfo[] = [];
  resolved.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      games.push(result.value);
      return;
    }
    // Promise.allSettled keeps the order, so index still lines up with entries.
    const entry = entries[index];
    if (entry) {
      logger.warn(`Failed to resolve game ${entry.id}`, { reason: String(result.reason) });
    }
  });

  return games;
}

export function validateCatalog(catalog: unknown): asserts catalog is GameCatalog {
  if (!catalog || typeof catalog !== 'object') {
    throw new Error('Catalog must be an object');
  }

  const c = catalog as Record<string, unknown>;
  if (!Array.isArray(c.games)) {
    throw new Error('Catalog is missing the games array');
  }

  for (const game of c.games) {
    if (!game || typeof game !== 'object') {
      throw new Error('Catalog contains an invalid game entry');
    }
    const g = game as Record<string, unknown>;
    if (typeof g.id !== 'string' || !g.id) {
      throw new Error('Catalog game is missing a valid id');
    }
  }
}
