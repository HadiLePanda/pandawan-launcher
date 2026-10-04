import { ArrowUpCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUpdaterStore, downloadAndInstall } from '@/lib/updater-service';

/**
 * Informational only: an update exists, or is downloading.
 *
 * The progress bar moved to the full-width line at the top of the app, and the
 * ready-to-install action lives on the top-bar chip, so the banner never
 * duplicates either. It keeps the label and the percentage so the state never
 * rides on colour alone.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const { status, version, downloadedBytes, totalBytes, dismissed, error, dismissBanner } =
    useUpdaterStore();

  if (dismissed) return null;
  if (status !== 'available' && status !== 'downloading' && status !== 'ready') return null;

  const pct =
    status === 'downloading' && totalBytes && totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
      : null;

  return (
    <div className="banner shrink-0">
      <div className="banner-text truncate">
        {status === 'ready' ? (
          // A drawn checkmark marks completion; stroke-dashoffset animates it in.
          <svg
            className="update-check w-4 h-4 shrink-0 text-action"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 12.5l5 5L20 6.5" />
          </svg>
        ) : (
          <ArrowUpCircle className="w-4 h-4 shrink-0 text-action" />
        )}
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

      <div className="flex items-center gap-1 shrink-0">
        {status === 'available' && (
          <button
            onClick={() => void downloadAndInstall()}
            className="btn btn-sm btn-primary update-enter"
          >
            {t('updateBanner.update')}
          </button>
        )}
        <button
          onClick={dismissBanner}
          className="btn btn-sm btn-ghost"
          aria-label={t('updateBanner.dismiss')}
          title={t('updateBanner.dismiss')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
