import { ReactNode } from 'react';
import type { Game } from '@/types';

interface GamesPageProps {
  games: Game[];
  children: ReactNode;
}

export function GamesPage({ games, children }: GamesPageProps) {
  if (games.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <h2 className="text-xl font-semibold mb-2">No Games Yet</h2>
        <p className="text-ink-muted">Install a game from the store to get started.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden">
      {children}
    </div>
  );
}
