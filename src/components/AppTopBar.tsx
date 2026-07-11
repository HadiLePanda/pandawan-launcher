import { Settings, Bell, User, Sun, Moon, SunMoon } from 'lucide-react';
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
  const themeTitle =
    currentTheme === 'light' ? 'Light' : currentTheme === 'dark' ? 'Dark' : 'Adaptive';

  const navItems = [
    { id: 'games' as const, label: 'Games', onClick: onGamesClick },
    { id: 'news' as const, label: 'News', onClick: onNewsClick },
    { id: 'store' as const, label: 'Store', onClick: onStoreClick },
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
              title={`Theme: ${themeTitle}`}
              aria-label={`Theme: ${themeTitle}`}
            >
              {themeIcon}
            </button>
            <button onClick={onSettingsClick} className="icon-btn" aria-label="Settings">
              <Settings className="w-5 h-5" />
            </button>
            <button className="icon-btn" aria-label="Notifications">
              <Bell className="w-5 h-5" />
            </button>
          </div>
          <button onClick={onPlayerClick} className="profile-btn" aria-label="Player profile">
            <User className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
}
