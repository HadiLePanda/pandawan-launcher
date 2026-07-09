import { cn, formatBytes } from '@/lib/utils';
import type { Game } from '@/types';

interface GamesHomeProps {
  games: Game[];
  onSelectGame: (gameId: string | null) => void;
}

export function GamesHome({ games, onSelectGame }: GamesHomeProps) {
  return (
    <div className="h-full overflow-auto page">
      <div className="max-w-6xl mx-auto">
        <div className="games-grid">
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
    <button onClick={onClick} className="game-card">
      <div className="game-card-art">
        {game.info.iconUrl ? (
          <img src={game.info.iconUrl} alt={game.info.name} />
        ) : (
          initials
        )}
      </div>
      <div>
        <h3 className="game-card-title">{game.info.name}</h3>
        <div className="game-card-meta">
          <span className={cn('badge', isInstalled ? 'badge-success' : 'badge-default')}>
            {isInstalled ? 'Installed' : 'Not Installed'}
          </span>
          <span className="caption">{formatBytes(game.info.sizeBytes)}</span>
        </div>
      </div>
    </button>
  );
}
