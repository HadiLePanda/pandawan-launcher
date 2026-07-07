import { WindowControls } from './WindowControls';
import { Settings, Sun, Moon, SunMoon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLauncherStore } from '@/lib/store';

interface TitleBarProps {
  onSettingsClick: () => void;
  isSettingsOpen: boolean;
}

export function TitleBar({ onSettingsClick, isSettingsOpen }: TitleBarProps) {
  const { settings, setSettings } = useLauncherStore();

  const currentTheme = settings?.theme || 'adaptive';

  const handleThemeToggle = () => {
    if (!settings) return;
    let nextTheme = 'adaptive';
    if (currentTheme === 'adaptive') {
      nextTheme = 'light';
    } else if (currentTheme === 'light') {
      nextTheme = 'dark';
    } else {
      nextTheme = 'adaptive';
    }
    setSettings({ ...settings, theme: nextTheme });
  };

  const getThemeIcon = () => {
    if (currentTheme === 'light') {
      return <Sun className="w-4 h-4" />;
    }
    if (currentTheme === 'dark') {
      return <Moon className="w-4 h-4" />;
    }
    return <SunMoon className="w-4 h-4" />;
  };

  const getThemeTitle = () => {
    if (currentTheme === 'light') return 'Theme: Light Mode';
    if (currentTheme === 'dark') return 'Theme: Dark Mode';
    return 'Theme: Adaptive (System)';
  };

  return (
    <header className="h-10 bg-canvas/80 backdrop-blur-md border-b border-border flex items-center justify-between drag-region z-50 relative">
      {/* Left spacer for balance */}
      <div className="w-[200px]" />

      {/* Center - Title */}
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm font-medium text-ink-muted">Pandawan Launcher</span>
      </div>

      {/* Right - Theme + Settings + Window Controls */}
      <div className="flex items-center gap-1 no-drag">
        <button
          onClick={handleThemeToggle}
          className="p-2 rounded-md text-ink-muted hover:text-ink hover:bg-surface-light transition-colors"
          title={getThemeTitle()}
          aria-label={getThemeTitle()}
        >
          {getThemeIcon()}
        </button>
        <button
          onClick={onSettingsClick}
          className={cn(
            'p-2 rounded-md transition-colors',
            isSettingsOpen
              ? 'text-accent bg-accent-muted'
              : 'text-ink-muted hover:text-ink hover:bg-surface-light'
          )}
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        <WindowControls />
      </div>
    </header>
  );
}
