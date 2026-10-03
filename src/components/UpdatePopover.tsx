import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdaterStore, downloadAndInstall } from '@/lib/updater-service';
import { formatBytes } from '@/lib/utils';
import { formatSpeed } from '@/lib/download-channel';

interface UpdatePopoverProps {
  open: boolean;
  onClose: () => void;
  onRestart: () => void;
}

/**
 * Compact launcher-update detail, opened from the top-bar chip.
 *
 * There is deliberately no Cancel: the updater plugin exposes no abort, so a
 * Cancel button would be a lie. "Later" only means "not now" - a staged update
 * still applies the next time the app actually quits.
 */
export function UpdatePopover({ open, onClose, onRestart }: UpdatePopoverProps) {
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

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pct =
    totalBytes && totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
      : null;
  const staged = status === 'ready';

  return (
    <div className="update-popover" role="dialog" aria-label={t('updatePopover.title')}>
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

      <div className="update-popover-actions">
        {staged ? (
          <button type="button" className="btn btn-sm btn-primary" onClick={onRestart}>
            {t('updatePopover.restart')}
          </button>
        ) : status === 'available' ? (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void downloadAndInstall()}
          >
            {t('updatePopover.update')}
          </button>
        ) : null}
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
          {t('updatePopover.later')}
        </button>
      </div>
    </div>
  );
}
