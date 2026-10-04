import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Play,
  Download,
  RefreshCw,
  X,
  SlidersHorizontal,
  MoreVertical,
  Clock,
  HardDrive,
  Newspaper,
} from 'lucide-react';
import { cn, formatBytes, formatPlaytimeDecimal, getTimeAgo } from '@/lib/utils';
import { handleImageError, resolveNewsImage } from '@/lib/cdn';
import { KNOWN_CHANNELS, type Channel } from '@/lib/channels';
import { GameContextMenu, type MenuAnchor } from '@components/GameContextMenu';
import { useModalDialog } from '@components/modalFocus';
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
  /** Stop a running game. The primary button becomes this while status is running. */
  onClose?: () => void;
  onInstall: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
  onVerify: () => void;
  /** Channel currently in effect, including any per-game override. */
  channel: string;
  /** Channel the catalog publishes for this game, the picker's default option. */
  catalogChannel: string;
  onChannelChange: (channel: Channel) => void;
  onSelectNewsArticle?: (articleId: string) => void;
  onCancel?: () => void;
}

/**
 * i18next's `t`, narrow enough to pass around as a plain function.
 */
type Translate = (key: string) => string;

/**
 * Display form of a version. Always prefixed with `v`, and named by channel on a
 * prerelease: "ALPHA v0.4.0". On stable the channel is implied by the absence of
 * a suffix, so it says only "v0.4.0" rather than the redundant "RELEASE v0.4.0".
 *
 * The semver prerelease suffix is dropped because the channel name already
 * carries it - "ALPHA v0.4.0-alpha.1" stated the same thing twice.
 */
function versionText(t: Translate, channel: string, version: string): string {
  const v = `v${version.split('-')[0]}`;
  if (channel === 'alpha') return `${t('gamePage.channelMenu.alpha').toUpperCase()} ${v}`;
  if (channel === 'beta') return `${t('gamePage.channelMenu.beta').toUpperCase()} ${v}`;
  return v;
}

/**
 * Channel picker, shown from the game page's banner tools.
 *
 * The channel decides the manifest URL, so this is a real setting rather than a
 * display filter. Choosing the catalog's own channel clears the override, so a
 * later publisher change is picked up without touching this again.
 */
/**
 * Which channels to offer in the picker.
 *
 * Only channels a game was actually published to. Offering "Release" for a game
 * that has only ever shipped an alpha sends the player to a manifest that 404s
 * at install time, which is exactly what the picker exists to prevent.
 *
 * The catalog declares the list. When it does not, the catalog's own channel is
 * the only safe answer: it is known to exist, whereas the other two are guesses.
 */
function availableChannelsFor(catalogChannel: string, declared?: string[]): Channel[] {
  if (declared && declared.length > 0) {
    return KNOWN_CHANNELS.filter((c) => declared.includes(c));
  }
  return KNOWN_CHANNELS.filter((c) => c === catalogChannel);
}

function ChannelPicker({
  gameId,
  currentChannel,
  catalogChannel,
  availableChannels,
  triggerRef,
  onChoose,
  onClose,
}: {
  gameId: string;
  currentChannel: string;
  catalogChannel: string;
  /** Channels the game is published to. Only these are offered. */
  availableChannels: Channel[];
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onChoose: (channel: Channel) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The trigger lives outside this menu, so a plain outside-click test treats
    // pressing it as "click away": mousedown closed the menu and the button's own
    // click then reopened it, making the menu impossible to dismiss with its own
    // trigger. Treat the trigger as inside.
    const isInside = (target: EventTarget | null) =>
      ref.current?.contains(target as Node) || triggerRef.current?.contains(target as Node);

    const onPointerDown = (e: MouseEvent) => {
      if (!isInside(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, triggerRef]);

  return (
    <div
      ref={ref}
      className="game-channel-menu"
      role="menu"
      aria-label={t('gamePage.channelMenu.title')}
      onKeyDown={(e) => {
        // A role=menu owes arrow-key traversal, or it is a list of buttons claiming
        // to be a menu that cannot be walked like one.
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []
        );
        if (items.length === 0) return;
        const at = items.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        // The modulo lands inside the array; the length check above is what makes
        // that true, and hoisting the element keeps the compiler able to see it.
        const target = items[(at + step + items.length) % items.length];
        target?.focus();
      }}
    >
      <p className="game-channel-menu-title">{t('gamePage.channelMenu.title')}</p>
      {availableChannels.map((channel) => {
        const active = currentChannel === channel;
        return (
          <button
            key={`${gameId}-${channel}`}
            type="button"
            role="menuitemradio"
            aria-checked={active}
            className={cn('game-channel-menu-item', active && 'game-channel-menu-item-active')}
            onClick={() => {
              onChoose(channel);
              onClose();
            }}
          >
            {/* The dot is the channel's colour and nothing else, so it is decorative;
                the word beside it names the channel and aria-checked states the choice. */}
            <span
              className={cn('game-channel-dot', `game-channel-dot-${channel}`)}
              aria-hidden="true"
            />
            <span>
              {channel === 'alpha'
                ? t('gamePage.channelMenu.alpha')
                : channel === 'beta'
                  ? t('gamePage.channelMenu.beta')
                  : t('gamePage.channelMenu.stable')}
            </span>
            {channel === catalogChannel && (
              <span className="game-channel-menu-default">{t('gamePage.channelMenu.default')}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function GamePage({
  game,
  news = [],
  downloadProgress,
  onPlay,
  onClose,
  onInstall,
  onUpdate,
  onUninstall,
  onVerify,
  channel,
  catalogChannel,
  onChannelChange,
  onSelectNewsArticle,
  onCancel,
}: GamePageProps) {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [activeModal, setActiveModal] = useState<'patchNotes' | 'news' | 'info' | null>(null);
  const [isChannelOpen, setIsChannelOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const channelTriggerRef = useRef<HTMLButtonElement>(null);

  const isDownloading = game.status === 'downloading' || game.status === 'updating';
  const isRunning = game.status === 'running';
  const isInstalled = game.status === 'installed';
  const hasUpdate = game.hasUpdate;
  const showSize = game.status === 'not_installed';
  // No build for this OS. The primary button becomes an inert explanation rather
  // than an Install that would fail deep in the downloader.
  const unavailable = !game.info.isAvailableOnThisPlatform;

  const gameNews = news.filter((item) => item.gameId === game.info.id);

  /**
   * Why this game cannot be installed, as one sentence naming the platforms that
   * do have a build. Rendered in a title attribute so it explains the greyed card
   * without spending any layout space on it.
   */
  const unavailableTitle = () => {
    if (!unavailable) return undefined;
    const offered = Object.entries(game.info.availableVersions ?? {});
    if (offered.length === 0) return t('gamePage.unavailableOnPlatform');
    const list = offered.map(([platform, entry]) => `${platform} ${entry.version}`).join(', ');
    return t('gamePage.availableElsewhere', { platforms: list });
  };

  const primaryLabel = () => {
    if (unavailable) return t('gamePage.unavailableOnPlatform');
    if (isDownloading) {
      return game.status === 'updating' ? t('gamePage.updating') : t('gamePage.installing');
    }
    // Running is checked before installed on purpose. `isInstalled` is
    // `status === 'installed'`, which is false while a game is running, so
    // testing installed first fell through to "Install" - and the button was
    // disabled because the game was running, producing a greyed-out "Install"
    // for a game that was plainly open.
    if (isRunning) return t('gamePage.close');
    if (isInstalled) {
      if (hasUpdate) return t('gamePage.update');
      return t('gamePage.play');
    }
    return t('gamePage.install');
  };

  const primaryColorClass = () => {
    if (unavailable) return 'action-muted';
    if (isDownloading || (isInstalled && hasUpdate)) return 'action-blue';
    if (isInstalled) return 'action-green';
    return 'action-blue';
  };

  const handlePrimaryClick = () => {
    if (unavailable) return;
    if (isDownloading) return;
    if (isRunning) {
      if (!onClose) return; // No stop handler: do not fall through to play.
      return onClose();
    }
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
          {/* Prerelease channels get a persistent mark in the banner's own
              corner. The version string alone is too quiet to notice, and
              mistaking a playtest for a release is the mistake worth preventing. */}
          {channel !== 'stable' && (
            <span className={cn('game-channel-badge', `game-channel-badge-${channel}`)}>
              {channel === 'alpha'
                ? t('gamePage.channelMenu.alpha')
                : channel === 'beta'
                  ? t('gamePage.channelMenu.beta')
                  : t('gamePage.channelMenu.stable')}
            </span>
          )}
          {/* Anchored to the banner's padding box, not its border box: the scrim
              covers the border box, so a 16px inset from there clipped the
              rightmost button against the edge. */}
          <div className="game-detail-banner-tools">
            {/* The options menu is not a peer of Play/Install: it is a different
                kind of action, and sharing that pill made it read as a second half
                of the primary action. Anchored to the banner's corner it is
                clearly chrome. Channel settings sit beside it because both answer
                "what else can I do with this game". */}
            <button
              type="button"
              ref={channelTriggerRef}
              onClick={() => setIsChannelOpen((open) => !open)}
              className="game-detail-menu-btn"
              title={t('gamePage.channelMenu.title')}
              aria-label={t('gamePage.channelMenu.title')}
              aria-haspopup="menu"
              aria-expanded={isChannelOpen}
            >
              <SlidersHorizontal className="w-5 h-5" />
            </button>
            {isChannelOpen && (
              <ChannelPicker
                gameId={game.info.id}
                currentChannel={channel}
                catalogChannel={catalogChannel}
                availableChannels={availableChannelsFor(
                  catalogChannel,
                  game.info.availableChannels
                )}
                triggerRef={channelTriggerRef}
                onChoose={onChannelChange}
                onClose={() => setIsChannelOpen(false)}
              />
            )}
            <button
              type="button"
              ref={menuTriggerRef}
              onClick={() => {
                const rect = menuTriggerRef.current?.getBoundingClientRect();
                if (rect) {
                  // The menu positions its own left edge, so passing rect.left keeps
                  // it flush beneath the icon instead of drifting toward the
                  // centre of the window.
                  const next = { x: rect.left, y: rect.bottom + 6 };
                  // Toggle: clicking the button that opened the menu closes it
                  // again. Re-measuring first means the same click closes rather
                  // than re-anchoring the menu where it already is.
                  setMenuAnchor((current) => (current ? null : next));
                }
              }}
              className="game-detail-menu-btn"
              title={t('gamePage.moreOptions')}
              aria-label={t('gamePage.moreOptions')}
              aria-haspopup="menu"
              aria-expanded={menuAnchor !== null}
            >
              <MoreVertical className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="game-detail-action-panel">
          <div className="game-detail-actions-left">
            <button
              type="button"
              onClick={handlePrimaryClick}
              disabled={isDownloading || unavailable}
              title={unavailableTitle()}
              className={cn('game-detail-play-btn', primaryColorClass())}
            >
              {isDownloading ? (
                <>
                  <Download className="w-5 h-5" />
                  <span>{downloadPct}%</span>
                </>
              ) : isRunning ? (
                <>
                  <X className="w-5 h-5" />
                  <span>{primaryLabel()}</span>
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

            <GameContextMenu
              game={game}
              anchor={menuAnchor}
              triggerRef={menuTriggerRef}
              onClose={() => setMenuAnchor(null)}
              onAction={handleMenuAction}
            />
          </div>

          {/* Icon-led metadata. "Version" and "Size" above each value told the
              reader what they were already looking at, and the labels broke the
              line into a list. The icon carries the meaning; the value stands
              alone. Full value stays in the tooltip.

              The version is pushed to the far right with margin-left:auto so it
              reads as the build identity at the end of the line rather than
              crowding the size next to it. */}
          <div className="game-detail-meta">
            <div className="game-detail-meta-facts">
              {showSize && (
                <span className="game-detail-chip" title={t('gamePage.size')}>
                  <HardDrive className="w-3.5 h-3.5" aria-hidden="true" />
                  {formatBytes(game.info.sizeBytes)}
                </span>
              )}
              {/* Labels above their values, Steam-style. A run of unlabelled values
                  ("2h · 3 days ago · 421 MB") makes the reader work out which is
                  which; stacked pairs can be taken one at a time. */}
              {game.installation && game.status !== 'not_installed' && (
                <>
                  <div className="game-detail-stat">
                    <span className="game-detail-stat-label">{t('gamePage.playtimeLabel')}</span>
                    <span className="game-detail-stat-value">
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      {formatPlaytimeDecimal(game.installation.total_playtime_seconds)}
                    </span>
                  </div>
                  <div className="game-detail-stat">
                    <span className="game-detail-stat-label">{t('gamePage.lastPlayedLabel')}</span>
                    <span className="game-detail-stat-value">
                      {/* "Never" on its own reads as missing data rather than as a
                          fact; the label above it is what makes it legible. */}
                      {game.installation.last_played
                        ? getTimeAgo(game.installation.last_played)
                        : t('gamePage.neverPlayed')}
                    </span>
                  </div>
                </>
              )}
            </div>
            {/* Pinned to the right by .game-detail-version's margin-left:auto. */}
            <span className="game-detail-chip game-detail-version">
              {versionText(t, channel, game.info.version)}
            </span>
          </div>
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

      {/* No heading and no panel behind the news. The article titles are the
          headings, and a card background in a column of other cards made the
          aside read as a fourth surface competing with the banner. */}
      <aside className="game-detail-news">
        {gameNews.length > 0 ? (
          <div className="game-detail-news-list">
            {gameNews.map((item) => (
              <article
                key={item.id}
                className="game-detail-news-card"
                onClick={() => onSelectNewsArticle?.(item.id)}
                // The card is the only way into the article, so it has to behave as a
                // control: an article with onClick is not focusable and cannot be
                // opened from a keyboard at all.
                role="button"
                tabIndex={0}
                aria-label={item.title}
                title={item.title}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectNewsArticle?.(item.id);
                  }
                }}
              >
                {/* The game's own artwork stands in when an item has no image of its
                    own, so this list never shows ragged thumbnails. */}
                <div className="game-detail-news-thumb">
                  <img src={resolveNewsImage(item, game.info)} alt="" onError={handleImageError} />
                </div>
                <div className="game-detail-news-body">
                  <h4 className="game-detail-news-card-title">{item.title}</h4>
                  <p className="game-detail-news-card-excerpt">{item.excerpt}</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          // An aside that collapses to nothing leaves a bare 420px column beside
          // the game, which reads as a layout bug. A quiet icon and two words
          // keep it contextual without pretending there is something to read.
          <div className="game-detail-news-empty">
            <Newspaper className="w-6 h-6" aria-hidden="true" />
            <span>{t('gamePage.noNewsForGame')}</span>
          </div>
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
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="game-details-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-details-modal-title"
      >
        <div className="modal-header">
          <h3 className="title-3" id="game-details-modal-title">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn"
            aria-label={t('common.close')}
            title={t('common.close')}
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
                    <div className="patch-note-version">{note.version}</div>
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
                    <div className="game-news-thumb">
                      <img
                        src={resolveNewsImage(item, game.info)}
                        alt={item.title}
                        onError={handleImageError}
                      />
                    </div>
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
