import { ArrowUpCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUpdaterStore, downloadAndInstall, restartToApplyUpdate } from '@/lib/updater-service';

interface UpdateBannerProps {
  /**
   * The nav bar now carries the primary update button. The banner is kept for
   * its download progress bar, and shown only when the user dismissed the
   * button's banner-equivalent, so the two never compete for the same message.
   */
  hidden?: boolean;
}

export function UpdateBanner({ hidden = false }: UpdateBannerProps) {
  const { t } = useTranslation();
  const { status, version, downloadedBytes, totalBytes, dismissed, error, dismissBanner } =
    useUpdaterStore();

  if (hidden) return null;
  if (dismissed) return null;
  if (status !== 'available' && status !== 'downloading' && status !== 'ready') return null;

  const pct =
    status === 'downloading' && totalBytes && totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
      : null;

  return (
    <div className="banner shrink-0">
      <div className="banner-text truncate">
        <ArrowUpCircle className="w-4 h-4 shrink-0" />
        <span className="truncate">
          {status === 'available' && t('updateBanner.available', { version })}
          {status === 'downloading' &&
            t('updateBanner.downloading', {
              version,
              progress: pct !== null ? ` ${pct}%` : '',
            })}
          {status === 'ready' && t('updateBanner.ready', { version })}
          {status === 'available' && error && ` — ${t('updateBanner.downloadFailed')}`}
        </span>
      </div>

      {status === 'downloading' && pct !== null && (
        <div
          className="progress flex-1 max-w-xs shrink"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="flex items-center gap-1 shrink-0">
        {status === 'available' && (
          <button onClick={() => void downloadAndInstall()} className="btn btn-sm btn-ghost">
            {t('updateBanner.update')}
          </button>
        )}
        {status === 'ready' && (
          <button onClick={() => void restartToApplyUpdate()} className="btn btn-sm btn-ghost">
            {t('updateBanner.restart')}
          </button>
        )}
        <button
          onClick={dismissBanner}
          className="btn btn-sm btn-ghost"
          aria-label={t('updateBanner.dismiss')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
