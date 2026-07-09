import { Play, Download, RefreshCw, HardDrive, X, ChevronRight } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import type { Game, PatchNote } from '@/types';

interface GamePageProps {
  game: Game;
  downloadProgress?: {
    progress: number;
    overallProgress: number;
    speed: string;
    currentFile: string | null;
    completedFiles: number;
    totalFiles: number;
  };
  onPlay: () => void;
  onInstall: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
  onVerify: () => void;
  onCancel?: () => void;
}

export function GamePage({
  game,
  downloadProgress,
  onPlay,
  onInstall,
  onUpdate,
  onUninstall: _onUninstall,
  onVerify: _onVerify,
  onCancel,
}: GamePageProps) {
  const isDownloading = game.status === 'downloading' || game.status === 'updating';
  const isRunning = game.status === 'running';
  const isInstalled = game.status === 'installed';
  const hasUpdate = game.hasUpdate;

  const initials = game.info.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const latestVersion = game.info.version;
  const installedVersion = game.installation?.installed_version;

  const primaryAction = () => {
    if (isDownloading) {
      return (
        <div className="w-full max-w-xs">
          <div className="flex items-center justify-between text-xs mb-3">
            <span className="caption">{game.status === 'updating' ? 'Updating' : 'Installing'}</span>
            <div className="cluster cluster-sm">
              <span className="font-semibold">{Math.round(downloadProgress?.overallProgress || downloadProgress?.progress || 0)}%</span>
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="icon-btn"
                  title="Cancel"
                  aria-label="Cancel"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="progress">
            <div
              className="progress-bar"
              style={{ width: `${downloadProgress?.overallProgress || downloadProgress?.progress || 0}%` }}
            />
          </div>
          <div className="progress-meta">
            <span>{downloadProgress?.completedFiles ?? 0} / {downloadProgress?.totalFiles ?? 0} files</span>
            <span>{downloadProgress?.speed}</span>
          </div>
        </div>
      );
    }

    if (isInstalled) {
      if (hasUpdate) {
        return (
          <button onClick={onUpdate} className="btn btn-primary btn-lg">
            <RefreshCw className="w-5 h-5" />
            Update
          </button>
        );
      }
      return (
        <button
          onClick={onPlay}
          disabled={isRunning}
          className={cn('btn btn-lg text-white', isRunning ? 'btn-secondary cursor-not-allowed opacity-80' : 'btn-primary')}
        >
          <Play className="w-5 h-5 fill-current" />
          {isRunning ? 'Playing' : 'Play'}
        </button>
      );
    }

    return (
      <button onClick={onInstall} className="btn btn-primary btn-lg">
        <Download className="w-5 h-5" />
        Install
      </button>
    );
  };

  return (
    <div className="game-page">
      <div className="game-page-panel surface-glass">
        <div className="game-page-scroll">
          <div className="game-page-content">
            <div className="game-page-header">
              <div className="game-page-logo">
                {game.info.iconUrl ? (
                  <img src={game.info.iconUrl} alt={game.info.name} />
                ) : (
                  initials
                )}
              </div>
              <div className="min-w-0">
                <h1 className="game-page-title truncate">{game.info.name}</h1>
              </div>
            </div>

            {game.info.description && (
              <p className="game-page-desc">{game.info.description}</p>
            )}

            {game.info.genre && game.info.genre.length > 0 && (
              <div className="tags">
                {game.info.genre.map((g) => (
                  <span key={g} className="tag">{g}</span>
                ))}
              </div>
            )}

            <PatchNotesSection patchNotes={game.info.patchNotes} />
          </div>
        </div>

        <div className="game-page-actions">
          {primaryAction()}
          <div className="game-page-meta">
            <span className="game-page-meta-item">
              <HardDrive className="w-4 h-4" />
              {formatBytes(game.info.sizeBytes)}
            </span>
            <VersionLabel installed={installedVersion} latest={latestVersion} hasUpdate={hasUpdate} />
          </div>
        </div>
      </div>

      <div className="game-page-cover surface-glass">
        {game.info.bannerUrl ? (
          <img
            src={game.info.bannerUrl}
            alt={game.info.name}
            className="game-page-cover-img cover-image cover-mask-bottom"
          />
        ) : (
          <div className="game-page-cover-img bg-surface-light" />
        )}
      </div>
    </div>
  );
}

function VersionLabel({
  installed,
  latest,
  hasUpdate,
}: {
  installed?: string;
  latest: string;
  hasUpdate: boolean;
}) {
  if (!installed) {
    return <span className="font-medium tabular-nums">Latest v{latest}</span>;
  }

  if (!hasUpdate) {
    return <span className="font-medium tabular-nums">Installed v{installed}</span>;
  }

  return (
    <span className="font-medium tabular-nums">
      Installed v{installed} <ChevronRight className="inline w-4 h-4 mx-1 text-action" /> Latest v{latest}
    </span>
  );
}

function PatchNotesSection({ patchNotes }: { patchNotes?: PatchNote[] }) {
  if (!patchNotes || patchNotes.length === 0) return null;

  const latest = patchNotes[0];

  return (
    <div className="patch-notes">
      <div className="patch-notes-header">
        <h3 className="patch-notes-title">Patch Notes</h3>
        <span className="patch-notes-version">v{latest.version}</span>
      </div>
      <ul className="patch-notes-list">
        {latest.notes.slice(0, 5).map((note, index) => (
          <li key={index} className="patch-note">{note}</li>
        ))}
      </ul>
    </div>
  );
}
