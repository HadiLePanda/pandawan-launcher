import { Settings, Bell, User, Sun, Moon, SunMoon, Gamepad2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLauncherStore } from '@/lib/store';
import type { Game } from '@/types';

interface AppTopBarProps {
  activeView: 'games' | 'news' | 'store';
  selectedGameId: string | null;
  games: Game[];
  onGamesClick: () => void;
  onNewsClick: () => void;
  onStoreClick: () => void;
  onSettingsClick: () => void;
  onPlayerClick: () => void;
  onSelectGameIcon: (gameId: string | null) => void;
  onDoubleClick?: () => void;
}

export function AppTopBar({
  activeView,
  selectedGameId,
  games,
  onGamesClick,
  onNewsClick,
  onStoreClick,
  onSettingsClick,
  onPlayerClick,
  onSelectGameIcon,
  onDoubleClick,
}: AppTopBarProps) {
  const { settings, setSettings } = useLauncherStore();
  const currentTheme = settings?.theme || 'adaptive';

  const handleThemeToggle = () => {
    if (!settings) return;
    const order = ['adaptive', 'light', 'dark'];
    const next = order[(order.indexOf(currentTheme) + 1) % order.length];
    setSettings({ ...settings, theme: next });
  };

  const themeIcon = currentTheme === 'light' ? <Sun className="w-[18px] h-[18px]" /> : currentTheme === 'dark' ? <Moon className="w-[18px] h-[18px]" /> : <SunMoon className="w-[18px] h-[18px]" />;
  const themeTitle = currentTheme === 'light' ? 'Light' : currentTheme === 'dark' ? 'Dark' : 'Adaptive';

  const navItems = [
    { id: 'games' as const, label: 'Games', onClick: onGamesClick },
    { id: 'news' as const, label: 'News', onClick: onNewsClick },
    { id: 'store' as const, label: 'Store', onClick: onStoreClick },
  ];

  const isAllSelected = selectedGameId === null && activeView === 'games';

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={onDoubleClick}
      className="flex flex-col px-8 shrink-0"
    >
      {/* Row 1: Logo, view nav, right controls */}
      <div className="h-20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-action to-accent flex items-center justify-center text-white font-bold text-3xl shadow-lg shadow-action/20">
            P
          </div>

          <nav className="flex items-center gap-1 no-drag">
            {navItems.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={item.onClick}
                  className={cn(
                    'px-4 py-2 text-sm font-medium rounded-lg transition-colors uppercase tracking-wide',
                    isActive ? 'text-ink bg-surface-light/80' : 'text-ink-muted hover:text-ink hover:bg-surface/50'
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1 no-drag">
          <button
            onClick={handleThemeToggle}
            className="p-[10px] rounded-lg text-ink-muted hover:text-ink hover:bg-surface/60 transition-colors"
            title={`Theme: ${themeTitle}`}
            aria-label={`Theme: ${themeTitle}`}
          >
            {themeIcon}
          </button>
          <button
            onClick={onSettingsClick}
            className="p-[10px] rounded-lg text-ink-muted hover:text-ink hover:bg-surface/60 transition-colors"
            aria-label="Settings"
          >
            <Settings className="w-[18px] h-[18px]" />
          </button>
          <button
            className="p-[10px] rounded-lg text-ink-muted hover:text-ink hover:bg-surface/60 transition-colors"
            aria-label="Notifications"
          >
            <Bell className="w-[18px] h-[18px]" />
          </button>
          <button
            onClick={onPlayerClick}
            className="ml-2 w-10 h-10 rounded-full bg-gradient-to-br from-surface-light to-surface border border-border flex items-center justify-center text-ink-muted hover:text-ink hover:border-border-strong transition-colors"
            aria-label="Player profile"
          >
            <User className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Row 2: All games icon + per-game icons */}
      <div className="h-14 flex items-center gap-3 no-drag mb-3">
        <div className="h-full flex items-center game-icons-panel rounded-xl border border-border px-2 py-[6px]">
          <button
            onClick={() => onSelectGameIcon(null)}
            className={cn(
              'w-11 h-11 rounded-xl flex items-center justify-center transition-all',
              isAllSelected
                ? 'text-action'
                : 'text-ink-muted hover:text-ink'
            )}
            title="All Games"
            aria-label="All Games"
          >
            <NineSquareIcon className="w-5 h-5" />
          </button>
          {isAllSelected && <SelectedPip />}
        </div>

        <div className="flex-1 min-w-0 h-full flex items-center gap-2 overflow-x-auto no-scrollbar game-icons-panel rounded-xl border border-border px-2 py-[6px]">
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
      className={cn(
        'relative w-11 h-11 rounded-xl flex items-center justify-center transition-all overflow-hidden shrink-0',
        isSelected
          ? 'text-ink'
          : 'text-ink-muted/60 hover:text-ink'
      )}
      title={game.info.name}
    >
      {game.info.iconUrl ? (
        <img
          src={game.info.iconUrl}
          alt={game.info.name}
          className={cn('w-full h-full object-cover transition-opacity', isSelected ? 'opacity-100' : 'opacity-60 hover:opacity-[0.85]')}
        />
      ) : (
        <Gamepad2 className={cn('w-5 h-5 transition-opacity', isSelected ? 'opacity-100' : 'opacity-60 hover:opacity-[0.85]')} />
      )}
      {isSelected && <SelectedPip />}
    </button>
  );
}

function SelectedPip() {
  return (
    <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-5 h-[6px] rounded-full bg-action shadow-[0_0_10px_rgba(40,185,104,0.75)]" />
  );
}

function NineSquareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      {Array.from({ length: 9 }).map((_, i) => (
        <rect
          key={i}
          x={3 + (i % 3) * 6}
          y={3 + Math.floor(i / 3) * 6}
          width="4"
          height="4"
          rx="1"
        />
      ))}
    </svg>
  );
}
