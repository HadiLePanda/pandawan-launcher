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
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-ink-muted">{game.status === 'updating' ? 'Updating' : 'Installing'}</span>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{Math.round(downloadProgress?.overallProgress || downloadProgress?.progress || 0)}%</span>
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="p-1 rounded hover:bg-red-500/10 text-red-400 transition-colors"
                  title="Cancel"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="h-2 bg-surface rounded-full overflow-hidden">
            <div className="h-full bg-action" style={{ width: `${downloadProgress?.overallProgress || downloadProgress?.progress || 0}%` }} />
          </div>
          <div className="flex justify-between text-[10px] text-ink-muted mt-2">
            <span>{downloadProgress?.completedFiles ?? 0} / {downloadProgress?.totalFiles ?? 0} files</span>
            <span>{downloadProgress?.speed}</span>
          </div>
        </div>
      );
    }

    if (isInstalled) {
      if (hasUpdate) {
        return (
          <button
            onClick={onUpdate}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3 bg-action hover:bg-action-hover text-white rounded-lg font-semibold transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
            Update
          </button>
        );
      }
      return (
        <button
          onClick={onPlay}
          disabled={isRunning}
          className={cn(
            'w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3 rounded-lg font-semibold text-white transition-colors',
            isRunning ? 'bg-surface-light cursor-not-allowed opacity-80' : 'bg-action hover:bg-action-hover'
          )}
        >
          <Play className="w-5 h-5 fill-current" />
          {isRunning ? 'Playing' : 'Play'}
        </button>
      );
    }

    return (
      <button
        onClick={onInstall}
        className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3 bg-action hover:bg-action-hover text-white rounded-lg font-semibold transition-colors"
      >
        <Download className="w-5 h-5" />
        Install
      </button>
    );
  };

  return (
    <div className="h-full overflow-hidden flex flex-col lg:flex-row">
      {/* Left panel: name, logo, description, tags, patch notes, and bottom-left action/details */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden lg:max-w-[55%] xl:max-w-[58%]">
        {/* Top scrollable content */}
        <div className="flex-1 overflow-auto px-8 py-8">
          <div className="max-w-2xl space-y-8">
            {/* Logo + Name */}
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-2xl glass flex items-center justify-center text-3xl font-bold overflow-hidden shrink-0">
                {game.info.iconUrl ? (
                  <img src={game.info.iconUrl} alt={game.info.name} className="w-full h-full object-cover" />
                ) : (
                  initials
                )}
              </div>
              <div className="min-w-0">
                <h1 className="text-3xl font-bold tracking-tight truncate">{game.info.name}</h1>
              </div>
            </div>

            {/* Description */}
            {game.info.description && (
              <p className="text-base leading-relaxed text-ink/90">{game.info.description}</p>
            )}

            {/* Tags */}
            {game.info.genre && game.info.genre.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {game.info.genre.map((g) => (
                  <span key={g} className="px-3 py-1 rounded-full glass text-sm text-ink-muted border border-border">
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Patch Notes */}
            <PatchNotesSection patchNotes={game.info.patchNotes} />
          </div>
        </div>

        {/* Bottom-left action/details */}
        <div className="px-8 py-5 glass/80 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {primaryAction()}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-sm text-ink-muted">
              <span className="flex items-center gap-2">
                <HardDrive className="w-4 h-4" />
                {formatBytes(game.info.sizeBytes)}
              </span>
              <VersionLabel
                installed={installedVersion}
                latest={latestVersion}
                hasUpdate={hasUpdate}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Right panel: cover */}
      <div className="w-full lg:flex-1 lg:min-w-0 shrink-0 overflow-hidden m-4 rounded-2xl">
        {game.info.bannerUrl ? (
          <img
            src={game.info.bannerUrl}
            alt={game.info.name}
            className="w-full h-full object-cover cover-image cover-mask-bottom rounded-2xl"
          />
        ) : (
          <div className="w-full h-full bg-surface-light rounded-2xl" />
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-ink/80">Patch Notes</h3>
        <span className="text-xs text-ink-muted">v{latest.version}</span>
      </div>
      <ul className="space-y-2">
        {latest.notes.slice(0, 5).map((note, index) => (
          <li key={index} className="flex gap-2 text-sm text-ink/80">
            <span className="text-action mt-2">•</span>
            <span>{note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
