import { Calendar } from 'lucide-react';
import { useLauncherStore } from '@/lib/store';

export function News() {
  const { news } = useLauncherStore();

  return (
    <div className="h-full overflow-auto">
      <div className="p-8">
        <div className="max-w-4xl mx-auto space-y-4">
          {news.length === 0 && (
            <p className="text-center text-ink-muted py-12">No news available right now.</p>
          )}
          {news.map((item) => (
            <article
              key={item.id}
              className="bg-surface rounded-xl overflow-hidden border border-border hover:border-border-strong transition-colors"
            >
              <div className="flex gap-6 p-6">
                {item.imageUrl && (
                  <div className="w-48 h-32 rounded-lg overflow-hidden flex-shrink-0 bg-surface-light">
                    <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      {item.category && (
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-accent-muted text-accent border border-accent/20">
                          {item.category}
                        </span>
                      )}
                      <span className="flex items-center gap-[6px] text-sm text-ink-muted">
                        <Calendar className="w-4 h-4" />
                        {new Date(item.date).toLocaleDateString()}
                      </span>
                    </div>
                    <h2 className="text-xl font-semibold mb-2">{item.title}</h2>
                    <p className="text-ink-muted line-clamp-2">{item.excerpt}</p>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
