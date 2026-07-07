import { ReactNode } from 'react';
import { LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Game } from '@/types';

interface GamesPageProps {
  games: Game[];
  selectedGameId: string | null;
  onSelectGame: (gameId: string | null) => void;
  children: ReactNode;
}

export function GamesPage({ games, selectedGameId, onSelectGame, children }: GamesPageProps) {
  if (games.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <h2 className="text-xl font-semibold mb-2">No Games Yet</h2>
        <p className="text-ink-muted">Install a game from the store to get started.</p>
      </div>
    );
  }

  const isAllSelected = selectedGameId === null;

  return (
    <div className="h-full overflow-hidden flex flex-col">
      <div className="px-5 h-14 border-b border-border flex items-center gap-2 shrink-0">
        <button
          onClick={() => onSelectGame(null)}
          className={cn(
            'flex items-center justify-center rounded-lg transition-all w-10 h-10',
            isAllSelected
              ? 'bg-surface text-action border border-action'
              : 'bg-surface border border-border text-ink-muted hover:text-ink hover:border-border-strong'
          )}
          title="All Games"
        >
          <LayoutGrid className="w-5 h-5" />
        </button>

        {games.map((game) => (
          <GameLogo
            key={game.info.id}
            game={game}
            isSelected={game.info.id === selectedGameId}
            onClick={() => onSelectGame(game.info.id)}
          />
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function GameLogo({
  game,
  isSelected,
  onClick,
}: {
  game: Game;
  isSelected: boolean;
  onClick: () => void;
}) {
  const initials = game.info.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center justify-center rounded-lg transition-all w-10 h-10',
        isSelected
          ? 'bg-surface border border-action text-ink'
          : 'bg-surface border border-border text-ink-muted hover:border-border-strong hover:text-ink'
      )}
      title={game.info.name}
    >
      {game.info.iconUrl ? (
        <img src={game.info.iconUrl} alt={game.info.name} className="w-full h-full object-cover rounded-lg" />
      ) : (
        <span className="text-[10px] font-bold">{initials}</span>
      )}
    </button>
  );
}
