import { useState } from 'react';
import { Calendar, ArrowLeft } from 'lucide-react';
import { EmptyState } from '@components/EmptyState';
import { useLauncherStore } from '@/lib/store';
import { resolveCdnUrl } from '@/lib/cdn';
import type { NewsItem } from '@/types';

export function News() {
  const { news } = useLauncherStore();
  const [selectedItem, setSelectedItem] = useState<NewsItem | null>(null);

  if (news.length === 0) {
    return (
      <div className="flex-1 flex flex-col justify-center">
        <EmptyState
          title="No News Yet"
          description="Check back later for updates."
        />
      </div>
    );
  }

  if (selectedItem) {
    return (
      <div className="h-full overflow-auto page">
        <div className="max-w-3xl mx-auto">
          <button
            onClick={() => setSelectedItem(null)}
            className="btn btn-ghost mb-4 -ml-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to news
          </button>

          <article className="news-detail-card">
            {selectedItem.imageUrl && (
              <div className="news-detail-image">
                <img src={resolveCdnUrl(selectedItem.imageUrl)} alt={selectedItem.title} />
              </div>
            )}
            <div className="news-detail-body">
              <div className="news-detail-meta">
                {selectedItem.category && (
                  <span className="badge badge-default">{selectedItem.category}</span>
                )}
                <span className="cluster cluster-sm caption">
                  <Calendar className="w-4 h-4" />
                  {new Date(selectedItem.date).toLocaleDateString()}
                </span>
              </div>
              <h1 className="news-detail-title">{selectedItem.title}</h1>
              <p className="news-detail-excerpt">{selectedItem.excerpt}</p>
              {selectedItem.content && (
                <div className="news-detail-content">{selectedItem.content}</div>
              )}
            </div>
          </article>
        </div>
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
            onClick={() => setSelectedItem(item)}
          >
            <div className="news-body">
              <div>
                <div className="news-meta">
                  {item.category && (
                    <span className="badge badge-default">
                      {item.category}
                    </span>
                  )}
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
