import { cn, formatBytes } from '@/lib/utils';
import type { Game } from '@/types';
import { Plus } from 'lucide-react';

interface GamesHomeProps {
  games: Game[];
  onSelectGame: (gameId: string | null) => void;
  onInstallGame?: () => void;
}

export function GamesHome({ games, onSelectGame, onInstallGame }: GamesHomeProps) {
  const uninstalledCount = games.filter((g) => g.status === 'not_installed').length;

  return (
    <div className="h-full overflow-auto page">
      <div className="games-grid">
        {games.map((game) => (
          <GameCard key={game.info.id} game={game} onClick={() => onSelectGame(game.info.id)} />
        ))}
        {onInstallGame && uninstalledCount > 0 && (
          <button onClick={onInstallGame} className="game-card game-card-add">
            <div className="game-card-art">
              <Plus className="w-10 h-10" />
            </div>
            <div className="game-card-content">
              <h3 className="game-card-title">Install a Game</h3>
              <p className="caption">{uninstalledCount} available</p>
            </div>
          </button>
        )}
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
      <div className="game-card-content">
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
