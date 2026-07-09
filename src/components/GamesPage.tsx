import { ReactNode } from 'react';
import { EmptyState } from '@components/EmptyState';
import { GameIconsBar } from '@components/GameIconsBar';
import type { Game } from '@/types';

interface GamesPageProps {
  games: Game[];
  selectedGameId: string | null;
  onSelectGameIcon: (gameId: string | null) => void;
  children: ReactNode;
}

export function GamesPage({ games, selectedGameId, onSelectGameIcon, children }: GamesPageProps) {
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <GameIconsBar
        games={games}
        selectedGameId={selectedGameId}
        onSelectGameIcon={onSelectGameIcon}
      />
      <div className="flex-1 overflow-hidden flex flex-col justify-center">
        {games.length === 0 ? (
          <EmptyState
            title="No Games Yet"
            description="Install a game from the store to get started."
          />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
