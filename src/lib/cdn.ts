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

type ViteImportMeta = ImportMeta & { env: Record<string, unknown> };

function detectOrigin(): string {
  try {
    const meta = import.meta as ViteImportMeta;
    const env = meta.env ?? {};
    const envOrigin = env.VITE_CDN_ORIGIN as string | undefined;
    if (envOrigin) return envOrigin;
  } catch {
    // import.meta may not be available in all build contexts; fall through.
  }
  return DEFAULT_ORIGIN;
}

export const CDN_ORIGIN: string = detectOrigin();

export const CdnUrl = {
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

export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function formatSpeed(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} MB/s`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} KB/s`;
  return `${bps.toFixed(0)} B/s`;
}

/**
 * Resolve a GameInfo from a catalog entry + its manifest.
 * Catalog fields override manifest fields for presentation.
 */
export function resolveGameInfo(entry: CatalogGameEntry, manifest: GameManifest): GameInfo {
  const channel = entry.channel ?? 'stable';
  const totalSize = manifest.size_bytes ?? manifest.files.reduce((sum, f) => sum + (f.size ?? 0), 0);

  return {
    id: entry.id,
    channel,
    name: entry.name ?? manifest.name ?? entry.id,
    description: entry.description ?? manifest.description ?? '',
    developer: entry.developer ?? 'Pandawan Corp',
    genre: entry.genre ?? [],
    iconUrl: entry.iconUrl ?? manifest.icon_url ?? '',
    bannerUrl: entry.bannerUrl ?? manifest.banner_url ?? '',
    screenshots: entry.screenshots ?? [],
    version: manifest.version,
    sizeBytes: totalSize,
    releaseDate: manifest.release_date ?? new Date().toISOString(),
    supportedPlatforms: entry.supportedPlatforms ?? ['windows'],
    patchNotes: manifest.patch_notes,
  };
}

export function resolveGameUrls(id: string, channel: string = 'stable'): { manifestUrl: string; baseUrl: string } {
  const baseUrl = CdnUrl.gamesPath(id, channel);
  return {
    manifestUrl: `${baseUrl}/manifest.json`,
    baseUrl,
  };
}
