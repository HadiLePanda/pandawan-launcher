import { useTranslation } from 'react-i18next';
import { Download, X, Loader2 } from 'lucide-react';

import type { DownloadProgressSnapshot } from '@/lib/download-channel';
import { speedGraphPath, useSpeedHistory } from '@/lib/speed-history';
import { formatBytes, useSmoothDownload } from '@/lib/utils';
import type { FinishedDownload } from '@/lib/store';
import type { GameInfo } from '@/types';

interface DownloadsPageProps {
  downloads: Map<string, DownloadProgressSnapshot>;
  /** Transfers that finished this session, waiting to be dismissed. */
  finished: FinishedDownload[];
  games: GameInfo[];
  onCancel: (gameId: string) => void;
  onDismiss: (gameId: string) => void;
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

export function DownloadsPage({
  downloads,
  finished,
  games,
  onCancel,
  onDismiss,
  cancelling,
}: DownloadsPageProps) {
  const { t } = useTranslation();

  if (downloads.size === 0 && finished.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center downloads-empty">
        <Download className="w-12 h-12 mb-4 opacity-40" />
        <p className="text-ink-muted">{t('downloads.empty')}</p>
      </div>
    );
  }

  const gameOf = (id: string) => games.find((g) => g.id === id);

  return (
    <div className="h-full overflow-auto downloads-page">
      <h2 className="downloads-title">{t('downloads.title')}</h2>

      {/* Two sections, running first. "What is happening now" and "what already
          happened" are different questions, and one undifferentiated list makes
          the reader check every row's state to know which one they are looking
          at. */}
      {downloads.size > 0 && (
        <section className="downloads-section">
          <h3 className="downloads-section-title">{t('downloads.downloading')}</h3>
          <div className="downloads-list">
            {Array.from(downloads.entries()).map(([gameId, progress]) => {
              const game = gameOf(gameId);
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
        </section>
      )}

      {finished.length > 0 && (
        <section className="downloads-section">
          <h3 className="downloads-section-title">{t('downloads.finished')}</h3>
          <div className="downloads-list">
            {finished.map((f) => (
              <FinishedRow
                key={f.gameId}
                finished={f}
                iconUrl={f.iconUrl}
                bannerUrl={f.bannerUrl}
                onDismiss={onDismiss}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * A transfer that completed. Same row shape as an active one so the two sections
 * scan as the same thing in different states, with a full bar and no cancel.
 */
function FinishedRow({
  finished,
  iconUrl,
  bannerUrl,
  onDismiss,
}: {
  finished: FinishedDownload;
  iconUrl?: string;
  bannerUrl?: string;
  onDismiss: (gameId: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="download-row download-row-done">
      <div className="download-row-art">
        {bannerUrl ? (
          <img className="download-row-banner" src={bannerUrl} alt="" />
        ) : (
          <div className="download-row-banner download-row-banner-fallback" />
        )}
        {iconUrl && <img className="download-row-icon" src={iconUrl} alt="" />}
      </div>

      <div className="download-row-body">
        <div className="download-row-title">
          <span className="download-row-name">{finished.name}</span>
          <span className="download-row-status">{t('downloads.complete')}</span>
        </div>

        <div
          className="download-row-bar"
          role="progressbar"
          aria-valuenow={100}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={finished.name}
        >
          <div className="download-row-fill download-row-fill-done" style={{ width: '100%' }} />
        </div>

        <div className="download-row-meta">
          {finished.totalBytes > 0 && (
            <span className="download-row-bytes">{formatBytes(finished.totalBytes)}</span>
          )}
          <button
            type="button"
            onClick={() => onDismiss(finished.gameId)}
            className="download-row-dismiss"
            title={t('downloads.dismiss')}
            aria-label={`${t('downloads.dismiss')}: ${finished.name}`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
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
  const samples = useSpeedHistory(progress);
  const whole = Math.floor(percent);
  const eta = etaSeconds !== null ? formatEta(etaSeconds) : '';
  // Fixed viewBox, no axis labels: the shape of the rate is the information.
  // Numbers on it would be a second thing to read that the bar already states.
  const graph = speedGraphPath(samples, 240, 44);

  return (
    <div className="download-row">
      {/* Banner on the left, not across the top. A full-width banner per row
          made every transfer the same height and pushed the actual progress
          below the fold; the art identifies the row, the numbers are the row. */}
      <div className="download-row-art">
        {bannerUrl ? (
          <img className="download-row-banner" src={bannerUrl} alt="" />
        ) : (
          <div className="download-row-banner download-row-banner-fallback" />
        )}
        {iconUrl && <img className="download-row-icon" src={iconUrl} alt="" />}
      </div>

      <div className="download-row-body">
        <div className="download-row-title">
          <span className="download-row-name">{name}</span>
          <span className="download-row-percent">{whole}%</span>
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

        <div className="download-row-bar">
          <div className="download-row-fill" style={{ width: `${percent}%` }} />
        </div>

        <div className="download-row-meta">
          {eta && <span className="download-row-eta">{t('downloads.eta', { time: eta })}</span>}

          {/* Rate, size and the rate history are one fact read three ways, so they
              sit together against the time left at the other end of the line. */}
          <div className="download-row-stats">
            {progress.speed && <span className="download-row-speed">{progress.speed}</span>}

            <span className="download-row-bytes">
              {progress.totalBytes > 0
                ? t('downloads.ofSize', {
                    done: formatBytes(progress.downloadedBytes),
                    total: formatBytes(progress.totalBytes),
                  })
                : t('downloads.preparing')}
            </span>

            {/* Throughput over time. Hidden until there are two samples, because a
                graph with one point is a dot that reads as a rendering fault. */}
            <svg
              className="download-row-graph"
              viewBox="0 0 240 44"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {graph.line && (
                <>
                  <path d={graph.area} className="download-row-graph-area" />
                  <path d={graph.line} className="download-row-graph-line" />
                </>
              )}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
