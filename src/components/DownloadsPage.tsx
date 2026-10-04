import { useTranslation } from 'react-i18next';
import { Download, X, Loader2 } from 'lucide-react';

import type { DownloadProgressSnapshot } from '@/lib/download-channel';
import { formatBytes, useSmoothDownload } from '@/lib/utils';
import type { GameInfo } from '@/types';

interface DownloadsPageProps {
  downloads: Map<string, DownloadProgressSnapshot>;
  games: GameInfo[];
  onCancel: (gameId: string) => void;
  /** A cancel is in flight; the row shows it winding down. */
  cancelling?: boolean;
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

export function DownloadsPage({ downloads, games, onCancel, cancelling }: DownloadsPageProps) {
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
              bannerUrl={game?.bannerUrl}
              onCancel={onCancel}
              cancelling={cancelling}
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
  bannerUrl,
  onCancel,
  cancelling,
}: {
  gameId: string;
  progress: DownloadProgressSnapshot;
  name: string;
  iconUrl?: string;
  bannerUrl?: string;
  onCancel: (gameId: string) => void;
  cancelling?: boolean;
}) {
  const { t } = useTranslation();
  const { percent, etaSeconds } = useSmoothDownload(progress);
  const whole = Math.floor(percent);
  const eta = etaSeconds !== null ? formatEta(etaSeconds) : '';

  return (
    <div className="download-row">
      {/* Banner carries the game's identity, the icon the transfer. Banner-first
          is what makes a list of three downloads scannable at a glance; a row of
          identical 40px icons does not. */}
      <div className="download-row-head">
        {bannerUrl ? (
          <img className="download-row-banner" src={bannerUrl} alt="" />
        ) : (
          <div className="download-row-banner download-row-banner-fallback" />
        )}
        <div className="download-row-banner-scrim" />
        <div className="download-row-banner-content">
          {iconUrl && <img className="download-row-icon" src={iconUrl} alt="" />}
          <span className="download-row-banner-name">{name}</span>
        </div>
        <span className="download-row-percent">{whole}%</span>
      </div>

      <div className="download-row-body">
        <div
          className="download-row-bar"
          role="progressbar"
          aria-valuenow={whole}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={name}
        >
          <div className="download-row-fill" style={{ width: `${percent}%` }} />
        </div>

        {/* Only the numbers that answer "is this working?". The filename and the
            file counter were dropped deliberately: a 267-file Unity build
            scrolled a path past every few frames and turned the row into noise
            nobody read. Speed and ETA are what a player actually acts on. */}
        <div className="download-row-meta">
          {progress.totalBytes > 0 ? (
            <span className="download-row-bytes">
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

          <button
            type="button"
            onClick={() => onCancel(gameId)}
            className="download-row-cancel"
            disabled={cancelling}
            title={cancelling ? t('downloads.cancelling') : t('downloads.cancel')}
            aria-label={`${t('downloads.cancel')}: ${name}`}
          >
            {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
