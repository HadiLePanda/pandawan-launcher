import { cn, formatBytes } from '@/lib/utils';
import type { Game } from '@/types';

interface GamesHomeProps {
  games: Game[];
  onSelectGame: (gameId: string | null) => void;
}

export function GamesHome({ games, onSelectGame }: GamesHomeProps) {
  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {games.map((game) => (
            <GameCard key={game.info.id} game={game} onClick={() => onSelectGame(game.info.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function GameCard({ game, onClick }: { game: Game; onClick: () => void }) {
  const initials = game.info.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const isInstalled = game.status === 'installed';

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col gap-3 p-3 rounded-2xl glass border border-border hover:border-border-strong hover:bg-surface/60 transition-colors text-left'
      )}
    >
      <div className="aspect-[4/5] rounded-xl bg-surface/70 border border-border flex items-center justify-center text-5xl font-bold overflow-hidden">
        {game.info.iconUrl ? (
          <img src={game.info.iconUrl} alt={game.info.name} className="w-full h-full object-cover" />
        ) : (
          initials
        )}
      </div>
      <div>
        <h3 className="font-semibold truncate">{game.info.name}</h3>
        <p className="text-xs text-ink-muted truncate">{game.info.developer}</p>
        <div className="flex items-center justify-between mt-2">
          <span className={cn('text-xs px-2 py-0.5 rounded-full', isInstalled ? 'bg-action/10 text-action border border-action/20' : 'bg-surface/50 text-ink-muted border border-border')}>
            {isInstalled ? 'Installed' : 'Not Installed'}
          </span>
          <span className="text-xs text-ink-muted">{formatBytes(game.info.sizeBytes)}</span>
        </div>
      </div>
    </button>
  );
}
