import type { GameCatalog, CatalogGameEntry, GameInfo, GameManifest } from '@/types';
import { readTextFile, writeTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { CdnUrl, resolveGameInfo, resolveGameUrls } from './cdn';
import i18n from './i18n';
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

/** Use the Tauri HTTP plugin for absolute URLs so the launcher can talk to
 *  remote CDNs that don't send browser CORS headers. Relative URLs
 *  (like the bundled /catalog.json) keep using the standard fetch.
 *
 *  In dev, localhost/127.0.0.1 URLs use the browser fetch directly so the local
 *  example server works without fighting Tauri HTTP scope matching.
 */
async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  if (/^https?:\/\//i.test(url)) {
    if (import.meta.env.DEV && /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?\//i.test(url)) {
      return fetch(url, init);
    }
    return tauriFetch(url, init);
  }
  return fetch(url, init);
}

export interface ResolvedCatalog {
  games: GameInfo[];
  catalog: GameCatalog;
  source: 'remote' | 'local' | 'embedded';
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
    return { catalog, games, source: 'remote' };
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

  // 3. In dev, use the bundled examples/ folder as a static fixture. This works
  //    when the local example server is not running or when Tauri HTTP calls
  //    to localhost are blocked, so developers can still test the catalog UI.
  if (import.meta.env.DEV) {
    try {
      const fixture = await import('./catalog-dev-fixture').then((m) => m.loadDevFixtureCatalog());
      if (fixture) {
        return {
          catalog: fixture.catalog,
          games: fixture.games,
          source: 'embedded',
          unreachable: true,
        };
      }
    } catch (err) {
      logger.warn('Failed to load dev fixture catalog', { error: String(err) });
    }
  }

  // 4. Fall back to the embedded catalog bundled with the app.
  const embedded = await loadEmbeddedCatalog();
  if (embedded) {
    const games = await resolveCatalogGames(embedded);
    return { catalog: embedded, games, source: 'embedded', unreachable: true };
  }

  throw new Error(i18n.t('errors.catalogLoadFailed'));
}

export async function fetchRemoteCatalog(url: string): Promise<GameCatalog> {
  const response = await httpFetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Remote catalog returned ${response.status}: ${response.statusText}`);
  }

  const catalog = await response.json();
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

export async function saveLocalOverrideCatalog(catalog: GameCatalog): Promise<void> {
  validateCatalog(catalog);
  await writeTextFile(CATALOG_OVERRIDE_FILE_NAME, JSON.stringify(catalog, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

export async function fetchGameManifest(manifestUrl: string): Promise<GameManifest> {
  const response = await httpFetch(manifestUrl, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Manifest returned ${response.status}: ${response.statusText}`);
  }
  const manifest = await response.json();
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
  const resolved = await Promise.allSettled(
    entries.map(async (entry) => {
      const { manifestUrl } = resolveGameUrls(entry.id, entry.channel ?? 'stable');
      const manifest = await fetchGameManifest(manifestUrl);
      return resolveGameInfo(entry, manifest);
    })
  );

  const games: GameInfo[] = [];
  resolved.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      games.push(result.value);
    } else {
      const entry = entries[index];
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

export function validateCatalogEntry(entry: unknown): asserts entry is CatalogGameEntry {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Catalog entry must be an object');
  }
  const e = entry as Record<string, unknown>;
  if (typeof e.id !== 'string' || !e.id) {
    throw new Error('Catalog entry is missing a valid id');
  }
}
