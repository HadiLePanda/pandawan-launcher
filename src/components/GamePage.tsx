import { Play, Download, RefreshCw, Settings, Trash2, Clock, HardDrive, Check, MoreVertical, Globe, Users, Star } from 'lucide-react';
import { useState } from 'react';
import { cn, formatBytes, getTimeAgo } from '@/lib/utils';
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
  onUninstall,
  onVerify,
}: GamePageProps) {
  const [showMenu, setShowMenu] = useState(false);
  const isDownloading = game.status === 'downloading' || game.status === 'updating';
  const isRunning = game.status === 'running';
  const isInstalled = game.status === 'installed';

  const getPrimaryAction = () => {
    if (isDownloading) {
      return (
        <div className="flex flex-col gap-3 w-full max-w-sm">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink-muted">
              {game.status === 'updating' ? 'Updating' : 'Installing'}
            </span>
            <span className="font-semibold">{Math.round(downloadProgress?.progress || 0)}%</span>
          </div>
          <div className="h-1.5 bg-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${downloadProgress?.progress || 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>{downloadProgress?.speed || '0 MB/s'}</span>
            <span className="truncate max-w-[200px]">{downloadProgress?.currentFile || '...'}</span>
          </div>
        </div>
      );
    }

    if (isInstalled) {
      if (game.hasUpdate) {
        return (
          <button
            onClick={onUpdate}
            className="flex items-center gap-2 px-6 py-3 bg-status-updating hover:bg-amber-500 text-white rounded-lg font-semibold transition-all btn-press btn-glow shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40"
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
            'flex items-center gap-2 px-8 py-3 rounded-lg font-semibold transition-all btn-press btn-glow shadow-glow hover:shadow-glow-lg',
            isRunning
              ? 'bg-status-ready cursor-not-allowed shadow-none'
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
        className="flex items-center gap-2 px-8 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-semibold transition-all btn-press btn-glow shadow-glow hover:shadow-glow-lg"
      >
        <Download className="w-5 h-5" />
        Install
      </button>
    );
  };

  const customStyles = game.info.colorTheme ? {
    '--accent': game.info.colorTheme.accent,
    '--accent-hover': game.info.colorTheme.accentHover,
    '--accent-muted': game.info.colorTheme.accentMuted,
  } as React.CSSProperties : {};

  return (
    <div className="h-full flex flex-col overflow-hidden" style={customStyles}>
      {/* Hero Section */}
      <div className="relative h-[55vh] min-h-[450px]">
        {/* Background */}
        <div className="absolute inset-0">
          {game.info.bannerUrl ? (
            <img
              src={game.info.bannerUrl}
              alt={game.info.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-surface-light to-canvas" />
          )}
          {/* Gradient overlays - enhanced for premium feel */}
          <div className="absolute inset-0 bg-gradient-to-t from-canvas via-canvas/70 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-canvas/90 via-canvas/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent" />
        </div>

        {/* Content */}
        <div className="relative h-full flex flex-col justify-end p-8 pb-12">
          <div className="max-w-2xl">
            {/* Game logo/title */}
            <h1 className="text-6xl font-bold mb-4 tracking-tight drop-shadow-lg">
              {game.info.name}
            </h1>

            {/* Meta info */}
            <div className="flex items-center gap-4 mb-6 text-sm text-ink-muted">
              <span className="flex items-center gap-1.5">
                <Globe className="w-4 h-4" />
                {game.info.developer}
              </span>
              {isInstalled && game.installation && (
                <>
                  <span className="w-1 h-1 rounded-full bg-ink-muted" />
                  <span className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-status-ready" />
                    v{game.installation.installed_version}
                  </span>
                </>
              )}
            </div>

            {/* Genres */}
            <div className="flex items-center gap-2 mb-8">
              {game.info.genre.map((g) => (
                <span
                  key={g}
                  className="px-3 py-1 rounded-full text-xs font-medium bg-surface/80 text-ink-muted backdrop-blur border border-border hover:border-ink-muted/30 transition-colors"
                >
                  {g}
                </span>
              ))}
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-4">
              {getPrimaryAction()}

              {isInstalled && (
                <div className="relative">
                  <button
                    onClick={() => setShowMenu(!showMenu)}
                    className="p-3 rounded-lg bg-surface/80 hover:bg-surface text-ink-muted hover:text-ink transition-all backdrop-blur hover-lift"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </button>

                  {/* Dropdown menu */}
                  {showMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowMenu(false)}
                      />
                      <div className="absolute top-full left-0 mt-2 w-48 bg-surface border border-border rounded-xl shadow-premium-lg z-50 py-1 backdrop-blur-md">
                        <button
                          onClick={() => {
                            onVerify();
                            setShowMenu(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-ink hover:bg-surface-light transition-colors"
                        >
                          <Settings className="w-4 h-4" />
                          Scan and Repair
                        </button>
                        <div className="h-px bg-border my-1" />
                        <button
                          onClick={() => {
                            onUninstall();
                            setShowMenu(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-status-error hover:bg-status-error/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                          Uninstall
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-3 gap-8">
            {/* Main content */}
            <div className="col-span-2 space-y-8">
              {/* Description */}
              <section>
                <h2 className="text-lg font-semibold mb-3">About</h2>
                <p className="text-ink-muted leading-relaxed">
                  {game.info.description || 'No description available.'}
                </p>
              </section>

              {/* Screenshots */}
              {game.info.screenshots.length > 0 && (
                <section>
                  <h2 className="text-lg font-semibold mb-4">Screenshots</h2>
                  <div className="grid grid-cols-3 gap-3">
                    {game.info.screenshots.map((screenshot, index) => (
                      <div
                        key={index}
                        className="aspect-video rounded-xl overflow-hidden bg-surface group cursor-pointer"
                      >
                        <img
                          src={screenshot}
                          alt={`Screenshot ${index + 1}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Sidebar info */}
            <div className="space-y-6">
              {isInstalled && game.installation && (
                <>
                  <InfoCard
                    icon={Clock}
                    label="Time Played"
                    value={`${Math.floor(game.installation.total_playtime_seconds / 3600)}h ${Math.floor((game.installation.total_playtime_seconds % 3600) / 60)}m`}
                  />
                  <InfoCard
                    icon={HardDrive}
                    label="Last Played"
                    value={getTimeAgo(game.installation.last_played)}
                  />
                </>
              )}
              <InfoCard
                icon={Users}
                label="Game Size"
                value={formatBytes(game.info.sizeBytes)}
              />
              <InfoCard
                icon={Star}
                label="Version"
                value={isInstalled && game.installation ? game.installation.installed_version : game.info.version}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-surface/50 border border-border/50 card-premium hover-lift transition-all">
      <div className="w-10 h-10 rounded-lg bg-surface flex items-center justify-center shadow-premium">
        <Icon className="w-5 h-5 text-accent" />
      </div>
      <div>
        <p className="text-xs text-ink-muted uppercase tracking-wider">{label}</p>
        <p className="font-medium">{value}</p>
      </div>
    </div>
  );
}
