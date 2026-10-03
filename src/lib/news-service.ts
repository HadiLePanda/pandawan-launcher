import type { NewsItem } from '@/types';
import { fetchRemoteText } from './catalog-service';
import { CdnUrl } from './cdn';
import { logger } from './logger';

export interface NewsFeed {
  items: NewsItem[];
  updatedAt?: string;
}

/**
 * Load the launcher news feed from the CDN.
 *
 * Falls back to the copy bundled at public/news.json before giving up, so a
 * player who is offline still sees the announcements that shipped with their
 * version of the launcher rather than an empty tab. The bundled copy is the
 * fallback only: the CDN is authoritative, because a news item posted after a
 * build was made has to reach players who already have that build.
 */
export async function loadNews(): Promise<NewsItem[]> {
  try {
    const feed = JSON.parse(await fetchRemoteText(CdnUrl.news()));
    return validateNewsFeed(feed).items;
  } catch (err) {
    logger.warn('Remote news feed unavailable, using bundled copy', { error: String(err) });
    return loadEmbeddedNews();
  }
}

/** The news feed shipped inside the app bundle, or an empty feed if unreadable. */
async function loadEmbeddedNews(): Promise<NewsItem[]> {
  try {
    const response = await fetch('/news.json');
    if (!response.ok) return [];
    return validateNewsFeed(await response.json()).items;
  } catch (err) {
    logger.warn('No embedded news feed found', { error: String(err) });
    return [];
  }
}

function validateNewsFeed(feed: unknown): NewsFeed {
  if (!feed || typeof feed !== 'object') {
    throw new Error('News feed must be an object');
  }

  const raw = feed as Record<string, unknown>;
  const items = Array.isArray(raw.items) ? raw.items : [];

  return {
    items: items.filter(isValidNewsItem).map((item) => item as NewsItem),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  };
}

function isValidNewsItem(item: unknown): item is NewsItem {
  if (!item || typeof item !== 'object') return false;
  const i = item as Record<string, unknown>;
  return typeof i.id === 'string' && !!i.id && typeof i.title === 'string' && !!i.title;
}
