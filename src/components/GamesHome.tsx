import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { Game } from '@/types';
import { Gamepad2 } from 'lucide-react';

interface GamesHomeProps {
  games: Game[];
  onSelectGame: (gameId: string) => void;
  onContextMenu?: (e: React.MouseEvent, gameId: string) => void;
}

export function GamesHome({ games, onSelectGame, onContextMenu }: GamesHomeProps) {
  return (
    <div className="h-full overflow-auto games-home">
      <div className="games-grid">
        {games.map((game) => (
          <GameCard
            key={game.info.id}
            game={game}
            onClick={() => onSelectGame(game.info.id)}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    </div>
  );
}

function GameCard({
  game,
  onClick,
  onContextMenu,
}: {
  game: Game;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent, gameId: string) => void;
}) {
  const { t } = useTranslation();
  const isInstalled = game.status === 'installed';
  const genres = game.info.genre.join(', ');

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={(e) => onContextMenu?.(e, game.info.id)}
      className={cn('game-card', !isInstalled && 'game-card-uninstalled')}
      title={game.info.name}
    >
      <div className="game-card-art">
        {game.info.bannerUrl ? (
          <img src={game.info.bannerUrl} alt="" className="game-card-image" />
        ) : game.info.iconUrl ? (
          <img src={game.info.iconUrl} alt="" className="game-card-image" />
        ) : (
          <div className="game-card-fallback">
            <Gamepad2 className="w-10 h-10" />
          </div>
        )}
      </div>
      <div className="game-card-content">
        <h3 className="game-card-title">{game.info.name}</h3>
        <p className="game-card-genre">{genres || t('gamesHome.unknownGenre')}</p>
      </div>
    </button>
  );
}
