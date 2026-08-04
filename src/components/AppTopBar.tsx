import { Settings, Bell, User, Sun, Moon, SunMoon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useLauncherStore } from '@/lib/store';

interface AppTopBarProps {
  activeView: 'games' | 'news' | 'store';
  onGamesClick: () => void;
  onNewsClick: () => void;
  onStoreClick: () => void;
  onSettingsClick: () => void;
  onPlayerClick: () => void;
  onDoubleClick?: () => void;
}

export function AppTopBar({
  activeView,
  onGamesClick,
  onNewsClick,
  onStoreClick,
  onSettingsClick,
  onPlayerClick,
  onDoubleClick,
}: AppTopBarProps) {
  const { t } = useTranslation();
  const { settings, setSettings } = useLauncherStore();
  const currentTheme = settings?.theme || 'adaptive';

  const handleThemeToggle = () => {
    if (!settings) return;
    const order = ['adaptive', 'light', 'dark'];
    const next = order[(order.indexOf(currentTheme) + 1) % order.length];
    setSettings({ ...settings, theme: next });
  };

  const themeIcon =
    currentTheme === 'light' ? (
      <Sun className="w-5 h-5" />
    ) : currentTheme === 'dark' ? (
      <Moon className="w-5 h-5" />
    ) : (
      <SunMoon className="w-5 h-5" />
    );
  const themeNames: Record<string, string> = {
    adaptive: t('topBar.themeNames.adaptive'),
    light: t('topBar.themeNames.light'),
    dark: t('topBar.themeNames.dark'),
  };
  const themeTitle = t('topBar.themeLabel', {
    theme: themeNames[currentTheme] ?? currentTheme,
  });

  const navItems = [
    { id: 'games' as const, label: t('topBar.games'), onClick: onGamesClick },
    { id: 'news' as const, label: t('topBar.news'), onClick: onNewsClick },
    { id: 'store' as const, label: t('topBar.store'), onClick: onStoreClick },
  ];

  return (
    <div data-tauri-drag-region onDoubleClick={onDoubleClick} className="app-topbar">
      <div className="app-topbar-row">
        <div className="cluster cluster-md">
          <div className="app-logo">P</div>

          <nav className="cluster cluster-xs no-drag">
            {navItems.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={item.onClick}
                  className={cn('nav-link', isActive && 'nav-link-active')}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="cluster cluster-xl no-drag">
          <div className="cluster cluster-sm no-drag">
            <button
              onClick={handleThemeToggle}
              className="icon-btn"
              title={themeTitle}
              aria-label={themeTitle}
            >
              {themeIcon}
            </button>
            <button
              onClick={onSettingsClick}
              className="icon-btn"
              aria-label={t('topBar.settings')}
            >
              <Settings className="w-5 h-5" />
            </button>
            <button className="icon-btn" aria-label={t('topBar.notifications')}>
              <Bell className="w-5 h-5" />
            </button>
          </div>
          <button
            onClick={onPlayerClick}
            className="profile-btn"
            aria-label={t('topBar.playerProfile')}
          >
            <User className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
}
