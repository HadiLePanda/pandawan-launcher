import { useTranslation } from 'react-i18next';
import { Download, X, Gamepad2 } from 'lucide-react';

import type { DownloadProgressSnapshot } from '@/lib/download-channel';
import type { GameInfo } from '@/types';

interface DownloadsPageProps {
  downloads: Map<string, DownloadProgressSnapshot>;
  games: GameInfo[];
  onCancel: (gameId: string) => void;
}

export function DownloadsPage({ downloads, games, onCancel }: DownloadsPageProps) {
  const { t } = useTranslation();

  if (downloads.size === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center downloads-empty">
        <Download className="w-12 h-12 mb-4 opacity-40" />
        <p className="text-ink-muted">{t('downloads.empty')}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto downloads-page">
      <h2 className="downloads-title">{t('downloads.title')}</h2>
      <div className="downloads-list">
        {Array.from(downloads.entries()).map(([gameId, progress]) => {
          const game = games.find((g) => g.id === gameId);
          const pct = Math.round(progress.overallProgress || progress.progress || 0);

          return (
            <div key={gameId} className="download-row">
              <div className="download-row-icon">
                {game?.iconUrl ? (
                  <img src={game.iconUrl} alt="" />
                ) : (
                  <Gamepad2 className="w-5 h-5" />
                )}
              </div>
              <div className="download-row-body">
                <div className="download-row-header">
                  <span className="download-row-name">{game?.name ?? gameId}</span>
                  <span className="download-row-percent">{pct}%</span>
                </div>
                <div className="download-row-bar">
                  <div className="download-row-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="download-row-meta">
                  <span>
                    {t('gamePage.filesProgress', {
                      completed: progress.completedFiles,
                      total: progress.totalFiles,
                    })}
                  </span>
                  {progress.speed && <span>{progress.speed}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onCancel(gameId)}
                className="download-row-cancel"
                title={t('downloads.cancel')}
                aria-label={t('downloads.cancel')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
