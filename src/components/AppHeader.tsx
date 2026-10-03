import { useState, useEffect, useRef } from 'react';
import {
  Download,
  Bell,
  User,
  Settings,
  ServerOff,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ArrowUpCircle,
  Loader2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { WindowControls } from './WindowControls';
import { UpdatePopover } from './UpdatePopover';
import { restartToApplyUpdate } from '@/lib/updater-service';
import type { DownloadProgressSnapshot } from '@/lib/download-channel';

interface TitleBarProps {
  catalogUnreachable: boolean;
  catalogSource: 'remote' | 'cache' | 'local' | 'embedded' | null;
  onRetry: () => void;
  onDoubleClick?: () => void;
}

interface MainNavProps {
  activeView: 'games' | 'news' | 'store' | 'downloads';
  onGamesClick: () => void;
  onNewsClick: () => void;
  onStoreClick: () => void;
  onDownloadsNavigate: () => void;
  onNotificationsClick: () => void;
  onSettingsClick: () => void;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  activeDownloads: Map<string, DownloadProgressSnapshot>;
  notificationsBadge?: number;
  avatarUrl?: string;
  /** Launcher self-update: an available version, and whether it is downloaded. */
  launcherUpdate?: {
    version: string | null;
    ready: boolean;
    downloading: boolean;
    errored: boolean;
  } | null;
  onLauncherUpdateClick: () => void;
  /** True while a game is running; a restart would kill its playtime recorder. */
  gameRunning?: boolean;
  /** True when a background catalog poll found new content to load. */
  catalogStale?: boolean;
  onCatalogRefresh: () => void;
}

function TopBarButton({
  icon,
  label,
  badge,
  active,
  trigger,
  wide,
  variant,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number | null;
  active?: boolean;
  trigger?: string;
  wide?: boolean;
  variant?: 'notifications';
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'topbar-btn',
        variant === 'notifications' && 'topbar-btn-notif',
        variant === 'notifications' && active && 'topbar-btn-notif-active',
        active && variant !== 'notifications' && 'topbar-btn-active',
        wide && 'topbar-btn-wide'
      )}
      data-panel-trigger={trigger}
      aria-label={label}
      title={label}
      data-testid={testId}
    >
      <span className="relative">
        {icon}
        {badge != null && badge > 0 && (
          <span className={cn('topbar-badge', variant === 'notifications' && 'topbar-badge-alert')}>
            {badge}
          </span>
        )}
      </span>
    </button>
  );
}

export function TitleBar({
  catalogUnreachable,
  catalogSource,
  onRetry,
  onDoubleClick,
}: TitleBarProps) {
  const { t } = useTranslation();

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, .no-drag')) {
      return;
    }
    onDoubleClick?.();
  };

  const showStatus = catalogUnreachable && catalogSource !== 'remote';

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={handleDoubleClick}
      className={cn(
        'title-bar',
        showStatus ? 'title-bar-status-line status-error' : 'title-bar-status-line status-ok'
      )}
    >
      <div className="title-bar-status">
        {showStatus && (
          <>
            <ServerOff className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ember)' }} />
            <span className="title-bar-status-text">{t('titleBar.serverUnreachable')}</span>
            <button
              type="button"
              onClick={onRetry}
              className="titlebar-refresh-btn no-drag"
              aria-label={t('common.retry')}
              title={t('common.retry')}
            >
              <RefreshCw className="titlebar-refresh-icon w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      <div className="main-nav-right no-drag">
        <WindowControls />
      </div>
    </div>
  );
}

export function MainNav({
  activeView,
  onGamesClick,
  onNewsClick,
  onStoreClick,
  onDownloadsNavigate,
  onNotificationsClick,
  onSettingsClick,
  onNavigatePrev,
  onNavigateNext,
  activeDownloads,
  notificationsBadge,
  avatarUrl,
  launcherUpdate,
  onLauncherUpdateClick,
  catalogStale,
  onCatalogRefresh,
  gameRunning,
}: MainNavProps) {
  const { t } = useTranslation();
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isUpdatePopoverOpen, setIsUpdatePopoverOpen] = useState(false);
  // Covers the gap between "Restart" being chosen and the process actually
  // relaunching, which previously showed nothing at all.
  const [isRestarting, setIsRestarting] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const updateMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isProfileMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsProfileMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isProfileMenuOpen]);

  useEffect(() => {
    if (!isUpdatePopoverOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (updateMenuRef.current && !updateMenuRef.current.contains(event.target as Node)) {
        setIsUpdatePopoverOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsUpdatePopoverOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isUpdatePopoverOpen]);

  const downloadsBadge = activeDownloads.size;

  const handleRestartUpdate = () => {
    // Relaunch replaces the process, so the waiter that records playtime dies
    // with it: the same hazard as quitting mid-game, and the same rule that
    // makes a running game dock instead of quit (should_dock_on_close's
    // game_running term). Declining defers - the staged update still applies the
    // next time the launcher really exits, so waiting loses nothing.
    if (gameRunning && !confirm(t('topBar.restartWhileGameRunning'))) return;
    setIsUpdatePopoverOpen(false);
    setIsRestarting(true);
    void restartToApplyUpdate();
  };

  // The chip is the one place the update state and its action live. Restart is a
  // single click there; downloading opens the detail popover instead, since
  // there is nothing to act on mid-download.
  const handleUpdateChipClick = () => {
    if (isRestarting) return;
    if (launcherUpdate?.ready) {
      handleRestartUpdate();
      return;
    }
    if (launcherUpdate?.downloading) {
      setIsUpdatePopoverOpen((open) => !open);
      return;
    }
    onLauncherUpdateClick();
  };

  const updateChipText = isRestarting
    ? t('topBar.updating')
    : launcherUpdate?.ready
      ? t('topBar.restartToUpdate')
      : launcherUpdate?.downloading
        ? t('topBar.downloading')
        : launcherUpdate?.errored
          ? t('topBar.updateFailed')
          : launcherUpdate?.version
            ? t('topBar.updateTo', { version: launcherUpdate.version })
            : t('topBar.update');

  // The chip stays neutral; only the icon carries the state colour, matching
  // the top progress line. Green while the launcher works (available,
  // downloading), blue once it is the user's turn, the error colour on failure.
  const updateChipIconClass = cn(
    'w-4 h-4 topbar-btn-update-icon',
    launcherUpdate?.ready && 'topbar-btn-update-icon-ready',
    launcherUpdate?.errored && 'topbar-btn-update-icon-error'
  );

  // The version is the tooltip's job in every state where it is known; the label
  // stays short so the chip does not grow. A failure states itself instead, so
  // the tooltip does not promise a version the download never delivered.
  const updateChipTitle = launcherUpdate?.errored
    ? updateChipText
    : launcherUpdate?.version
      ? t('topBar.updateTooltip', { version: launcherUpdate.version })
      : updateChipText;

  return (
    // data-tauri-drag-region makes the empty parts of the nav drag the window.
    // The interactive clusters opt out with .no-drag, so this only widens the
    // grab area between the logo and the right-hand buttons.
    <div className="main-nav" data-tauri-drag-region>
      <div className="cluster cluster-md no-drag">
        {/* Aligned above the "All games" grid button in the bar below, so the two
            read as a single column. See .app-logo for the offset arithmetic. */}
        <div className="app-logo">
          <img src="/logo-circle-p.png" alt="Pandawan Launcher" className="app-logo-image" />
        </div>
        <div className="nav-arrows">
          <button
            type="button"
            className="nav-arrow"
            onClick={onNavigatePrev}
            disabled={activeView !== 'games'}
            aria-label={t('topBar.previous')}
            title={t('topBar.previous')}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="nav-arrow"
            onClick={onNavigateNext}
            disabled={activeView !== 'games'}
            aria-label={t('topBar.next')}
            title={t('topBar.next')}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <nav className="cluster cluster-lg">
          {/* Games is a plain tab now. The hover dropdown only ever offered
              "Library", which is the same destination as clicking the tab, so the
              hover state was pure friction - it delayed the click and hid a
              duplicate entry. */}
          <button
            type="button"
            onClick={onGamesClick}
            className={cn('nav-tab', activeView === 'games' && 'nav-tab-active')}
          >
            {t('topBar.games')}
          </button>
          <button
            type="button"
            onClick={onNewsClick}
            className={cn('nav-tab', activeView === 'news' && 'nav-tab-active')}
          >
            {t('topBar.news')}
          </button>
          <button
            type="button"
            onClick={onStoreClick}
            className={cn('nav-tab', activeView === 'store' && 'nav-tab-active')}
          >
            {t('topBar.store')}
          </button>
        </nav>
      </div>

      <div className="main-nav-right no-drag">
        {/* Blue, and only present when there is something to act on. The banner
            handled this before; a button next to Notifications is reachable from
            every view and does not compete for vertical space. */}
        {(launcherUpdate || isRestarting) && (
          <div className="relative" ref={updateMenuRef}>
            <button
              type="button"
              className={cn(
                'topbar-btn topbar-btn-update',
                launcherUpdate?.ready && !isRestarting ? 'update-restart' : 'update-enter'
              )}
              onClick={handleUpdateChipClick}
              disabled={isRestarting}
              aria-label={updateChipTitle}
              title={updateChipTitle}
              data-testid="launcher-update"
            >
              {isRestarting ? (
                <Loader2 className="w-4 h-4 topbar-btn-update-icon update-spinner" />
              ) : (
                <ArrowUpCircle className={updateChipIconClass} />
              )}
              <span className="topbar-btn-update-label">{updateChipText}</span>
            </button>
            <UpdatePopover
              open={isUpdatePopoverOpen}
              onRestart={handleRestartUpdate}
              gameRunning={gameRunning ?? false}
            />
          </div>
        )}
        {/* Downloads goes to its own page rather than opening the dropdown. The
            dropdown duplicated the page and had no keyboard path; the icon form
            matches Settings and Notifications beside it. */}
        <div className="relative">
          <TopBarButton
            icon={<Download className="w-4 h-4" />}
            label={t('topBar.downloads')}
            badge={downloadsBadge}
            active={activeView === 'downloads'}
            onClick={onDownloadsNavigate}
            testId="nav-downloads"
          />
          {/* A transfer in flight marks the button directly, not only through its
              badge. The count answers "how many"; this answers "is anything
              happening", which is what a player glances up to find out. */}
          {downloadsBadge > 0 && <span className="topbar-btn-active-dot" aria-hidden="true" />}
          {/* A background poll found catalog content this session has not loaded.
              It rides on Downloads because that is where transfers live; the
              blue pill stays reserved for the launcher's own self-update. */}
          {catalogStale && (
            <button
              type="button"
              className="topbar-btn topbar-btn-refresh no-drag"
              onClick={onCatalogRefresh}
              aria-label={t('topBar.catalogStale')}
              title={t('topBar.catalogStale')}
            >
              <RefreshCw className="w-3.5 h-3.5 animate-spin-once" />
            </button>
          )}
        </div>
        <TopBarButton
          icon={<Bell className="w-4 h-4" />}
          label={t('topBar.notifications')}
          badge={notificationsBadge}
          active={(notificationsBadge ?? 0) > 0}
          trigger="notifications"
          variant="notifications"
          wide
          onClick={onNotificationsClick}
        />
        <div className="relative" ref={profileMenuRef}>
          <button
            type="button"
            className="topbar-btn topbar-btn-avatar"
            data-panel-trigger="profile"
            aria-label={t('topBar.playerProfile')}
            title={t('topBar.playerProfile')}
            onClick={() => setIsProfileMenuOpen((open) => !open)}
          >
            <span className="topbar-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="topbar-avatar-image" />
              ) : (
                <User className="w-4 h-4" />
              )}
            </span>
          </button>
          {isProfileMenuOpen && (
            <div className="profile-menu">
              <button
                type="button"
                className="profile-menu-item"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onSettingsClick();
                }}
              >
                <Settings className="w-4 h-4" />
                <span>{t('topBar.profileSettings')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
