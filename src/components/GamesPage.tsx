import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@components/EmptyState';
import type { Game } from '@/types';

interface GamesPageProps {
  games: Game[];
  children: ReactNode;
}

export function GamesPage({ games, children }: GamesPageProps) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex-1 overflow-hidden flex flex-col relative">
        {games.length === 0 ? (
          // One box that centres itself in the space it fills. Previously the
          // wrapper centred a block that carried its own padding, which put the
          // text slightly off-axis.
          <div className="games-page-empty">
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
