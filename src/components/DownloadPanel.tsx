import { useTranslation } from 'react-i18next';
import { Gamepad2, X, Loader2, List } from 'lucide-react';

import { useModalDialog } from './modalFocus';
import type { DownloadProgressSnapshot } from '@/lib/download-channel';
import { useSmoothDownload } from '@/lib/utils';
import type { GameInfo } from '@/types';

interface DownloadPanelProps {
  open: boolean;
  downloads: Map<string, DownloadProgressSnapshot>;
  games: GameInfo[];
  cancelling: boolean;
  onCancel: (gameId: string) => void;
  onViewAll: () => void;
  onClose: () => void;
}

/**
 * The header's view of running transfers, Steam-style: one compact row per
 * download, dropped under the button.
 *
 * Not trapped. It overlays the page rather than being a dialog over it, so Tab
 * must still reach the content behind - the same reasoning UpdatePopover uses.
 * Escape is owned by MainNav, which holds the open state.
 */
export function DownloadPanel({
  open,
  downloads,
  games,
  cancelling,
  onCancel,
  onViewAll,
  onClose,
}: DownloadPanelProps) {
  const { t } = useTranslation();
  const panelRef = useModalDialog<HTMLDivElement>({ open, trap: false, onClose });

  if (!open) return null;

  return (
    <div ref={panelRef} className="download-panel" role="dialog" aria-label={t('downloads.title')}>
      {downloads.size === 0 ? (
        <p className="download-panel-empty">{t('downloads.empty')}</p>
      ) : (
        <>
          <div className="download-panel-list">
            {Array.from(downloads.entries()).map(([gameId, progress]) => (
              <DownloadPanelRow
                key={gameId}
                gameId={gameId}
                progress={progress}
                name={games.find((g) => g.id === gameId)?.name ?? gameId}
                iconUrl={games.find((g) => g.id === gameId)?.iconUrl}
                onCancel={onCancel}
                cancelling={cancelling}
              />
            ))}
          </div>
          <button type="button" className="download-panel-viewall" onClick={onViewAll}>
            <List className="w-3.5 h-3.5" aria-hidden="true" />
            {t('downloads.viewAll')}
          </button>
        </>
      )}
    </div>
  );
}

function DownloadPanelRow({
  gameId,
  progress,
  name,
  iconUrl,
  onCancel,
  cancelling,
}: {
  gameId: string;
  progress: DownloadProgressSnapshot;
  name: string;
  iconUrl?: string;
  onCancel: (gameId: string) => void;
  cancelling?: boolean;
}) {
  const { t } = useTranslation();
  const { percent } = useSmoothDownload(progress);

  return (
    <div className="download-panel-row">
      <div className="download-panel-icon">
        {iconUrl ? <img src={iconUrl} alt="" /> : <Gamepad2 className="w-4 h-4" />}
      </div>

      {/* The bar is the row's whole state. Speed, ETA, byte counts and the
          filename all moved to the Downloads page and the game page footer:
          four numbers stacked in a 280px panel is a spreadsheet, not a glance. */}
      <div className="download-panel-body">
        <div className="download-panel-head">
          <span className="download-panel-name">{name}</span>
          <span className="download-panel-percent">{Math.floor(percent)}%</span>
          <button
            type="button"
            onClick={() => onCancel(gameId)}
            className="download-panel-cancel"
            disabled={cancelling}
            title={cancelling ? t('downloads.cancelling') : t('downloads.cancel')}
            aria-label={`${t('downloads.cancel')}: ${name}`}
          >
            {cancelling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <X className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
        <div
          className="download-panel-bar"
          role="progressbar"
          aria-valuenow={Math.floor(percent)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={name}
        >
          <div className="download-panel-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
}
