import { useTranslation } from 'react-i18next';
import { Calendar } from 'lucide-react';
import { EmptyState } from '@components/EmptyState';
import { useLauncherStore } from '@/lib/store';
import { handleImageError, resolveNewsImage } from '@/lib/cdn';
import type { NewsItem } from '@/types';

interface NewsProps {
  onSelectArticle?: (article: NewsItem) => void;
}

export function News({ onSelectArticle }: NewsProps) {
  const { t } = useTranslation();
  const { news, games } = useLauncherStore();

  /** The artwork of the game an item belongs to, for items with no image of their own. */
  const gameArt = (gameId: string) => {
    const game = games.find((g) => g.info.id === gameId);
    return game ? { bannerUrl: game.info.bannerUrl, iconUrl: game.info.iconUrl } : null;
  };

  if (news.length === 0) {
    return (
      <div className="flex-1 flex flex-col justify-center">
        <EmptyState title={t('news.emptyTitle')} description={t('news.emptyDescription')} />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto page">
      <div className="max-w-4xl mx-auto news-feed">
        {news.map((item) => (
          <article
            key={item.id}
            className="news-card cursor-pointer"
            onClick={() => onSelectArticle?.(item)}
          >
            <div className="news-body">
              <div>
                <div className="news-meta">
                  {item.category && <span className="badge badge-default">{item.category}</span>}
                  <span className="cluster cluster-sm caption">
                    <Calendar className="w-4 h-4" />
                    {new Date(item.date).toLocaleDateString()}
                  </span>
                </div>
                <h2 className="news-title">{item.title}</h2>
                <p className="news-excerpt">{item.excerpt}</p>
              </div>
            </div>
            {/* Always rendered: resolveNewsImage returns the game's artwork or a
                placeholder, never an empty string, so the card keeps its shape
                instead of collapsing around the text. onError catches the case a
                present-but-dead URL cannot be detected from here. */}
            <div className="news-thumb">
              {/* `decoding="async"` hands the decode off the main thread. With a
                  multi-megabyte banner, decoding inline blocks paint until it
                  finishes, which is the visible half of the slowness - the other
                  half is the download. */}
              <img
                decoding="async"
                src={resolveNewsImage(item, item.gameId ? gameArt(item.gameId) : null)}
                alt={item.title}
                onError={handleImageError}
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
