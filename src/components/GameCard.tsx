import { Play, Download, RefreshCw, Check, Loader2 } from 'lucide-react';
import { cn, formatBytes, getTimeAgo } from '@/lib/utils';
import type { Game } from '@/types';

interface GameCardProps {
  game: Game;
  isSelected?: boolean;
  downloadProgress?: { progress: number; speed: string; currentFile: string | null };
  onClick?: () => void;
  onPlay?: () => void;
  onInstall?: () => void;
  onUpdate?: () => void;
}

export function GameCard({
  game,
  isSelected = false,
  downloadProgress,
  onClick,
  onPlay,
  onInstall,
  onUpdate,
}: GameCardProps) {
  const isDownloading = game.status === 'downloading' || game.status === 'updating';
  const isRunning = game.status === 'running';
  
  const getStatusIcon = () => {
    switch (game.status) {
      case 'running':
        return <div className="w-2 h-2 rounded-full bg-status-ready status-pulse" />;
      case 'downloading':
      case 'updating':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'installed':
        return game.hasUpdate ? (
          <RefreshCw className="w-4 h-4" />
        ) : (
          <Check className="w-4 h-4 text-status-ready" />
        );
      default:
        return <Download className="w-4 h-4" />;
    }
  };

  const getStatusText = () => {
    switch (game.status) {
      case 'running':
        return 'Playing';
      case 'downloading':
        return downloadProgress ? `${Math.round(downloadProgress.progress)}%` : 'Downloading...';
      case 'updating':
        return downloadProgress ? `Updating ${Math.round(downloadProgress.progress)}%` : 'Updating...';
      case 'installed':
        return game.hasUpdate ? 'Update Available' : 'Ready';
      default:
        return formatBytes(game.info.sizeBytes);
    }
  };

  const getPrimaryAction = () => {
    if (isDownloading) return null;
    
    if (game.status === 'installed') {
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (game.hasUpdate) {
              onUpdate?.();
            } else {
              onPlay?.();
            }
          }}
          className={cn(
            'flex items-center justify-center gap-2 w-full py-3 rounded-lg font-semibold text-sm transition-all btn-press',
            game.hasUpdate
              ? 'bg-status-updating hover:bg-amber-600 text-white'
              : 'bg-accent hover:bg-accent-hover text-white'
          )}
        >
          {game.hasUpdate ? (
            <>
              <RefreshCw className="w-4 h-4" />
              Update
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              Play
            </>
          )}
        </button>
      );
    }

    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onInstall?.();
        }}
        className="flex items-center justify-center gap-2 w-full py-3 rounded-lg font-semibold text-sm bg-surface-light hover:bg-surface-hover text-ink transition-all btn-press"
      >
        <Download className="w-4 h-4" />
        Install
      </button>
    );
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        'game-card group relative rounded-2xl overflow-hidden cursor-pointer',
        'bg-surface border border-border',
        isSelected && 'ring-2 ring-accent ring-offset-2 ring-offset-canvas'
      )}
    >
      {/* Banner */}
      <div className="aspect-[16/9] relative overflow-hidden">
        {game.info.bannerUrl ? (
          <img
            src={game.info.bannerUrl}
            alt={game.info.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-surface-light to-canvas flex items-center justify-center">
            <span className="text-ink-dim font-medium">{game.info.name}</span>
          </div>
        )}
        
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-canvas via-transparent to-transparent" />
        
        {/* Status badge */}
        <div className="absolute top-3 right-3 flex items-center gap-2 px-3 py-1.5 rounded-full glass text-xs font-medium">
          {getStatusIcon()}
          <span>{getStatusText()}</span>
        </div>

        {/* Download progress bar */}
        {isDownloading && downloadProgress && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-surface-light">
            <div
              className="h-full bg-accent progress-bar"
              style={{ width: `${downloadProgress.progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-semibold text-ink truncate mb-1">
          {game.info.name}
        </h3>
        
        <p className="text-xs text-ink-muted mb-4">
          {game.status === 'installed' && game.installation
            ? `Last played: ${getTimeAgo(game.installation.last_played)}`
            : game.info.developer}
        </p>

        {/* Action button */}
        {getPrimaryAction()}
      </div>
    </div>
  );
}
