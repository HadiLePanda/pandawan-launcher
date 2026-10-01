import { useTranslation } from 'react-i18next';
import { Download, X, Gamepad2, FileDown } from 'lucide-react';

import type { DownloadProgressSnapshot } from '@/lib/download-channel';
import { formatBytes, useSmoothDownload } from '@/lib/utils';
import type { GameInfo } from '@/types';

interface DownloadsPageProps {
  downloads: Map<string, DownloadProgressSnapshot>;
  games: GameInfo[];
  onCancel: (gameId: string) => void;
}

/** "12m 04s" - seconds matter here, they are what the user is watching tick down. */
function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

/** Last path segment, so a full install path does not fill the row. */
function fileNameOf(path: string | null): string | null {
  if (!path) return null;
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
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
          return (
            <DownloadRow
              key={gameId}
              gameId={gameId}
              progress={progress}
              name={game?.name ?? gameId}
              iconUrl={game?.iconUrl}
              onCancel={onCancel}
            />
          );
        })}
      </div>
    </div>
  );
}

function DownloadRow({
  gameId,
  progress,
  name,
  iconUrl,
  onCancel,
}: {
  gameId: string;
  progress: DownloadProgressSnapshot;
  name: string;
  iconUrl?: string;
  onCancel: (gameId: string) => void;
}) {
  const { t } = useTranslation();
  const { percent, etaSeconds } = useSmoothDownload(progress);
  const whole = Math.floor(percent);
  const currentFile = fileNameOf(progress.currentFile);
  const eta = etaSeconds !== null ? formatEta(etaSeconds) : '';

  return (
    <div className="download-row">
      <div className="download-row-icon">
        {iconUrl ? <img src={iconUrl} alt="" /> : <Gamepad2 className="w-5 h-5" />}
      </div>

      <div className="download-row-body">
        <div className="download-row-header">
          <span className="download-row-name">{name}</span>
          <span className="download-row-percent">{whole}%</span>
        </div>

        <div
          className="download-row-bar"
          role="progressbar"
          aria-valuenow={whole}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="download-row-fill" style={{ width: `${percent}%` }} />
        </div>

        {/* The numbers that actually answer "is this working?": how much is
            done, how fast, how long left. A bare percentage answers none of
            those. */}
        <div className="download-row-meta">
          {progress.totalBytes > 0 ? (
            <span>
              {t('downloads.ofSize', {
                done: formatBytes(progress.downloadedBytes),
                total: formatBytes(progress.totalBytes),
              })}
            </span>
          ) : (
            <span>{t('downloads.preparing')}</span>
          )}

          {progress.speed && <span className="download-row-speed">{progress.speed}</span>}

          {eta && <span className="download-row-eta">{t('downloads.eta', { time: eta })}</span>}
        </div>

        {/* The filename is the strongest liveness signal there is: without it a
            slow transfer looks identical to a frozen one. */}
        {currentFile && (
          <div className="download-row-file" title={progress.currentFile ?? undefined}>
            <FileDown className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{currentFile}</span>
          </div>
        )}

        {progress.totalFiles > 0 && (
          <div className="download-row-files">
            {t('downloads.filesProgress', {
              completed: progress.completedFiles,
              total: progress.totalFiles,
            })}
          </div>
        )}
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
}
