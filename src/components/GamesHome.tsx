import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { Game } from '@/types';
import { Gamepad2 } from 'lucide-react';

/** Banner -> icon -> glyph. Truthiness cannot tell "no banner" from "the banner 404ed". */
function CardArt({ bannerUrl, iconUrl }: { bannerUrl?: string; iconUrl?: string }) {
  const sources = [bannerUrl, iconUrl].filter((url): url is string => Boolean(url));
  const [index, setIndex] = useState(0);
  const src = sources[index];

  if (!src) {
    return (
      <div className="game-card-fallback">
        <Gamepad2 className="w-10 h-10" />
      </div>
    );
  }

  return (
    <img src={src} alt="" className="game-card-image" onError={() => setIndex((i) => i + 1)} />
  );
}

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
        <CardArt bannerUrl={game.info.bannerUrl} iconUrl={game.info.iconUrl} />
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
