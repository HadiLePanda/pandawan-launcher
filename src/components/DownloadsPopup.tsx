import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Gamepad2, Download } from 'lucide-react';
import type { DownloadProgressSnapshot } from '@/lib/download-channel';
import type { GameInfo } from '@/types';

interface DownloadsPopupProps {
  downloads: Map<string, DownloadProgressSnapshot>;
  games: GameInfo[];
  onCancel: (gameId: string) => void;
  onClose: () => void;
}

export function DownloadsPopup({ downloads, games, onCancel, onClose }: DownloadsPopupProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if ((e.target as Element).closest('[data-panel-trigger]')) return;
      if (!panelRef.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      className="downloads-popup"
      role="dialog"
      aria-modal="true"
      aria-labelledby="downloads-popup-title"
    >
      <div className="downloads-popup-header">
        <span id="downloads-popup-title" className="downloads-popup-title">
          {t('downloads.title')}
        </span>
      </div>

      <div className="downloads-popup-list">
        {downloads.size === 0 ? (
          <div className="downloads-popup-empty">
            <Download className="w-8 h-8 mb-2 opacity-40" />
            <p>{t('downloads.empty')}</p>
          </div>
        ) : (
          Array.from(downloads.entries()).map(([gameId, progress]) => {
            const game = games.find((g) => g.id === gameId);
            const pct = Math.round(progress.overallProgress ?? progress.progress ?? 0);

            return (
              <div key={gameId} className="downloads-popup-item">
                <div className="downloads-popup-item-icon">
                  {game?.iconUrl ? (
                    <img src={game.iconUrl} alt="" />
                  ) : (
                    <Gamepad2 className="w-5 h-5" />
                  )}
                </div>
                <div className="downloads-popup-item-body">
                  <div className="downloads-popup-item-row">
                    <span className="downloads-popup-item-name">{game?.name ?? gameId}</span>
                    <span className="downloads-popup-item-percent">{pct}%</span>
                  </div>
                  <div className="downloads-popup-item-bar">
                    <div className="downloads-popup-item-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="downloads-popup-item-meta">
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
                  className="downloads-popup-item-cancel"
                  title={t('downloads.cancel')}
                  aria-label={t('downloads.cancel')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
