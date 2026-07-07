import { Plus } from 'lucide-react';
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
    <aside className="w-[72px] bg-action border-r border-action-hover flex flex-col items-center py-4 gap-2 relative overflow-hidden">
      {/* Games */}
      <div className="flex flex-col gap-2 flex-1">
        {installedGames.map((game) => (
          <GameIcon
            key={game.info.id}
            game={game}
            isSelected={selectedGameId === game.info.id}
            onClick={() => onSelectGame(game.info.id)}
          />
        ))}
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

      {/* Add Game Button */}
      <button
        onClick={onAddGame}
        className="w-12 h-12 rounded-xl border-2 border-dashed border-white/30 hover:border-white hover:text-white text-white/70 flex items-center justify-center transition-all group relative z-10"
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
          ? 'ring-2 ring-white ring-offset-2 ring-offset-action scale-105 shadow-lg'
          : 'hover:scale-105 hover:ring-2 hover:ring-white/50 hover:ring-offset-2 hover:ring-offset-action',
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
        <div className="w-full h-full bg-gradient-to-br from-white/20 to-white/10 flex items-center justify-center">
          <span className="text-xs font-bold text-white/80">
            {game.info.name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}

      {/* Status indicators */}
      {hasUpdate && (
        <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-accent rounded-full border-2 border-action" />
      )}
      {isDownloading && (
        <div className="absolute inset-0 bg-action/80 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {game.status === 'running' && (
        <div className="absolute inset-0 bg-action-light/20 flex items-center justify-center">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
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
