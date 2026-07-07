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
    <aside className="w-[72px] bg-canvas border-r border-border flex flex-col items-center py-4 gap-2 relative overflow-hidden">
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-canvas-light/30 pointer-events-none" />
      {/* Logo */}
      <div className="mb-6 relative z-10">
        <div className="w-10 h-10 flex items-center justify-center text-ink">
          <svg className="w-9 h-9" viewBox="0 0 512 512" fill="currentColor">
            <path d="M104.75 16.813c-24.29.552-47.924 8.42-62.844 26.03C29.71 57.24 27.212 75.418 31.126 93.438c3.912 18.02 13.678 36.518 26.25 55.063l.124.156C41.142 180.15 32 216.558 32 256c0 64 32 128 96 128c32 48 32 96 128 96s96-48 128-96c64 0 96-48 96-128c0-39.442-9.142-75.85-25.5-107.344l.125-.156c12.57-18.545 22.337-37.042 26.25-55.063c3.913-18.02 1.414-36.197-10.78-50.593c-15.915-18.785-41.757-26.468-67.72-26.032c-25.963.437-52.602 8.894-71.563 25.094l-1.593 1.344C306.473 35.923 281.892 32 256 32s-50.474 3.923-73.22 11.25l-1.593-1.344c-18.96-16.2-45.6-24.657-71.562-25.093a122 122 0 0 0-4.875 0m.375 16c1.397-.034 2.808-.024 4.22 0c19.96.335 40.684 6.498 55.81 16.968C123.906 67.025 89.78 96 66.406 133.095c-9.75-15.32-16.81-30.108-19.624-43.063c-3.203-14.755-1.46-26.517 7.314-36.874c10.937-12.91 30.08-19.842 51.03-20.343zm297.53 0c22.574-.38 43.585 6.572 55.25 20.343c8.775 10.357 10.518 22.12 7.314 36.875c-2.814 12.956-9.874 27.743-19.626 43.064c-23.372-37.096-57.5-66.07-98.75-83.313c15.127-10.47 35.85-16.632 55.812-16.968zM176 144c16 0 48 16 48 64c0 64-48 96-80 96s-48-64-48-96s64-64 80-64m160 0c16 0 80 32 80 64s-16 96-48 96s-80-32-80-96c0-48 32-64 48-64m-143.53 80A16 16 0 0 0 176 240a16 16 0 0 0 32 0a16 16 0 0 0-15.53-16m128 0A16 16 0 0 0 304 240a16 16 0 0 0 32 0a16 16 0 0 0-15.53-16M256 340c12 0 24 4 48 12l-48 48l-48-48c24-8 36-12 48-12m-59.563 69.344C219.756 424.89 238.133 432 256 432s36.245-7.11 59.563-22.656l8.875 13.312C299.755 439.11 278.132 448 256 448s-43.755-8.89-68.438-25.344z" />
          </svg>
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
