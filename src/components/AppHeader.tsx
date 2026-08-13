import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Download,
  Bell,
  User,
  Settings,
  ServerOff,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { WindowControls } from './WindowControls';
import type { DownloadProgressSnapshot } from '@/lib/download-channel';

interface TitleBarProps {
  catalogUnreachable: boolean;
  catalogSource: 'remote' | 'local' | 'embedded' | null;
  onRetry: () => void;
  onDoubleClick?: () => void;
}

interface MainNavProps {
  activeView: 'games' | 'news' | 'store' | 'downloads';
  onGamesClick: () => void;
  onNewsClick: () => void;
  onStoreClick: () => void;
  onDownloadsClick: () => void;
  onDownloadsNavigate: () => void;
  onNotificationsClick: () => void;
  onSettingsClick: () => void;
  onNavigatePrev: () => void;
  onNavigateNext: () => void;
  activeDownloads: Map<string, DownloadProgressSnapshot>;
  notificationsBadge?: number;
  avatarUrl?: string;
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
  children,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number | null;
  active?: boolean;
  trigger?: string;
  wide?: boolean;
  variant?: 'notifications';
  onClick?: () => void;
  children?: React.ReactNode;
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
    >
      <span className="relative">
        {icon}
        {badge != null && badge > 0 && (
          <span className={cn('topbar-badge', variant === 'notifications' && 'topbar-badge-alert')}>
            {badge}
          </span>
        )}
      </span>
      {children}
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
  onDownloadsClick,
  onDownloadsNavigate,
  onNotificationsClick,
  onSettingsClick,
  onNavigatePrev,
  onNavigateNext,
  activeDownloads,
  notificationsBadge,
  avatarUrl,
}: MainNavProps) {
  const { t } = useTranslation();
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isGamesMenuOpen, setIsGamesMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!isGamesMenuOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsGamesMenuOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isGamesMenuOpen]);

  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const clearGamesMenuTimers = () => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const handleGamesTabEnter = () => {
    clearGamesMenuTimers();
    openTimerRef.current = setTimeout(() => {
      setIsGamesMenuOpen(true);
    }, 120);
  };

  const handleGamesTabLeave = () => {
    clearGamesMenuTimers();
    closeTimerRef.current = setTimeout(() => {
      setIsGamesMenuOpen(false);
    }, 150);
  };

  const handleGamesMenuItem = (action: () => void) => {
    clearGamesMenuTimers();
    setIsGamesMenuOpen(false);
    action();
  };

  const downloadsBadge = activeDownloads.size;
  const averageProgress = useMemo(() => {
    if (activeDownloads.size === 0) return 0;
    let sum = 0;
    for (const entry of activeDownloads.values()) {
      sum += entry.overallProgress ?? 0;
    }
    return sum / activeDownloads.size;
  }, [activeDownloads]);

  return (
    <div className="main-nav">
      <div className="cluster cluster-md no-drag">
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
          <div
            className="games-menu"
            onMouseEnter={clearGamesMenuTimers}
            onMouseLeave={handleGamesTabLeave}
          >
            <button
              type="button"
              onClick={onGamesClick}
              onMouseEnter={handleGamesTabEnter}
              className={cn('nav-tab', activeView === 'games' && 'nav-tab-active')}
              data-panel-trigger="games-menu"
            >
              {t('topBar.games')}
            </button>
            {isGamesMenuOpen && (
              <div className="games-menu-dropdown">
                <button
                  type="button"
                  className="games-menu-item"
                  onClick={() => handleGamesMenuItem(onGamesClick)}
                >
                  {t('gamesMenu.library')}
                </button>
                <button
                  type="button"
                  className="games-menu-item"
                  onClick={() => handleGamesMenuItem(onDownloadsNavigate)}
                >
                  {t('gamesMenu.downloads')}
                </button>
              </div>
            )}
          </div>
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
        {downloadsBadge > 0 && (
          <TopBarButton
            icon={<Download className="w-4 h-4" />}
            label={t('topBar.downloads')}
            badge={downloadsBadge}
            active
            trigger="downloads"
            wide
            onClick={onDownloadsClick}
          >
            <span className="topbar-progress" aria-hidden="true">
              <span className="topbar-progress-fill" style={{ width: `${averageProgress}%` }} />
            </span>
          </TopBarButton>
        )}
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
        <TopBarButton
          icon={<Settings className="w-4 h-4" />}
          label={t('topBar.settings')}
          trigger="settings"
          onClick={onSettingsClick}
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
