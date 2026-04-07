import { Newspaper, Calendar } from 'lucide-react';

const NEWS_ITEMS = [
  {
    id: 1,
    title: 'Quirheim Online: New Expansion Announced',
    excerpt: 'Discover the Frozen North in the biggest update yet, featuring new dungeons, raids, and legendary loot.',
    image: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&h=400&fit=crop',
    date: '2024-12-15',
    category: 'Update',
  },
  {
    id: 2,
    title: 'Pixel Odyssey Reaches 1 Million Players',
    excerpt: 'Thank you to our amazing community for making this indie adventure a massive success!',
    image: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&h=400&fit=crop',
    date: '2024-12-10',
    category: 'Community',
  },
  {
    id: 3,
    title: 'Stellar Command Season 3 Begins',
    excerpt: 'New commanders, new ships, and a galaxy at war. Join the fight for supremacy.',
    image: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=800&h=400&fit=crop',
    date: '2024-12-05',
    category: 'Event',
  },
  {
    id: 4,
    title: 'Pandawan Launcher 2.0 Released',
    excerpt: 'Faster downloads, better UI, and new features. Update now to experience the difference.',
    image: 'https://images.unsplash.com/photo-1551434678-e076c223a692?w=800&h=400&fit=crop',
    date: '2024-12-01',
    category: 'Launcher',
  },
];

export function News() {
  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Newspaper className="w-8 h-8 text-accent" />
          <h1 className="text-3xl font-bold">News & Updates</h1>
        </div>

        <div className="space-y-6">
          {NEWS_ITEMS.map((item) => (
            <article
              key={item.id}
              className="group bg-surface rounded-2xl overflow-hidden hover:bg-surface-light transition-colors cursor-pointer"
            >
              <div className="flex gap-6 p-6">
                <div className="w-48 h-32 rounded-xl overflow-hidden flex-shrink-0">
                  <img
                    src={item.image}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-accent-muted text-accent">
                        {item.category}
                      </span>
                      <span className="flex items-center gap-1.5 text-sm text-ink-muted">
                        <Calendar className="w-4 h-4" />
                        {new Date(item.date).toLocaleDateString()}
                      </span>
                    </div>
                    <h2 className="text-xl font-semibold mb-2 group-hover:text-accent transition-colors">
                      {item.title}
                    </h2>
                    <p className="text-ink-muted line-clamp-2">
                      {item.excerpt}
                    </p>
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
