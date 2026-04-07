import { Sparkles, ArrowRight } from 'lucide-react';

export function Store() {
  return (
    <div className="h-full overflow-auto">
      {/* Featured Hero */}
      <div className="relative h-[60vh] min-h-[500px]">
        <div 
          className="absolute inset-0 bg-cover bg-center"
          style={{ 
            backgroundImage: 'url(https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1920&h=1080&fit=crop)' 
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/50 to-transparent" />
        </div>
        
        <div className="relative h-full flex items-end p-12">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-accent" />
              <span className="text-sm font-medium text-accent uppercase tracking-wider">Featured</span>
            </div>
            <h1 className="text-6xl font-bold mb-4">Quirheim Online</h1>
            <p className="text-xl text-ink-muted mb-8">
              Embark on an epic MMORPG adventure in the mystical world of Quirheim. 
              Forge your legend today.
            </p>
            <button className="flex items-center gap-3 px-8 py-4 bg-accent hover:bg-accent-hover text-white rounded-xl font-semibold text-lg transition-all btn-press">
              View Game
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Categories */}
      <div className="p-12">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl font-bold mb-8">Browse by Category</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {['Action', 'Adventure', 'Strategy', 'RPG', 'Simulation', 'Sports', 'Racing', 'Puzzle'].map((category) => (
              <button
                key={category}
                className="aspect-[2/1] rounded-xl bg-surface hover:bg-surface-light transition-colors flex items-center justify-center font-medium text-lg"
              >
                {category}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
