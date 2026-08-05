import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play,
  Download,
  RefreshCw,
  HardDrive,
  X,
  MoreVertical,
  Settings,
  Clock,
} from 'lucide-react';
import { cn, formatBytes, formatPlaytimeDecimal, getTimeAgo } from '@/lib/utils';
import { resolveCdnUrl } from '@/lib/cdn';
import { GameContextMenu } from '@components/GameContextMenu';
import type { GameContextAction } from '@/lib/game-context';
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
  onSettings?: () => void;
  onSelectNewsArticle?: (articleId: string) => void;
  onCancel?: () => void;
}

function channelLabel(t: (key: string) => string, channel: string): string {
  const normalized = channel.toLowerCase();
  if (normalized === 'stable') return '';
  if (normalized === 'beta') return t('gamePage.channel.beta');
  if (normalized === 'alpha') return t('gamePage.channel.alpha');
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function versionText(t: (key: string) => string, channel: string, version: string): string {
  const label = channelLabel(t, channel);
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
  onSettings,
  onSelectNewsArticle,
  onCancel,
}: GamePageProps) {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [activeModal, setActiveModal] = useState<'patchNotes' | 'news' | 'info' | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const isDownloading = game.status === 'downloading' || game.status === 'updating';
  const isRunning = game.status === 'running';
  const isInstalled = game.status === 'installed';
  const hasUpdate = game.hasUpdate;
  const showSize = game.status === 'not_installed';

  const gameNews = news.filter((item) => item.gameId === game.info.id);

  const primaryLabel = () => {
    if (isDownloading) {
      return game.status === 'updating' ? t('gamePage.updating') : t('gamePage.installing');
    }
    if (isInstalled) {
      if (hasUpdate) return t('gamePage.update');
      return isRunning ? t('gamePage.playing') : t('gamePage.play');
    }
    return t('gamePage.install');
  };

  const primaryColorClass = () => {
    if (isDownloading || (isInstalled && hasUpdate)) return 'action-blue';
    if (isInstalled) return 'action-green';
    return 'action-blue';
  };

  const handlePrimaryClick = () => {
    if (isDownloading) return;
    if (isInstalled) {
      if (hasUpdate) return onUpdate();
      return onPlay();
    }
    return onInstall();
  };

  const downloadPct = isDownloading
    ? Math.round(downloadProgress?.overallProgress || downloadProgress?.progress || 0)
    : 0;

  const handleMenuAction = (action: GameContextAction) => {
    switch (action) {
      case 'play':
        return onPlay();
      case 'install':
        return onInstall();
      case 'verify':
        return onVerify();
      case 'uninstall':
        return onUninstall();
      case 'patchNotes':
        return setActiveModal('patchNotes');
      case 'gameNews':
        return setActiveModal('news');
      case 'gameInfo':
        return setActiveModal('info');
    }
  };

  return (
    <div className="game-detail">
      <div className="game-detail-main">
        <div className="game-detail-banner">
          {game.info.bannerUrl ? (
            <img src={game.info.bannerUrl} alt="" className="game-detail-banner-image" />
          ) : (
            <div className="game-detail-banner-fallback" />
          )}
          <div className="game-detail-banner-scrim" />
          <div className="game-detail-banner-content">
            <h1 className="game-detail-title">{game.info.name}</h1>
          </div>
        </div>

        <div className="game-detail-action-panel">
          <div className="game-detail-actions-left">
            <button
              type="button"
              onClick={handlePrimaryClick}
              disabled={isRunning || isDownloading}
              className={cn('game-detail-play-btn', primaryColorClass())}
            >
              {isDownloading ? (
                <>
                  <Download className="w-5 h-5" />
                  <span>{downloadPct}%</span>
                </>
              ) : isInstalled && hasUpdate ? (
                <>
                  <RefreshCw className="w-5 h-5" />
                  <span>{primaryLabel()}</span>
                </>
              ) : isInstalled ? (
                <>
                  <Play className="w-5 h-5 fill-current" />
                  <span>{primaryLabel()}</span>
                </>
              ) : (
                <>
                  <Download className="w-5 h-5" />
                  <span>{primaryLabel()}</span>
                </>
              )}
            </button>

            <button
              type="button"
              ref={menuTriggerRef}
              onClick={() => {
                const rect = menuTriggerRef.current?.getBoundingClientRect();
                if (rect) {
                  setMenuAnchor({ x: rect.left, y: rect.bottom + 4 });
                }
              }}
              className={cn('game-detail-menu-btn', primaryColorClass())}
              title={t('gamePage.moreOptions')}
              aria-label={t('gamePage.moreOptions')}
              aria-haspopup="menu"
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            <GameContextMenu
              game={game}
              anchor={menuAnchor}
              onClose={() => setMenuAnchor(null)}
              onAction={handleMenuAction}
            />
          </div>

          <div className="game-detail-meta">
            {showSize && (
              <div className="game-detail-meta-item">
                <span className="game-detail-meta-label">{t('gamePage.size')}</span>
                <span className="game-detail-meta-value">
                  <HardDrive className="w-4 h-4" />
                  {formatBytes(game.info.sizeBytes)}
                </span>
              </div>
            )}
            {game.status !== 'not_installed' && game.installation && (
              <div className="game-detail-meta-item">
                <span className="game-detail-meta-label">{t('gamePage.lastPlayedLabel')}</span>
                <span className="game-detail-meta-value">
                  {getTimeAgo(game.installation.last_played)}
                </span>
              </div>
            )}
            {game.status !== 'not_installed' && game.installation && (
              <div className="game-detail-meta-item">
                <span className="game-detail-meta-label">{t('gamePage.playtimeLabel')}</span>
                <span className="game-detail-meta-value">
                  <Clock className="w-4 h-4" />
                  {formatPlaytimeDecimal(game.installation.total_playtime_seconds)}
                </span>
              </div>
            )}
            <div className="game-detail-meta-item">
              <span className="game-detail-meta-label">{t('gamePage.version')}</span>
              <span className="game-detail-meta-value">
                {versionText(t, game.info.channel, game.info.version)}
              </span>
            </div>
          </div>

          {onSettings && (
            <button
              type="button"
              onClick={onSettings}
              className="game-detail-settings-btn"
              title={t('gamePage.gameSettings')}
              aria-label={t('gamePage.gameSettings')}
            >
              <Settings className="w-5 h-5" />
            </button>
          )}
        </div>

        {isDownloading && (
          <div className="game-detail-download">
            <div className="game-detail-download-bar">
              <div className="game-detail-download-fill" style={{ width: `${downloadPct}%` }} />
            </div>
            <div className="game-detail-download-meta">
              <span>
                {t('gamePage.filesProgress', {
                  completed: downloadProgress?.completedFiles ?? 0,
                  total: downloadProgress?.totalFiles ?? 0,
                })}
              </span>
              <span>{downloadProgress?.speed}</span>
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  className="game-detail-download-cancel"
                  title={t('common.cancel')}
                  aria-label={t('common.cancel')}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <aside className="game-detail-news">
        <h3 className="game-detail-news-title">{t('gamePage.news')}</h3>
        {gameNews.length > 0 ? (
          <div className="game-detail-news-list">
            {gameNews.map((item) => (
              <article
                key={item.id}
                className="game-detail-news-card"
                onClick={() => onSelectNewsArticle?.(item.id)}
              >
                {item.imageUrl && (
                  <div className="game-detail-news-thumb">
                    <img src={resolveCdnUrl(item.imageUrl)} alt="" />
                  </div>
                )}
                <div className="game-detail-news-body">
                  <h4 className="game-detail-news-card-title">{item.title}</h4>
                  <p className="game-detail-news-card-excerpt">{item.excerpt}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="game-detail-news-empty">{t('gamePage.noNewsForGame')}</p>
        )}
      </aside>

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

export function GameDetailsModal({
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
  const { t } = useTranslation();
  const title =
    view === 'patchNotes'
      ? t('gamePage.patchNotes')
      : view === 'news'
        ? t('gamePage.news')
        : t('gamePage.gameInfo');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="game-details-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="title-3">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn"
            aria-label={t('common.close')}
          >
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
                  label={t('gamePage.version')}
                  value={versionText(t, game.info.channel, game.info.version)}
                />
                <InfoRow label={t('gamePage.size')} value={formatBytes(game.info.sizeBytes)} />
                <InfoRow label={t('gamePage.developer')} value={game.info.developer} />
                {game.info.supportedPlatforms && (
                  <InfoRow
                    label={t('gamePage.platforms')}
                    value={game.info.supportedPlatforms.join(', ')}
                  />
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
                <p className="caption">{t('gamePage.noPatchNotes')}</p>
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
                          {new Date(item.date).toLocaleDateString()}
                        </span>
                      </div>
                      <h4 className="game-news-card-title">{item.title}</h4>
                      <p className="game-news-card-excerpt">{item.excerpt}</p>
                    </div>
                  </article>
                ))
              ) : (
                <p className="caption">{t('gamePage.noNewsForGame')}</p>
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
