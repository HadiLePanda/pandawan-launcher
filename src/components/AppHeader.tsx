import { useState, useEffect, useRef, useMemo } from 'react';
import { Download, Bell, User, Settings, ServerOff, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { WindowControls } from './WindowControls';
import type { DownloadProgressSnapshot } from '@/lib/download-channel';

interface AppHeaderProps {
  activeView: 'games' | 'news' | 'store' | 'downloads';
  onGamesClick: () => void;
  onNewsClick: () => void;
  onStoreClick: () => void;
  onDownloadsClick: () => void;
  onNotificationsClick: () => void;
  onSettingsClick: () => void;
  onDoubleClick?: () => void;
  activeDownloads: Map<string, DownloadProgressSnapshot>;
  notificationsBadge?: number;
  catalogUnreachable: boolean;
  catalogSource: 'remote' | 'local' | 'embedded' | null;
  onRetry: () => void;
}

function TopBarButton({
  icon,
  label,
  badge,
  active,
  trigger,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number | null;
  active?: boolean;
  trigger?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('topbar-btn', active && 'topbar-btn-active')}
      data-panel-trigger={trigger}
      aria-label={label}
      title={label}
    >
      <span className="relative">
        {icon}
        {badge != null && badge > 0 && <span className="topbar-badge">{badge}</span>}
      </span>
      {children}
    </button>
  );
}

function ConnectionBanner({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="banner-inline no-drag">
      <ServerOff className="w-4 h-4 shrink-0" />
      <span className="truncate">{t('app.connectionBanner')}</span>
      <button
        type="button"
        onClick={onRetry}
        className="btn btn-sm btn-ghost banner-retry"
        aria-label={t('common.retry')}
        title={t('common.retry')}
      >
        <RefreshCw className="w-4 h-4" />
        <span className="hidden sm:inline">{t('common.retry')}</span>
      </button>
    </div>
  );
}

export function AppHeader({
  activeView,
  onGamesClick,
  onNewsClick,
  onStoreClick,
  onDownloadsClick,
  onNotificationsClick,
  onSettingsClick,
  onDoubleClick,
  activeDownloads,
  notificationsBadge,
  catalogUnreachable,
  catalogSource,
  onRetry,
}: AppHeaderProps) {
  const { t } = useTranslation();
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

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

  const downloadsBadge = activeDownloads.size;
  const averageProgress = useMemo(() => {
    if (activeDownloads.size === 0) return 0;
    let sum = 0;
    for (const entry of activeDownloads.values()) {
      sum += entry.overallProgress ?? 0;
    }
    return sum / activeDownloads.size;
  }, [activeDownloads]);

  const navItems = [
    { id: 'games' as const, label: t('topBar.games'), onClick: onGamesClick },
    { id: 'news' as const, label: t('topBar.news'), onClick: onNewsClick },
    { id: 'store' as const, label: t('topBar.store'), onClick: onStoreClick },
  ];

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, .no-drag')) {
      return;
    }
    onDoubleClick?.();
  };

  const showConnectionBanner = catalogUnreachable && catalogSource !== 'remote';

  return (
    <div data-tauri-drag-region onDoubleClick={handleDoubleClick} className="app-topbar">
      <div className="app-topbar-row">
        <div className="cluster cluster-md no-drag">
          <div className="app-logo">P</div>
          <nav className="cluster cluster-lg">
            {navItems.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={item.onClick}
                className={cn('nav-tab', activeView === item.id && 'nav-tab-active')}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex-1 flex justify-center min-w-0">
          {showConnectionBanner && <ConnectionBanner onRetry={onRetry} />}
        </div>

        <div className="cluster cluster-sm no-drag">
          {downloadsBadge > 0 && (
            <TopBarButton
              icon={<Download className="w-4 h-4" />}
              label={t('topBar.downloads')}
              badge={downloadsBadge}
              active
              trigger="downloads"
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
              className="topbar-btn"
              data-panel-trigger="profile"
              aria-label={t('topBar.playerProfile')}
              title={t('topBar.playerProfile')}
              onClick={() => setIsProfileMenuOpen((open) => !open)}
            >
              <span className="topbar-avatar">
                <User className="w-3.5 h-3.5" />
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

        <div className="window-controls-row no-drag">
          <WindowControls />
        </div>
      </div>
    </div>
  );
}
