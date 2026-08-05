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
