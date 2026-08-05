import { Gamepad2 } from 'lucide-react';
import type { GameInfo } from '@/types';

export interface GameRailProps {
  games: GameInfo[];
  installedIds: Set<string>;
  selectedGameId: string | null;
  onSelect: (gameId: string) => void;
  onContextMenu: (e: React.MouseEvent, gameId: string) => void;
}

export function GameRail({
  games,
  installedIds,
  selectedGameId,
  onSelect,
  onContextMenu,
}: GameRailProps) {
  return (
    <div className="game-rail no-scrollbar" data-testid="game-rail">
      {games.map((game) => (
        <div key={game.id} className="game-rail-item">
          <button
            type="button"
            className={[
              'game-rail-icon',
              installedIds.has(game.id) ? 'installed' : '',
              selectedGameId === game.id ? 'selected' : '',
            ].join(' ')}
            aria-label={game.name}
            onClick={() => onSelect(game.id)}
            onContextMenu={(e) => onContextMenu(e, game.id)}
          >
            {game.iconUrl ? (
              <img src={game.iconUrl} alt="" className="w-full h-full object-cover rounded-[6px]" />
            ) : (
              <Gamepad2 size={20} />
            )}
          </button>
          <span className="game-rail-tip">{game.name}</span>
        </div>
      ))}
    </div>
  );
}
