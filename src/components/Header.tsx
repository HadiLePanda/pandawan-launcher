import { Gamepad2, Settings, Library, Store, Newspaper } from 'lucide-react';
import { WindowControls } from './WindowControls';
import { cn } from '@/lib/utils';

type Tab = 'library' | 'store' | 'news' | 'settings';

interface HeaderProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const tabs: { id: Tab; label: string; icon: typeof Library }[] = [
  { id: 'library', label: 'Library', icon: Library },
  { id: 'store', label: 'Store', icon: Store },
  { id: 'news', label: 'News', icon: Newspaper },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Header({ activeTab, onTabChange }: HeaderProps) {
  return (
    <header className="h-16 glass-strong border-b border-border flex items-center justify-between px-6 drag-region">
      <div className="flex items-center gap-8">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
            <Gamepad2 className="w-6 h-6 text-white" />
          </div>
          <span className="font-semibold text-lg tracking-tight">
            Pandawan
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex items-center gap-1 no-drag">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'text-ink bg-surface-light'
                    : 'text-ink-muted hover:text-ink hover:bg-surface-light/50'
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Window Controls */}
      <WindowControls />
    </header>
  );
}
