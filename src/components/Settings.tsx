import { useState } from 'react';
import { X, Folder, Download, Bell, Globe, HardDrive, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'downloads' | 'notifications' | 'about';

const tabs = [
  { id: 'general' as SettingsTab, label: 'General', icon: HardDrive },
  { id: 'downloads' as SettingsTab, label: 'Downloads', icon: Download },
  { id: 'notifications' as SettingsTab, label: 'Notifications', icon: Bell },
  { id: 'about' as SettingsTab, label: 'About', icon: Shield },
];

export function Settings({ isOpen, onClose }: SettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-canvas/70 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-3xl h-[600px] bg-surface border border-border rounded-2xl shadow-premium-lg flex overflow-hidden animate-slide-up">
        {/* Sidebar */}
        <div className="w-56 bg-canvas border-r border-border p-4 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-canvas-light/20 pointer-events-none" />
          <h2 className="text-lg font-semibold px-3 mb-6">Settings</h2>
          <nav className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                    activeTab === tab.id
                      ? 'bg-accent text-white'
                      : 'text-ink-muted hover:text-ink hover:bg-surface-light'
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-border">
            <h3 className="text-xl font-semibold">
              {tabs.find((t) => t.id === activeTab)?.label}
            </h3>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-light transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-auto p-6">
            {activeTab === 'general' && <GeneralSettings />}
            {activeTab === 'downloads' && <DownloadSettings />}
            {activeTab === 'notifications' && <NotificationSettings />}
            {activeTab === 'about' && <AboutSettings />}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-ink-muted hover:text-ink transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-lg text-sm font-medium bg-accent hover:bg-accent-hover text-white transition-all btn-press btn-glow shadow-glow hover:shadow-glow-lg"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GeneralSettings() {
  return (
    <div className="space-y-6">
      <SettingItem
        icon={Folder}
        title="Game Install Location"
        description="Where your games are installed"
      >
        <div className="flex gap-3">
          <div className="flex-1 px-4 py-2.5 bg-canvas rounded-lg text-sm text-ink-muted border border-border">
            C:\Games\Pandawan
          </div>
          <button className="px-4 py-2.5 bg-surface-light hover:bg-surface-hover rounded-lg text-sm font-medium transition-all btn-press">
            Browse
          </button>
        </div>
      </SettingItem>

      <SettingItem
        icon={Globe}
        title="Language"
        description="Interface language"
      >
        <select className="w-full px-4 py-2.5 bg-canvas rounded-lg text-sm border border-border focus:outline-none focus:border-accent">
          <option>English</option>
          <option>French</option>
          <option>German</option>
          <option>Spanish</option>
        </select>
      </SettingItem>

      <div className="h-px bg-border" />

      <ToggleSetting
        title="Minimize to tray"
        description="Keep launcher running in system tray when minimized"
        defaultChecked
      />
      <ToggleSetting
        title="Close to tray"
        description="Minimize to tray instead of closing"
      />
      <ToggleSetting
        title="Start with Windows"
        description="Launch launcher on system startup"
      />
    </div>
  );
}

function DownloadSettings() {
  return (
    <div className="space-y-6">
      <SettingItem
        icon={Download}
        title="Download Speed Limit"
        description="Maximum download speed"
      >
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="0"
            max="100"
            defaultValue="0"
            className="flex-1 accent-accent"
          />
          <span className="text-sm text-ink-muted w-20 text-right">Unlimited</span>
        </div>
      </SettingItem>

      <SettingItem
        icon={HardDrive}
        title="Concurrent Downloads"
        description="Number of files to download simultaneously"
      >
        <div className="flex items-center gap-3">
          {[1, 2, 4, 6, 8].map((n) => (
            <button
              key={n}
              className={cn(
                'w-10 h-10 rounded-lg text-sm font-medium transition-colors',
                n === 4
                  ? 'bg-accent text-white'
                  : 'bg-canvas hover:bg-surface-light text-ink-muted'
              )}
            >
              {n}
            </button>
          ))}
        </div>
      </SettingItem>

      <div className="h-px bg-border" />

      <ToggleSetting
        title="Auto-update games"
        description="Automatically update games when available"
        defaultChecked
      />
      <ToggleSetting
        title="Auto-update launcher"
        description="Automatically install launcher updates"
        defaultChecked
      />
      <ToggleSetting
        title="Allow background downloads"
        description="Continue downloads when game is running"
      />
    </div>
  );
}

function NotificationSettings() {
  return (
    <div className="space-y-6">
      <ToggleSetting
        title="Game updates available"
        description="Notify when game updates are available"
        defaultChecked
      />
      <ToggleSetting
        title="Download complete"
        description="Notify when downloads finish"
        defaultChecked
      />
      <ToggleSetting
        title="Friend activity"
        description="Notify about friends' game activity"
      />
      <ToggleSetting
        title="News and events"
        description="Receive news about games and events"
        defaultChecked
      />
    </div>
  );
}

function AboutSettings() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 p-4 bg-canvas rounded-xl">
        <div className="w-16 h-16 rounded-xl bg-accent flex items-center justify-center">
          <span className="text-2xl font-bold text-white">P</span>
        </div>
        <div>
          <h4 className="font-semibold text-lg">Pandawan Launcher</h4>
          <p className="text-sm text-ink-muted">Version 0.1.0</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between py-2">
          <span className="text-ink-muted">Developer</span>
          <span>Pandawan Corp</span>
        </div>
        <div className="flex justify-between py-2">
          <span className="text-ink-muted">License</span>
          <span>MIT License</span>
        </div>
        <div className="flex justify-between py-2">
          <span className="text-ink-muted">Tauri Version</span>
          <span>2.0.0</span>
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="flex gap-3">
        <button className="flex-1 py-2.5 rounded-lg bg-surface-light hover:bg-surface-hover text-sm font-medium transition-all btn-press">
          Check for Updates
        </button>
        <button className="flex-1 py-2.5 rounded-lg bg-surface-light hover:bg-surface-hover text-sm font-medium transition-all btn-press">
          View Logs
        </button>
      </div>
    </div>
  );
}

interface SettingItemProps {
  icon: typeof Folder;
  title: string;
  description: string;
  children: React.ReactNode;
}

function SettingItem({ icon: Icon, title, description, children }: SettingItemProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-canvas flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4 text-ink-muted" />
        </div>
        <div>
          <h4 className="font-medium">{title}</h4>
          <p className="text-sm text-ink-muted">{description}</p>
        </div>
      </div>
      <div className="pl-11">{children}</div>
    </div>
  );
}

interface ToggleSettingProps {
  title: string;
  description: string;
  defaultChecked?: boolean;
}

function ToggleSetting({ title, description, defaultChecked }: ToggleSettingProps) {
  const [checked, setChecked] = useState(defaultChecked);

  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <h4 className="font-medium">{title}</h4>
        <p className="text-sm text-ink-muted">{description}</p>
      </div>
      <button
        onClick={() => setChecked(!checked)}
        className={cn(
          'w-11 h-6 rounded-full transition-colors relative',
          checked ? 'bg-accent shadow-glow' : 'bg-surface-light'
        )}
      >
        <div
          className={cn(
            'w-5 h-5 rounded-full bg-white shadow-md transition-transform absolute top-0.5',
            checked ? 'translate-x-5' : 'translate-x-0.5'
          )}
        />
      </button>
    </div>
  );
}
