import { Play, Download, RefreshCw, HardDrive } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import type { Game } from '@/types';

interface GamePageProps {
  game: Game;
  downloadProgress?: { progress: number; speed: string; currentFile: string | null };
  onPlay: () => void;
  onInstall: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
  onVerify: () => void;
}

export function GamePage({
  game,
  downloadProgress,
  onPlay,
  onInstall,
  onUpdate,
  onUninstall: _onUninstall,
  onVerify: _onVerify,
}: GamePageProps) {
  const isDownloading = game.status === 'downloading' || game.status === 'updating';
  const isRunning = game.status === 'running';
  const isInstalled = game.status === 'installed';

  const initials = game.info.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const primaryAction = () => {
    if (isDownloading) {
      return (
        <div className="w-full max-w-xs">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-ink-muted">{game.status === 'updating' ? 'Updating' : 'Installing'}</span>
            <span className="font-semibold">{Math.round(downloadProgress?.progress || 0)}%</span>
          </div>
          <div className="h-1.5 bg-surface rounded-full overflow-hidden">
            <div className="h-full bg-action" style={{ width: `${downloadProgress?.progress || 0}%` }} />
          </div>
        </div>
      );
    }

    if (isInstalled) {
      if (game.hasUpdate) {
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

  const versionText = isInstalled && game.installation
    ? game.installation.installed_version
    : game.info.version;

  return (
    <div className="h-full overflow-hidden flex flex-col lg:flex-row">
      {/* Left panel: name, logo, description, tags, and bottom-left action/details */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden lg:max-w-[55%] xl:max-w-[58%]">
        {/* Top scrollable content */}
        <div className="flex-1 overflow-auto px-8 py-8">
          <div className="max-w-2xl">
            {/* Logo + Name */}
            <div className="flex items-center gap-4 mb-6">
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
              <p className="text-base leading-relaxed text-ink/90 mb-6">{game.info.description}</p>
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
          </div>
        </div>

        {/* Bottom-left action/details */}
        <div className="px-8 py-5 border-t border-border glass/80 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {primaryAction()}
            <div className="flex items-center gap-4 text-sm text-ink-muted">
              <span className="flex items-center gap-1.5">
                <HardDrive className="w-4 h-4" />
                {formatBytes(game.info.sizeBytes)}
              </span>
              <span className="font-medium tabular-nums">
                v{versionText}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel: cover + news */}
      <div className="w-full lg:flex-1 lg:min-w-0 shrink-0 flex flex-col overflow-hidden border-l border-border">
        {/* Cover image — full height within right panel, fading at bottom */}
        <div className="relative flex-1 min-h-0 overflow-hidden">
          {game.info.bannerUrl ? (
            <img
              src={game.info.bannerUrl}
              alt={game.info.name}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-surface-light" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-canvas/20 via-transparent to-canvas" />
          <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/40 to-transparent" />
        </div>

        {/* News cards below cover */}
        <div className="shrink-0 p-4 space-y-3 border-t border-border max-h-[45%] overflow-auto glass/80">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-muted mb-2">News</h3>
          <NewsCard
            title={`${game.info.name}: Latest Update`}
            excerpt="Patch notes, events, and community highlights — stay in the loop with the latest from the world."
            date="Just now"
          />
          <NewsCard
            title="Community Spotlight"
            excerpt="Join the conversation and share your adventures with players around the world."
            date="2 days ago"
          />
        </div>
      </div>
    </div>
  );
}

function NewsCard({ title, excerpt, date }: { title: string; excerpt: string; date: string }) {
  return (
    <button className="w-full text-left p-3 rounded-xl bg-surface border border-border hover:border-border-strong hover:bg-surface-light transition-colors">
      <div className="min-w-0">
        <h4 className="font-medium text-sm truncate">{title}</h4>
        <p className="text-xs text-ink-muted line-clamp-2 mt-1">{excerpt}</p>
        <span className="text-[10px] text-ink-muted/70 mt-2 inline-block">{date}</span>
      </div>
    </button>
  );
}
