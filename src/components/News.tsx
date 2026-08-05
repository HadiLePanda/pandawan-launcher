import { useTranslation } from 'react-i18next';
import { Calendar } from 'lucide-react';
import { EmptyState } from '@components/EmptyState';
import { useLauncherStore } from '@/lib/store';
import { resolveCdnUrl } from '@/lib/cdn';
import type { NewsItem } from '@/types';

interface NewsProps {
  onSelectArticle?: (article: NewsItem) => void;
}

export function News({ onSelectArticle }: NewsProps) {
  const { t } = useTranslation();
  const { news } = useLauncherStore();

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
            {item.imageUrl && (
              <div className="news-thumb">
                <img src={resolveCdnUrl(item.imageUrl)} alt={item.title} />
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
