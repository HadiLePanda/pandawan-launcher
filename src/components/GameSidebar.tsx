import { Plus, Gamepad2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Game } from '@/types';

interface GameSidebarProps {
  games: Game[];
  selectedGameId: string | null;
  onSelectGame: (gameId: string) => void;
  onAddGame: () => void;
}

export function GameSidebar({ games, selectedGameId, onSelectGame, onAddGame }: GameSidebarProps) {
  const installedGames = games.filter((g) => g.status !== 'not_installed');
  const availableGames = games.filter((g) => g.status === 'not_installed');

  return (
    <aside className="w-[72px] bg-canvas border-r border-border flex flex-col items-center py-4 gap-2 relative overflow-hidden">
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-canvas-light/30 pointer-events-none" />
      {/* Logo */}
      <div className="mb-6 relative z-10">
        <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center shadow-glow animate-glow-pulse">
          <Gamepad2 className="w-5 h-5 text-white" />
        </div>
      </div>

      {/* Divider */}
      <div className="w-8 h-px bg-border mb-2" />

      {/* Installed Games */}
      <div className="flex flex-col gap-2">
        {installedGames.map((game) => (
          <GameIcon
            key={game.info.id}
            game={game}
            isSelected={selectedGameId === game.info.id}
            onClick={() => onSelectGame(game.info.id)}
          />
        ))}
      </div>

      {/* Available Games (dimmed) */}
      {availableGames.length > 0 && (
        <>
          <div className="w-8 h-px bg-border my-2" />
          <div className="flex flex-col gap-2">
            {availableGames.map((game) => (
              <GameIcon
                key={game.info.id}
                game={game}
                isSelected={selectedGameId === game.info.id}
                onClick={() => onSelectGame(game.info.id)}
                isAvailable
              />
            ))}
          </div>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Add Game Button */}
      <button
        onClick={onAddGame}
        className="w-12 h-12 rounded-xl border-2 border-dashed border-border hover:border-accent hover:text-accent text-ink-muted flex items-center justify-center transition-all group hover-glow-accent relative z-10"
        title="Install New Game"
      >
        <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
      </button>
    </aside>
  );
}

interface GameIconProps {
  game: Game;
  isSelected: boolean;
  onClick: () => void;
  isAvailable?: boolean;
}

function GameIcon({ game, isSelected, onClick, isAvailable }: GameIconProps) {
  const hasUpdate = game.status === 'installed' && game.hasUpdate;
  const isDownloading = game.status === 'downloading' || game.status === 'updating';

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative w-12 h-12 rounded-xl overflow-hidden transition-all duration-200 group',
        isSelected
          ? 'ring-2 ring-accent ring-offset-2 ring-offset-canvas scale-105 shadow-glow'
          : 'hover:scale-105 hover:ring-2 hover:ring-border hover:ring-offset-2 hover:ring-offset-canvas',
        isAvailable && 'opacity-50'
      )}
      title={game.info.name}
    >
      {game.info.iconUrl ? (
        <img
          src={game.info.iconUrl}
          alt={game.info.name}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-surface-light to-surface flex items-center justify-center">
          <span className="text-xs font-bold text-ink-muted">
            {game.info.name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}

      {/* Status indicators */}
      {hasUpdate && (
        <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-status-updating rounded-full border-2 border-canvas" />
      )}
      {isDownloading && (
        <div className="absolute inset-0 bg-canvas/80 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {game.status === 'running' && (
        <div className="absolute inset-0 bg-status-ready/20 flex items-center justify-center">
          <div className="w-2 h-2 bg-status-ready rounded-full animate-pulse" />
        </div>
      )}

      {/* Hover tooltip */}
      <div className="absolute left-full ml-3 px-3 py-1.5 bg-surface border border-border rounded-lg text-sm whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
        {game.info.name}
        <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-2 h-2 bg-surface border-l border-b border-border rotate-45" />
      </div>
    </button>
  );
}
