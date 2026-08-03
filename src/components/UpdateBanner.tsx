import { ArrowUpCircle, X } from 'lucide-react';
import { useUpdaterStore, downloadAndInstall, restartToApplyUpdate } from '@/lib/updater-service';

export function UpdateBanner() {
  const { status, version, downloadedBytes, totalBytes, dismissed, dismissBanner } =
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
        <ArrowUpCircle className="w-4 h-4 shrink-0" />
        <span className="truncate">
          {status === 'available' && `Update v${version} available`}
          {status === 'downloading' &&
            `Downloading update v${version}…${pct !== null ? ` ${pct}%` : ''}`}
          {status === 'ready' && `Update v${version} is ready to install`}
        </span>
      </div>

      {status === 'downloading' && pct !== null && (
        <div className="progress flex-1 max-w-xs shrink">
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="flex items-center gap-1 shrink-0">
        {status === 'available' && (
          <button onClick={() => void downloadAndInstall()} className="btn btn-sm btn-ghost">
            Update
          </button>
        )}
        {status === 'ready' && (
          <button onClick={() => void restartToApplyUpdate()} className="btn btn-sm btn-ghost">
            Restart to update
          </button>
        )}
        <button
          onClick={dismissBanner}
          className="btn btn-sm btn-ghost"
          aria-label="Dismiss update banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
