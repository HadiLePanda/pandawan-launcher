import type { CatalogGameEntry, GameInfo, GameManifest, PlatformVersion } from '@/types';
import { selectPlatformBuild, type Platform } from './platform';

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

/**
 * Artwork placeholders that ship inside the app bundle rather than the bucket.
 *
 * A catalog says `/placeholder-icon.svg` to mean "no artwork configured". That is
 * the app's own file, so prefixing the CDN origin asked the bucket for a path it
 * does not have (404) and a game with no art rendered a bare fallback glyph
 * instead of the placeholder it asked for.
 */
const BUNDLED_ART = new Set(['/placeholder-icon.svg', '/placeholder-banner.svg']);

/**
 * Make a possibly-relative CDN asset URL absolute against the current origin.
 *
 * Anything else beginning with `/` is a bucket-root-relative path and does get the
 * origin; only the bundled placeholders are app-local.
 */
export function resolveCdnUrl(url: string | undefined): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (BUNDLED_ART.has(url)) return url;
  if (url.startsWith('/')) return `${CDN_ORIGIN}${url}`;
  return `${CDN_ORIGIN}/${url}`;
}

/**
 * Which image represents a news item, and what to show when there is none.
 *
 * A news item only carries artwork if the publisher attached one, and most items
 * will not have. Resolving the image in four places separately meant each one
 * silently rendered nothing, leaving a hole in the layout and a card that looked
 * broken. So the order is decided once, here:
 *
 *   1. the item's own imageUrl
 *   2. the game's banner, since the item is about that game
 *   3. the game's icon, better than nothing at any size
 *   4. a bundled placeholder, so a slot is never left empty
 *
 * The last step is what makes this safe: there is no path through this function
 * that returns an empty string, so a caller can render the image unconditionally
 * instead of guarding every site.
 */

/** Bundled art for a news item with no image and no game to borrow from. */
export const NEWS_PLACEHOLDER = '/placeholder-news.svg';

/**
 * Resolve the artwork for one news item.
 *
 * @param item      the news item
 * @param gameArt   the game's banner and icon, when the item belongs to a game
 * @returns an absolute-or-root-relative URL that is always non-empty
 */
export function resolveNewsImage(
  // imageUrl optional, not required: absence is the case this exists to handle.
  item: { imageUrl?: string | null },
  gameArt?: { bannerUrl?: string | null; iconUrl?: string | null } | null
): string {
  const own = item.imageUrl?.trim();
  // A bundled placeholder stored as the item's own image is not artwork. Honoring
  // it would end the chain on a grey file and hide the banner the game actually has.
  if (own && !BUNDLED_ART.has(own)) return resolveCdnUrl(own);

  // The game's banner is the right fallback: it is the widest art the game has,
  // so it crops correctly at both thumbnail and banner sizes.
  const banner = gameArt?.bannerUrl?.trim();
  if (banner) return resolveCdnUrl(banner);

  const icon = gameArt?.iconUrl?.trim();
  if (icon) return resolveCdnUrl(icon);

  return NEWS_PLACEHOLDER;
}

/**
 * Swap in the placeholder when an image fails to load.
 *
 * A URL can be present and still 404 - artwork deleted from the bucket, a typo in
 * a catalog entry, a CDN hiccup. Without this the browser shows its broken-image
 * glyph, which is the exact "missing image" the placeholder exists to prevent, so
 * the failure has to be caught in the browser rather than trusted not to happen.
 *
 * Guards against looping: if the placeholder itself somehow fails, the handler
 * detaches instead of retrying forever.
 */
export function handleImageError(event: { currentTarget: HTMLImageElement }): void {
  const img = event.currentTarget;
  if (!img) return;
  // Compare the URL rather than tracking a flag: an img element has no reliable
  // place to record that a fallback already happened (the dataset survives
  // re-renders inconsistently, and a keyed remount starts clean), so the only
  // trustworthy signal is "am I already showing the placeholder".
  //
  // This also cannot loop. Assigning the same src the browser already failed on
  // fires no new error event, and if it somehow did, the equality check below
  // stops it.
  if (img.src === NEWS_PLACEHOLDER || img.src.endsWith(NEWS_PLACEHOLDER)) return;
  img.src = NEWS_PLACEHOLDER;
}

function detectOrigin(): string {
  try {
    // No dev default: without VITE_CDN_ORIGIN there is nothing local to serve
    // from any more, and silently pointing at a dead localhost would only mask
    // a missing configuration.
    const envOrigin = import.meta.env.VITE_CDN_ORIGIN as string | undefined;
    if (envOrigin) return envOrigin;
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

  news(): string {
    return `${CDN_ORIGIN}/launcher/news.json`;
  },
};

/**
 * Resolve a GameInfo from a catalog entry + its manifest.
 * Catalog fields override manifest fields for presentation.
 *
 * `platform` is the machine this launcher runs on. Size and availability are both
 * per-platform, so a Mac player is never shown a Windows build's download size.
 */
export function resolveGameInfo(
  entry: CatalogGameEntry,
  manifest: GameManifest,
  platform: Platform | null = null
): GameInfo {
  const channel = entry.channel ?? 'stable';
  const build = selectPlatformBuild(manifest, platform, entry.supportedPlatforms);

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
    // Size for this platform's build, not the manifest total: showing 1.2 GB to
    // a Windows player who will download 421 MB of it is simply wrong.
    sizeBytes: build?.sizeBytes ?? 0,
    // Whether this machine can actually run the game. A Mac player still sees a
    // Windows-only game, greyed, rather than it silently vanishing.
    isAvailableOnThisPlatform: build !== null,
    releaseDate: new Date().toISOString(),
    supportedPlatforms: entry.supportedPlatforms ?? ['windows'],
    availableChannels: entry.availableChannels,
  };
}

/**
 * A game whose channel exists but has no build for this machine.
 *
 * Built from the catalog entry alone, with no manifest: there is nothing to read
 * one from. The version shown is the newest the channel does have, so the card
 * can say what exists rather than looking broken.
 */
export function resolveUnavailableGameInfo(
  entry: CatalogGameEntry,
  availableVersions: Record<string, PlatformVersion>
): GameInfo {
  const offered = Object.entries(availableVersions);
  const newest = offered.reduce<PlatformVersion | null>((best, [, v]) => {
    if (!best) return v;
    return v.version > best.version ? v : best;
  }, null);

  return {
    id: entry.id,
    channel: entry.channel ?? 'stable',
    name: entry.name ?? entry.id,
    description: entry.description ?? '',
    developer: entry.developer ?? 'Pandawan Corp',
    genre: entry.genre ?? [],
    iconUrl: resolveCdnUrl(entry.iconUrl),
    bannerUrl: resolveCdnUrl(entry.bannerUrl),
    screenshots: (entry.screenshots ?? []).map(resolveCdnUrl),
    version: newest?.version ?? '',
    sizeBytes: 0,
    isAvailableOnThisPlatform: false,
    releaseDate: new Date().toISOString(),
    supportedPlatforms: entry.supportedPlatforms ?? Object.keys(availableVersions),
    availableChannels: entry.availableChannels,
    availableVersions,
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

/** Per-platform "which version is current" pointer for a channel. */
export function latestIndexUrl(id: string, channel: string = 'stable'): string {
  return `${CdnUrl.gamesPath(id, channel)}/latest.json`;
}

/**
 * Manifest for one specific version. Version-stamped paths are immutable, so a
 * client that resolved a version once can cache its manifest indefinitely.
 */
export function versionedManifestUrl(id: string, channel: string, version: string): string {
  return `${CdnUrl.gamesPath(id, channel)}/${version}/manifest.json`;
}

/**
 * Background check for catalog changes.
 *
 * The launcher reads the catalog once at startup, so a game published while it
 * was open stayed invisible until a restart. A desktop app has no push channel
 * from the CDN, so this polls a cheap fingerprint instead, and only asks the user
 * to refresh when something actually moved.
 *
 * The fingerprint is content (game ids, channels, versions, build numbers), not
 * the document's Last-Modified: R2 bumps that on a re-upload of identical bytes,
 * which would raise a false "new content" after every republish.
 */

/** How often to look for new content. */
export const CATALOG_POLL_MS = 5 * 60 * 1000;

/**
 * Stable string summarizing catalog content; any meaningful change alters it.
 *
 * Presentation fields are included deliberately. They were left out at first,
 * which meant a republish that only changed artwork or copy produced an identical
 * fingerprint: the running launcher saw no change, never offered the refresh, and
 * kept rendering the old art until the user restarted it by hand.
 */
export function fingerprintCatalog(catalog: { games?: Array<Record<string, unknown>> }): string {
  const games = catalog.games ?? [];
  return games
    .map((game) =>
      [
        String(game.id ?? ''),
        String(game.channel ?? ''),
        String(game.version ?? ''),
        String(game.build_number ?? ''),
        String(game.name ?? ''),
        String(game.iconUrl ?? ''),
        String(game.bannerUrl ?? ''),
        String(game.description ?? ''),
        Array.isArray(game.genre) ? game.genre.join(',') : String(game.genre ?? ''),
      ].join('|')
    )
    .sort()
    .join('\n');
}

export interface CatalogPollHandle {
  /** Stop polling. Safe to call more than once. */
  stop: () => void;
}

/**
 * Poll `loadCatalog` and call `onChange` when its fingerprint first differs from
 * the baseline.
 *
 * Polling is skipped while `isBusy` reports the user mid-download or a game
 * running. Applying a catalog change rebuilds the game list, which would make an
 * in-progress download's progress state vanish from under them. Those are
 * precisely the moments worth protecting, so the check is deferred a cycle
 * rather than dropped.
 */
export function startCatalogPoll(options: {
  loadCatalog: () => Promise<{ catalog: unknown }>;
  onChange: () => void;
  isBusy?: () => boolean;
  intervalMs?: number;
}): CatalogPollHandle {
  const interval = options.intervalMs ?? CATALOG_POLL_MS;
  let baseline: string | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (ms: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void tick(), ms);
  };

  const tick = async () => {
    if (stopped) return;

    if (options.isBusy?.()) {
      schedule(interval);
      return;
    }

    try {
      const result = await options.loadCatalog();
      // The load is a network round trip, so `stop()` can land while it is in
      // flight. Reporting the change after that would raise the stale dot on a
      // component that is already gone, or one a later poller already replaced.
      if (stopped) return;
      const next = fingerprintCatalog(result.catalog as never);
      if (baseline === null) {
        baseline = next;
      } else if (next !== baseline) {
        baseline = next;
        options.onChange();
      }
    } catch {
      // A failed poll is not worth surfacing: the next tick retries, and the
      // title bar already reports an unreachable server when it is real.
    }

    schedule(interval);
  };

  void tick();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
