import type { NewsItem } from '@/types';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { CdnUrl } from './cdn';
import { logger } from './logger';

export interface NewsFeed {
  items: NewsItem[];
  updatedAt?: string;
}

/**
 * Load the launcher news feed from the CDN.
 * Falls back to an empty feed if the request fails so the launcher stays usable offline.
 */
export async function loadNews(): Promise<NewsItem[]> {
  try {
    const url = CdnUrl.news();
    const response = /^https?:\/\//i.test(url)
      ? await tauriFetch(url, { headers: { Accept: 'application/json' } })
      : await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`News feed returned ${response.status}: ${response.statusText}`);
    }

    const feed = await response.json();
    return validateNewsFeed(feed).items;
  } catch (err) {
    logger.warn('Failed to load news feed', { error: String(err) });
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
