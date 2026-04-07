import { WindowControls } from './WindowControls';
import { Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TitleBarProps {
  onSettingsClick: () => void;
  isSettingsOpen: boolean;
}

export function TitleBar({ onSettingsClick, isSettingsOpen }: TitleBarProps) {
  return (
    <header className="h-10 bg-canvas border-b border-border flex items-center justify-between drag-region z-50">
      {/* Left spacer for balance */}
      <div className="w-[200px]" />

      {/* Center - Title */}
      <div className="flex-1 flex items-center justify-center">
        <span className="text-sm font-medium text-ink-muted">Pandawan Launcher</span>
      </div>

      {/* Right - Settings + Window Controls */}
      <div className="flex items-center gap-1 no-drag">
        <button
          onClick={onSettingsClick}
          className={cn(
            'p-2 rounded-md transition-colors',
            isSettingsOpen
              ? 'text-accent bg-accent-muted'
              : 'text-ink-muted hover:text-ink hover:bg-surface-light'
          )}
          aria-label="Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-border mx-1" />
        <WindowControls />
      </div>
    </header>
  );
}
