import { Gamepad2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Game } from '@/types';

interface GameIconsBarProps {
  games: Game[];
  selectedGameId: string | null;
  onSelectGameIcon: (gameId: string | null) => void;
}

export function GameIconsBar({ games, selectedGameId, onSelectGameIcon }: GameIconsBarProps) {
  const isAllSelected = selectedGameId === null;

  return (
    <div className="games-navbar-wrap shrink-0">
      <div className="games-navbar-panel no-drag">
        <button
          onClick={() => onSelectGameIcon(null)}
          className={cn('game-icon', isAllSelected && 'game-icon-active')}
          title="All Games"
          aria-label="All Games"
        >
          <NineSquareIcon className="w-5 h-5" />
          {isAllSelected && <span className="game-icon-indicator" />}
        </button>

        <div className="games-list no-scrollbar">
          {games.map((game) => (
            <GameIcon
              key={game.info.id}
              game={game}
              isSelected={game.info.id === selectedGameId}
              onClick={() => onSelectGameIcon(game.info.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function GameIcon({
  game,
  isSelected,
  onClick,
}: {
  game: Game;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn('game-icon', isSelected && 'game-icon-active')}
      title={game.info.name}
      aria-label={game.info.name}
    >
      {game.info.iconUrl ? (
        <img
          src={game.info.iconUrl}
          alt={game.info.name}
          className={cn(
            'transition-opacity',
            isSelected ? 'opacity-100' : 'opacity-60',
            !isSelected && 'hover:opacity-85'
          )}
        />
      ) : (
        <Gamepad2
          className={cn(
            'w-5 h-5 transition-opacity',
            isSelected ? 'opacity-100' : 'opacity-60',
            !isSelected && 'hover:opacity-85'
          )}
        />
      )}
      {isSelected && <span className="game-icon-indicator" />}
    </button>
  );
}

function NineSquareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      {Array.from({ length: 9 }).map((_, i) => (
        <rect
          key={i}
          x={4 + (i % 3) * 6}
          y={4 + Math.floor(i / 3) * 6}
          width="4"
          height="4"
          rx="1"
        />
      ))}
    </svg>
  );
}
