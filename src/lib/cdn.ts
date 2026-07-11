import type { CatalogGameEntry, GameInfo, GameManifest } from '@/types';

/** Pandawan CDN layout convention.
 *
 *  Games:
 *    https://cdn.pandawancorp.com/games/{id}/{channel}/manifest.json
 *    https://cdn.pandawancorp.com/games/{id}/{channel}/{file}
 *
 *  Launcher-wide news feed:
 *    https://cdn.pandawancorp.com/launcher/news.json
 */
const DEFAULT_ORIGIN = 'https://cdn.pandawancorp.com';

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

export function resolveGameUrls(
  id: string,
  channel: string = 'stable'
): { manifestUrl: string; baseUrl: string } {
  const baseUrl = `${CdnUrl.gamesPath(id, channel)}/`;
  return {
    manifestUrl: `${baseUrl}manifest.json`,
    baseUrl,
  };
}
