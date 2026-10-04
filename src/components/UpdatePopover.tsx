import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalDialog } from '@components/modalFocus';
import { useUpdaterStore, downloadAndInstall } from '@/lib/updater-service';
import { formatBytes, cn } from '@/lib/utils';
import { formatSpeed } from '@/lib/download-channel';

interface UpdatePopoverProps {
  open: boolean;
  onRestart: () => void;
  /** True while a game runs: a restart would kill its playtime recorder. */
  gameRunning: boolean;
}

/**
 * Compact launcher-update detail, opened from the top-bar chip.
 *
 * Downloading is purely informational - no action buttons. The plugin exposes no
 * abort, so a Cancel would be a lie, and there is no Later either: doing nothing
 * already defers, and a staged update applies on the next real quit. The staged
 * state carries the one real action, Restart.
 */
export function UpdatePopover({ open, onRestart, gameRunning }: UpdatePopoverProps) {
  const { t } = useTranslation();
  const { status, version, downloadedBytes, totalBytes } = useUpdaterStore();
  const [speed, setSpeed] = useState(0);

  // The plugin reports a byte count, not a rate; sample it here. The ref keeps
  // the interval from being rebuilt on every progress tick, and is synced in an
  // effect rather than during render.
  const bytesRef = useRef(downloadedBytes);
  useEffect(() => {
    bytesRef.current = downloadedBytes;
  }, [downloadedBytes]);

  useEffect(() => {
    if (!open) return;
    let lastBytes = bytesRef.current;
    let lastAt = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const elapsed = (now - lastAt) / 1000;
      const delta = bytesRef.current - lastBytes;
      lastAt = now;
      lastBytes = bytesRef.current;
      if (elapsed > 0 && delta > 0) setSpeed(Math.round(delta / elapsed));
    }, 600);
    return () => window.clearInterval(id);
  }, [open]);

  // Focus lands on the action and returns to the chip on close. Escape is left to
  // MainNav's document listener, which owns the popover's open state. Not
  // trapped: it overlays the page, it is not a modal dialog over it.
  const popoverRef = useModalDialog<HTMLDivElement>({ open, trap: false });

  if (!open) return null;

  const pct =
    totalBytes && totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
      : null;
  const staged = status === 'ready';

  return (
    <div
      ref={popoverRef}
      className="update-popover"
      role="dialog"
      aria-label={t('updatePopover.title')}
    >
      <div className="update-popover-title">
        {staged
          ? t('updatePopover.readyTitle', { version: version ?? '' })
          : t('updatePopover.downloadingTitle', { version: version ?? '' })}
      </div>

      {!staged && pct !== null && <div className="update-popover-percent">{pct}%</div>}
      {!staged && (
        <div className="update-popover-detail">
          {totalBytes
            ? t('updatePopover.bytes', {
                done: formatBytes(downloadedBytes, 1),
                total: formatBytes(totalBytes, 1),
              })
            : formatBytes(downloadedBytes, 1)}
        </div>
      )}
      {!staged && speed > 0 && <div className="update-popover-detail">{formatSpeed(speed)}</div>}
      {staged && <div className="update-popover-detail">{t('updatePopover.readyBody')}</div>}

      {staged && gameRunning && (
        <div className="update-popover-detail">{t('updatePopover.gameRunningNote')}</div>
      )}

      {/* Only the staged state has a button. With a game running it is muted:
          waiting is the default, since a restart kills the waiter that records
          this session's playtime and the staged update loses nothing by waiting. */}
      {staged && (
        <div className="update-popover-actions">
          <button
            type="button"
            className={cn('btn btn-sm', gameRunning ? 'btn-ghost' : 'btn-primary')}
            onClick={onRestart}
          >
            {t('updatePopover.restart')}
          </button>
        </div>
      )}
      {!staged && status === 'available' && (
        <div className="update-popover-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void downloadAndInstall()}
          >
            {t('updatePopover.update')}
          </button>
        </div>
      )}
    </div>
  );
}
