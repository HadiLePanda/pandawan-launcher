import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <GameIconsBar
        games={games}
        selectedGameId={selectedGameId}
        onSelectGameIcon={onSelectGameIcon}
      />
      <div className="flex-1 overflow-hidden flex flex-col relative">
        {games.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              title={t('gamesPage.emptyTitle')}
              description={t('gamesPage.emptyDescription')}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col">{children}</div>
        )}
      </div>
    </div>
  );
}
