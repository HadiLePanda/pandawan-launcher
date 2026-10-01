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
  // A game with no build for this OS is still listed, greyed. Hiding it would
  // leave a Mac player wondering where Misspell went; showing it as normal would
  // offer an install that cannot possibly run.
  const unavailable = !game.info.isAvailableOnThisPlatform;

  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={(e) => onContextMenu?.(e, game.info.id)}
      className={cn(
        'game-card',
        !isInstalled && 'game-card-uninstalled',
        unavailable && 'game-card-unavailable'
      )}
      title={unavailable ? t('gamesHome.unavailableOnPlatform') : game.info.name}
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
        <p className="game-card-genre">
          {unavailable
            ? t('gamesHome.unavailableOnPlatform')
            : genres || t('gamesHome.unknownGenre')}
        </p>
      </div>
    </button>
  );
}
