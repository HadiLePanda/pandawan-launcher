import { Play, Download, RefreshCw, Settings, Trash2, Clock, HardDrive, Check } from 'lucide-react';
import { cn, formatBytes, formatDuration, getTimeAgo } from '@/lib/utils';
import type { Game } from '@/types';

interface GameDetailProps {
  game: Game;
  downloadProgress?: { progress: number; speed: string; currentFile: string | null };
  onBack: () => void;
  onPlay: () => void;
  onInstall: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
  onVerify: () => void;
}

export function GameDetail({
  game,
  downloadProgress,
  onBack,
  onPlay,
  onInstall,
  onUpdate,
  onUninstall,
  onVerify,
}: GameDetailProps) {
  const isDownloading = game.status === 'downloading' || game.status === 'updating';
  const isRunning = game.status === 'running';

  const getActionButton = () => {
    if (isDownloading) {
      return (
        <div className="flex flex-col gap-3 w-full max-w-md">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">
              {game.status === 'updating' ? 'Updating...' : 'Installing...'}
            </span>
            <span className="font-medium">
              {Math.round(downloadProgress?.progress || 0)}%
            </span>
          </div>
          <div className="h-2 bg-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${downloadProgress?.progress || 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>{downloadProgress?.speed || '0 MB/s'}</span>
            <span className="truncate max-w-[300px]">
              {downloadProgress?.currentFile || 'Starting...'}
            </span>
          </div>
        </div>
      );
    }

    if (game.status === 'installed') {
      if (game.hasUpdate) {
        return (
          <button
            onClick={onUpdate}
            className="flex items-center gap-3 px-8 py-4 bg-status-updating hover:bg-amber-600 text-white rounded-xl font-semibold text-lg transition-all btn-press"
          >
            <RefreshCw className="w-5 h-5" />
            Update Now
          </button>
        );
      }

      return (
        <button
          onClick={onPlay}
          disabled={isRunning}
          className={cn(
            'flex items-center gap-3 px-8 py-4 rounded-xl font-semibold text-lg transition-all btn-press',
            isRunning
              ? 'bg-status-ready cursor-not-allowed'
              : 'bg-accent hover:bg-accent-hover'
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
        className="flex items-center gap-3 px-8 py-4 bg-accent hover:bg-accent-hover text-white rounded-xl font-semibold text-lg transition-all btn-press"
      >
        <Download className="w-5 h-5" />
        Install
      </button>
    );
  };

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* Hero Banner */}
      <div className="relative h-[50vh] min-h-[400px]">
        {game.info.bannerUrl ? (
          <img
            src={game.info.bannerUrl}
            alt={game.info.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-surface-light to-canvas" />
        )}
        
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/50 to-transparent" />
        
        {/* Back button */}
        <button
          onClick={onBack}
          className="absolute top-6 left-6 px-4 py-2 glass rounded-lg text-sm font-medium hover:bg-surface transition-colors"
        >
          ← Back to Library
        </button>

        {/* Content */}
        <div className="absolute bottom-0 left-0 right-0 p-8">
          <div className="flex items-end justify-between gap-8">
            <div className="flex-1">
              {/* Genres */}
              <div className="flex items-center gap-2 mb-4">
                {game.info.genre.map((g) => (
                  <span
                    key={g}
                    className="px-3 py-1 rounded-full text-xs font-medium bg-accent-muted text-accent"
                  >
                    {g}
                  </span>
                ))}
              </div>

              {/* Title */}
              <h1 className="text-5xl font-bold text-ink mb-4">
                {game.info.name}
              </h1>

              {/* Developer */}
              <p className="text-lg text-ink-muted mb-6">
                by {game.info.developer}
              </p>

              {/* Stats */}
              {game.status === 'installed' && game.installation && (
                <div className="flex items-center gap-6 text-sm text-ink-muted">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-status-ready" />
                    <span>Version {game.installation.installed_version}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span>
                      Played {formatDuration(game.installation.total_playtime_seconds)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4" />
                    <span>
                      Last played: {getTimeAgo(game.installation.last_played)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Action button */}
            <div className="flex-shrink-0">
              {getActionButton()}
            </div>
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-4xl">
          {/* Description */}
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4">About</h2>
            <p className="text-ink-muted leading-relaxed">
              {game.info.description || 'No description available.'}
            </p>
          </section>

          {/* Screenshots */}
          {game.info.screenshots.length > 0 && (
            <section className="mb-8">
              <h2 className="text-xl font-semibold mb-4">Screenshots</h2>
              <div className="grid grid-cols-3 gap-4">
                {game.info.screenshots.map((screenshot, index) => (
                  <div
                    key={index}
                    className="aspect-video rounded-xl overflow-hidden bg-surface"
                  >
                    <img
                      src={screenshot}
                      alt={`Screenshot ${index + 1}`}
                      className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Management options */}
          {game.status === 'installed' && (
            <section className="pt-8 border-t border-border">
              <h2 className="text-xl font-semibold mb-4">Game Management</h2>
              <div className="flex items-center gap-4">
                <button
                  onClick={onVerify}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface hover:bg-surface-light text-ink-muted hover:text-ink transition-colors text-sm"
                >
                  <Settings className="w-4 h-4" />
                  Verify Files
                </button>
                <button
                  onClick={onUninstall}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface hover:bg-status-error/20 text-ink-muted hover:text-status-error transition-colors text-sm"
                >
                  <Trash2 className="w-4 h-4" />
                  Uninstall
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
