import { useState, useEffect, useRef } from 'react';
import { SunMoon, Download, Bell, User, Settings, ServerOff, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useLauncherStore } from '@/lib/store';
import { WindowControls } from './WindowControls';

interface AppHeaderProps {
  activeView: 'games' | 'news' | 'store' | 'downloads';
  onGamesClick: () => void;
  onNewsClick: () => void;
  onStoreClick: () => void;
  onDownloadsClick: () => void;
  onNotificationsClick: () => void;
  onSettingsClick: () => void;
  onDoubleClick?: () => void;
  downloadsBadge?: number;
  notificationsBadge?: number;
  catalogUnreachable: boolean;
  catalogSource: 'remote' | 'local' | 'embedded' | null;
  onRetry: () => void;
}

function TopBarButton({
  icon,
  label,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  badge?: number | null;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="topbar-btn"
      aria-label={label}
      title={label}
    >
      <span className="relative">
        {icon}
        {badge != null && badge > 0 && <span className="topbar-badge">{badge}</span>}
      </span>
    </button>
  );
}

function ConnectionBanner({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="banner no-drag">
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
  downloadsBadge,
  notificationsBadge,
  catalogUnreachable,
  catalogSource,
  onRetry,
}: AppHeaderProps) {
  const { t } = useTranslation();
  const { settings, setSettings } = useLauncherStore();
  const currentTheme = settings?.theme || 'adaptive';
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

  const handleThemeToggle = () => {
    if (!settings) return;
    const order = ['adaptive', 'light', 'dark'];
    const next = order[(order.indexOf(currentTheme) + 1) % order.length];
    document.documentElement.classList.toggle('light', next === 'light');
    setSettings({ ...settings, theme: next });
  };

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
    <div
      data-tauri-drag-region
      onDoubleClick={handleDoubleClick}
      className="app-topbar"
    >
      <div className="app-topbar-row">
        <div className="cluster cluster-md no-drag">
          <div className="app-logo">P</div>
          <nav className="cluster cluster-lg app-topbar-tabs">
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

        <div className="cluster cluster-sm no-drag app-header-actions">
          <TopBarButton
            icon={<SunMoon className="w-4 h-4" />}
            label={t('topBar.themeLabel')}
            onClick={handleThemeToggle}
          />
          <TopBarButton
            icon={<Download className="w-4 h-4" />}
            label={t('topBar.downloads')}
            badge={downloadsBadge}
            onClick={onDownloadsClick}
          />
          <TopBarButton
            icon={<Bell className="w-4 h-4" />}
            label={t('topBar.notifications')}
            badge={notificationsBadge}
            onClick={onNotificationsClick}
          />
          <div className="relative" ref={profileMenuRef}>
            <TopBarButton
              icon={<User className="w-4 h-4" />}
              label={t('topBar.playerProfile')}
              onClick={() => setIsProfileMenuOpen((open) => !open)}
            />
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
