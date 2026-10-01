import type { CatalogGameEntry, GameInfo, GameManifest } from '@/types';

/** Pandawan CDN layout convention.
 *
 *  Games:
 *    {origin}/games/{id}/{channel}/manifest.json
 *    {origin}/games/{id}/{channel}/{version}/{file}
 *
 * Build bytes are version-stamped so the bytes at a given URL never change, which
 * is what makes the one-year immutable cache header safe. The manifest is mutable
 * and lives one directory up, so it carries its own `base_url` rather than having
 * the client infer where the files are.
 *
 *  Launcher-wide news feed:
 *    {origin}/launcher/news.json
 *
 * The origin comes from VITE_CDN_ORIGIN (see .env), falling back to the public
 * R2 bucket. Point it at a custom domain by setting VITE_CDN_ORIGIN; nothing
 * here needs to change when the host does.
 */
const DEFAULT_ORIGIN = 'https://pub-789d1bb0f3da4a99ae1024d53ea305d3.r2.dev';

/** Make a possibly-relative CDN asset URL absolute against the current origin. */
export function resolveCdnUrl(url: string | undefined): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${CDN_ORIGIN}${url}`;
  return `${CDN_ORIGIN}/${url}`;
}

function detectOrigin(): string {
  try {
    const envOrigin = import.meta.env.VITE_CDN_ORIGIN as string | undefined;
    if (envOrigin) return envOrigin;
    // In dev, default to the local example server so the launcher works out of
    // the box even if .env.development is missing or not loaded.
    if (import.meta.env.DEV) return 'http://localhost:8765';
  } catch {
    // import.meta may not be available in all build contexts; fall through.
  }
  return DEFAULT_ORIGIN;
}

export const CDN_ORIGIN: string = detectOrigin();

export const CdnUrl = {
  catalog(): string {
    return `${CDN_ORIGIN}/launcher/catalog.json`;
  },

  gamesPath(id: string, channel: string = 'stable'): string {
    return `${CDN_ORIGIN}/games/${id}/${channel}`;
  },

  manifest(id: string, channel: string = 'stable'): string {
    return `${CdnUrl.gamesPath(id, channel)}/manifest.json`;
  },

  news(): string {
    return `${CDN_ORIGIN}/launcher/news.json`;
  },

  withCacheBust(url: string, bust: string = Date.now().toString()): string {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}cb=${bust}`;
  },
};

/**
 * Resolve a GameInfo from a catalog entry + its manifest.
 * Catalog fields override manifest fields for presentation.
 */
export function resolveGameInfo(entry: CatalogGameEntry, manifest: GameManifest): GameInfo {
  const channel = entry.channel ?? 'stable';
  const totalSize = manifest.files.reduce((sum, f) => sum + (f.size ?? 0), 0);

  return {
    id: entry.id,
    channel,
    name: entry.name ?? manifest.name ?? entry.id,
    description: entry.description ?? manifest.description ?? '',
    developer: entry.developer ?? 'Pandawan Corp',
    genre: entry.genre ?? [],
    iconUrl: resolveCdnUrl(entry.iconUrl ?? manifest.icon_url),
    bannerUrl: resolveCdnUrl(entry.bannerUrl ?? manifest.banner_url),
    screenshots: (entry.screenshots ?? []).map(resolveCdnUrl),
    version: manifest.version,
    sizeBytes: totalSize,
    releaseDate: new Date().toISOString(),
    supportedPlatforms: entry.supportedPlatforms ?? ['windows'],
  };
}

/**
 * Where a manifest's files live. Manifests published before the version-stamped
 * layout omitted `base_url`; for those, fall back to the flat channel directory
 * so an old catalog entry still resolves.
 */
export function resolveBaseUrl(manifest: GameManifest): string {
  const fromManifest = manifest.base_url;
  if (fromManifest) {
    return fromManifest.endsWith('/') ? fromManifest : `${fromManifest}/`;
  }
  // `game_id`, not `gameId`: the manifest mirrors the publisher's JSON keys, and
  // reading the camelCase name here silently produced "games/undefined/".
  return `${CdnUrl.gamesPath(manifest.game_id, manifest.channel ?? 'stable')}/`;
}

/**
 * Absolute URL of the manifest for a game. This is the only URL the client can
 * derive without the manifest, so it must stay at the channel root.
 */
export function resolveGameUrls(id: string, channel: string = 'stable'): { manifestUrl: string } {
  return {
    manifestUrl: `${CdnUrl.gamesPath(id, channel)}/manifest.json`,
  };
}
