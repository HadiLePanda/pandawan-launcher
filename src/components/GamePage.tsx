import { useState, useRef, useEffect } from 'react';
import { useDropdownPosition } from '@/hooks/useDropdownPosition';
import {
  Play,
  Download,
  RefreshCw,
  HardDrive,
  X,
  MoreVertical,
  Info,
  FileText,
  Newspaper,
  Trash2,
  ShieldCheck,
  Calendar,
} from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { resolveCdnUrl } from '@/lib/cdn';
import type { Game, NewsItem } from '@/types';

interface GamePageProps {
  game: Game;
  news?: NewsItem[];
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

function channelLabel(channel: string): string {
  const normalized = channel.toLowerCase();
  if (normalized === 'stable') return '';
  if (normalized === 'beta') return 'BETA';
  if (normalized === 'alpha') return 'ALPHA';
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function versionText(channel: string, version: string): string {
  const label = channelLabel(channel);
  return label ? `${label} v${version}` : `v${version}`;
}

export function GamePage({
  game,
  news = [],
  downloadProgress,
  onPlay,
  onInstall,
  onUpdate,
  onUninstall,
  onVerify,
  onCancel,
}: GamePageProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<'patchNotes' | 'news' | 'info' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const lastMenuPosition = useRef<{ top: number; left: number } | null>(null);

  const menuPosition = useDropdownPosition(menuTriggerRef, menuRef, menuOpen);
  if (menuPosition) {
    lastMenuPosition.current = menuPosition;
  }
  const menuStylePosition = menuPosition ?? lastMenuPosition.current;

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        menuTriggerRef.current &&
        !menuTriggerRef.current.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const isDownloading = game.status === 'downloading' || game.status === 'updating';
  const isRunning = game.status === 'running';
  const isInstalled = game.status === 'installed';
  const hasUpdate = game.hasUpdate;
  const showSize = game.status === 'not_installed';

  const initials = game.info.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const gameNews = news.filter((item) => item.gameId === game.info.id);

  const primaryAction = () => {
    if (isDownloading) {
      const pct = Math.round(downloadProgress?.overallProgress || downloadProgress?.progress || 0);
      return (
        <div className="download-progress">
          <div className="download-progress-header">
            <span className="download-progress-label">
              {game.status === 'updating' ? 'Updating' : 'Installing'}
            </span>
            <div className="download-progress-stats">
              <span className="download-progress-percent">{pct}%</span>
              {onCancel && (
                <button onClick={onCancel} className="icon-btn" title="Cancel" aria-label="Cancel">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <div className="download-progress-bar">
            <div className="download-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="download-progress-meta">
            <span>
              {downloadProgress?.completedFiles ?? 0} / {downloadProgress?.totalFiles ?? 0} files
            </span>
            <span>{downloadProgress?.speed}</span>
          </div>
        </div>
      );
    }

    if (isInstalled) {
      if (hasUpdate) {
        return (
          <button onClick={onUpdate} className="btn btn-install btn-xl">
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
            'btn btn-xl text-white',
            isRunning ? 'btn-secondary cursor-not-allowed opacity-80' : 'btn-play'
          )}
        >
          <Play className="w-5 h-5 fill-current" />
          {isRunning ? 'Playing' : 'Play'}
        </button>
      );
    }

    return (
      <button onClick={onInstall} className="btn btn-install btn-xl">
        <Download className="w-5 h-5" />
        Install
      </button>
    );
  };

  const menuItems: {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
    danger?: boolean;
  }[] = [
    {
      id: 'patchNotes',
      label: 'Patch Notes',
      icon: FileText,
      onClick: () => setActiveModal('patchNotes'),
    },
    { id: 'news', label: 'News', icon: Newspaper, onClick: () => setActiveModal('news') },
    { id: 'info', label: 'Game Info', icon: Info, onClick: () => setActiveModal('info') },
  ];

  if (isInstalled) {
    menuItems.unshift({
      id: 'verify',
      label: 'Verify Files',
      icon: ShieldCheck,
      onClick: onVerify,
    });
    menuItems.push({
      id: 'uninstall',
      label: 'Uninstall',
      icon: Trash2,
      onClick: onUninstall,
      danger: true,
    });
  }

  return (
    <div className="game-page">
      <section className="game-page-layout">
        <section className="game-page-info">
          <div className="game-page-info-body">
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

            {game.info.genre && game.info.genre.length > 0 && (
              <div className="tags">
                {game.info.genre.map((g) => (
                  <span key={g} className="tag">
                    {g}
                  </span>
                ))}
              </div>
            )}

            {game.info.description && <p className="game-page-desc">{game.info.description}</p>}
          </div>

          <div className="game-page-actions">
            <div className="flex items-center gap-2 w-full">
              {primaryAction()}
              {!isDownloading && (
                <div className="relative">
                  <button
                    ref={menuTriggerRef}
                    onClick={() => setMenuOpen((v) => !v)}
                    className="icon-btn"
                    title="More options"
                    aria-label="More options"
                    aria-expanded={menuOpen}
                    aria-haspopup="menu"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </button>
                  <div
                    ref={menuRef}
                    className="game-options-menu"
                    data-open={menuOpen}
                    data-positioned={Boolean(menuStylePosition)}
                    role="menu"
                    aria-hidden={!menuOpen}
                    style={
                      menuStylePosition
                        ? {
                            position: 'fixed',
                            top: menuStylePosition.top,
                            left: menuStylePosition.left,
                          }
                        : { position: 'fixed' }
                    }
                  >
                    {menuItems.map((item) => (
                      <button
                        key={item.id}
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          item.onClick();
                        }}
                        className={cn(
                          'game-options-item',
                          item.danger && 'game-options-item-danger'
                        )}
                      >
                        <item.icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="game-page-meta">
              {showSize && (
                <span className="game-page-meta-item">
                  <HardDrive className="w-4 h-4" />
                  {formatBytes(game.info.sizeBytes)}
                </span>
              )}
              <span className="font-medium tabular-nums">
                {versionText(game.info.channel, game.info.version)}
              </span>
            </div>
          </div>
        </section>

        <section className="game-page-side">
          <div className="game-page-media">
            {game.info.bannerUrl ? (
              <img src={game.info.bannerUrl} alt={game.info.name} className="game-page-banner" />
            ) : (
              <div className="game-page-banner game-page-banner-placeholder">{initials}</div>
            )}
          </div>

          {gameNews.length > 0 && (
            <div className="game-page-news">
              <GameNewsSection news={gameNews} />
            </div>
          )}
        </section>
      </section>

      {activeModal && (
        <GameDetailsModal
          game={game}
          news={gameNews}
          view={activeModal}
          onClose={() => setActiveModal(null)}
        />
      )}
    </div>
  );
}

function GameNewsSection({ news }: { news: NewsItem[] }) {
  return (
    <div className="game-news">
      <div className="game-news-header">
        <h3 className="game-news-title">News</h3>
      </div>
      <div className="game-news-list">
        {news.map((item) => (
          <article key={item.id} className="game-news-card">
            <div className="game-news-body">
              <div className="game-news-meta">
                {item.category && <span className="badge badge-default">{item.category}</span>}
                <span className="cluster cluster-sm caption">
                  <Calendar className="w-3 h-3" />
                  {new Date(item.date).toLocaleDateString()}
                </span>
              </div>
              <h4 className="game-news-card-title">{item.title}</h4>
              <p className="game-news-card-excerpt">{item.excerpt}</p>
            </div>
            {item.imageUrl && (
              <div className="game-news-thumb">
                <img src={resolveCdnUrl(item.imageUrl)} alt={item.title} />
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function GameDetailsModal({
  game,
  news,
  view,
  onClose,
}: {
  game: Game;
  news: NewsItem[];
  view: 'patchNotes' | 'news' | 'info';
  onClose: () => void;
}) {
  const title = view === 'patchNotes' ? 'Patch Notes' : view === 'news' ? 'News' : 'Game Info';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="game-details-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="title-3">{title}</h3>
          <button onClick={onClose} className="icon-btn" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="modal-body">
          {view === 'info' && (
            <div className="stack-md">
              <div className="game-page-header">
                <div className="game-page-logo">
                  {game.info.iconUrl ? (
                    <img src={game.info.iconUrl} alt={game.info.name} />
                  ) : (
                    game.info.name
                      .split(' ')
                      .map((w) => w[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="game-page-title truncate">{game.info.name}</h2>
                  <p className="game-page-developer">{game.info.developer}</p>
                </div>
              </div>

              {game.info.genre && game.info.genre.length > 0 && (
                <div className="tags">
                  {game.info.genre.map((g) => (
                    <span key={g} className="tag">
                      {g}
                    </span>
                  ))}
                </div>
              )}

              <p className="game-page-desc">{game.info.description}</p>

              <div className="game-info-grid">
                <InfoRow
                  label="Version"
                  value={versionText(game.info.channel, game.info.version)}
                />
                <InfoRow label="Size" value={formatBytes(game.info.sizeBytes)} />
                <InfoRow label="Developer" value={game.info.developer} />
                {game.info.supportedPlatforms && (
                  <InfoRow label="Platforms" value={game.info.supportedPlatforms.join(', ')} />
                )}
              </div>
            </div>
          )}

          {view === 'patchNotes' && (
            <div className="game-news-list">
              {game.info.patchNotes && game.info.patchNotes.length > 0 ? (
                game.info.patchNotes.map((note) => (
                  <article key={note.version} className="patch-note-entry">
                    <div className="patch-note-version">v{note.version}</div>
                    <div className="patch-note-date">
                      {new Date(note.date).toLocaleDateString()}
                    </div>
                    <ul className="patch-note-bullets">
                      {note.notes.map((bullet, index) => (
                        <li key={index} className="patch-note-bullet">
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))
              ) : (
                <p className="caption">No patch notes available.</p>
              )}
            </div>
          )}

          {view === 'news' && (
            <div className="game-news-list">
              {news.length > 0 ? (
                news.map((item) => (
                  <article key={item.id} className="game-news-card">
                    {item.imageUrl && (
                      <div className="game-news-thumb">
                        <img src={resolveCdnUrl(item.imageUrl)} alt={item.title} />
                      </div>
                    )}
                    <div className="game-news-body">
                      <div className="game-news-meta">
                        {item.category && (
                          <span className="badge badge-default">{item.category}</span>
                        )}
                        <span className="cluster cluster-sm caption">
                          <Calendar className="w-3 h-3" />
                          {new Date(item.date).toLocaleDateString()}
                        </span>
                      </div>
                      <h4 className="game-news-card-title">{item.title}</h4>
                      <p className="game-news-card-excerpt">{item.excerpt}</p>
                    </div>
                  </article>
                ))
              ) : (
                <p className="caption">No news available for this game.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="game-info-row">
      <span className="game-info-label">{label}</span>
      <span className="game-info-value">{value}</span>
    </div>
  );
}
