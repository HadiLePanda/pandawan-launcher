import { Gamepad2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GameInfo } from '@/types';

interface GameSidebarProps {
  games: GameInfo[];
  installedIds: Set<string>;
  selectedGameId: string | null;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, gameId: string) => void;
  filters?: React.ReactNode;
}

export function GameSidebar({
  games,
  installedIds,
  selectedGameId,
  onSelect,
  onContextMenu,
  filters,
}: GameSidebarProps) {
  const handleContextMenu = (e: React.MouseEvent, gameId: string) => {
    e.preventDefault();
    onContextMenu(e, gameId);
  };

  return (
    <aside className="game-sidebar no-drag">
      <div className="game-sidebar-list">
        {games.map((game) => {
          const isInstalled = installedIds.has(game.id);
          const isSelected = game.id === selectedGameId;
          const iconClass = cn(
            'game-sidebar-icon',
            isInstalled && 'installed',
            isSelected && 'selected'
          );

          return (
            <button
              key={game.id}
              type="button"
              className="p-0 bg-transparent border-0"
              title={game.name}
              aria-label={game.name}
              onClick={() => onSelect(game.id)}
              onContextMenu={(e) => handleContextMenu(e, game.id)}
            >
              {game.iconUrl ? (
                <img src={game.iconUrl} alt="" className={iconClass} />
              ) : (
                <div
                  className={cn(
                    iconClass,
                    'flex items-center justify-center bg-surface-light'
                  )}
                >
                  <Gamepad2 className="w-4 h-4 text-ink-muted" />
                </div>
              )}
            </button>
          );
        })}
      </div>
      {filters != null && (
        <>
          <div className="sidebar-separator" />
          {filters}
        </>
      )}
    </aside>
  );
}
