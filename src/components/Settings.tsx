import { useState, useEffect } from 'react';
import { X, Folder, Download, Bell, Globe, HardDrive, Shield, SunMoon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLauncherStore } from '@/lib/store';
import * as gameService from '@/lib/game-service';
import { logger } from '@/lib/logger';
import type { LauncherSettings } from '@/types';

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

const DEFAULT_SETTINGS: LauncherSettings = {
  gamesInstallPath: null,
  maxDownloadSpeed: null,
  maxConcurrentDownloads: 4,
  autoUpdateGames: true,
  autoUpdateLauncher: true,
  minimizeToTray: true,
  closeToTray: false,
  language: 'en',
  theme: 'adaptive',
};

export function Settings({ isOpen, onClose }: SettingsProps) {
  const { settings, setSettings, error } = useLauncherStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [editedSettings, setEditedSettings] = useState<LauncherSettings>(DEFAULT_SETTINGS);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setEditedSettings(settings || DEFAULT_SETTINGS);
      setSaveError(null);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleUpdate = (updates: Partial<LauncherSettings>) => {
    setEditedSettings((prev) => ({ ...prev, ...updates }));
  };

  const handleSave = async () => {
    setSaveError(null);
    try {
      await setSettings(editedSettings);
      onClose();
    } catch (err) {
      setSaveError(String(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-canvas/70"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-3xl h-[600px] bg-canvas border border-border rounded-2xl shadow-2xl flex overflow-hidden animate-slide-up">
        {/* Sidebar */}
        <div className="w-56 border-r border-border p-4 bg-canvas-light">
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
                      ? 'bg-action text-white'
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
            {(error || saveError) && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error || saveError}
              </div>
            )}
            {activeTab === 'general' && (
              <GeneralSettings settings={editedSettings} onChange={handleUpdate} />
            )}
            {activeTab === 'downloads' && (
              <DownloadSettings settings={editedSettings} onChange={handleUpdate} />
            )}
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
              onClick={handleSave}
              className="px-6 py-2 rounded-lg text-sm font-medium bg-action hover:bg-action-hover text-white transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface TabProps {
  settings: LauncherSettings;
  onChange: (updates: Partial<LauncherSettings>) => void;
}

function GeneralSettings({ settings, onChange }: TabProps) {
  const handleBrowse = async () => {
    try {
      const selected = await gameService.selectInstallFolder();
      if (selected) {
        onChange({ gamesInstallPath: selected });
      }
    } catch (err) {
      logger.error('Failed to pick directory', { error: String(err) });
    }
  };

  return (
    <div className="space-y-6">
      <SettingItem
        icon={Folder}
        title="Game Install Location"
        description="Where your games are installed"
      >
        <div className="flex gap-3">
          <div className="flex-1 px-4 py-2.5 rounded-lg text-sm text-ink border border-border overflow-x-auto whitespace-nowrap bg-transparent">
            {settings.gamesInstallPath || 'Default (PandawanGames)'}
          </div>
          <button
            onClick={handleBrowse}
            className="px-4 py-2.5 bg-surface-light hover:bg-surface-hover rounded-lg text-sm font-medium transition-colors"
          >
            Browse
          </button>
        </div>
      </SettingItem>

      <SettingItem
        icon={Globe}
        title="Language"
        description="Interface language"
      >
        <select
          value={settings.language}
          onChange={(e) => onChange({ language: e.target.value })}
          className="w-full rounded-lg text-sm text-ink"
        >
          <option value="en">English</option>
          <option value="fr">French</option>
          <option value="de">German</option>
          <option value="es">Spanish</option>
        </select>
      </SettingItem>

      <SettingItem
        icon={SunMoon}
        title="Theme"
        description="Launcher appearance theme"
      >
        <select
          value={settings.theme}
          onChange={(e) => onChange({ theme: e.target.value })}
          className="w-full rounded-lg text-sm text-ink"
        >
          <option value="adaptive">Adaptive (System)</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </SettingItem>

      <div className="h-px bg-border" />

      <ToggleSetting
        title="Minimize to tray"
        description="Keep launcher running in system tray when minimized"
        checked={settings.minimizeToTray}
        onChange={(checked) => onChange({ minimizeToTray: checked })}
      />
      <ToggleSetting
        title="Close to tray"
        description="Minimize to tray instead of closing"
        checked={settings.closeToTray}
        onChange={(checked) => onChange({ closeToTray: checked })}
      />
    </div>
  );
}

function DownloadSettings({ settings, onChange }: TabProps) {
  // Map speed options
  const speedOptions = [
    { value: 'unlimited', label: 'Unlimited' },
    { value: '1000000', label: '1 MB/s' },
    { value: '5000000', label: '5 MB/s' },
    { value: '10000000', label: '10 MB/s' },
    { value: '25000000', label: '25 MB/s' },
    { value: '50000000', label: '50 MB/s' },
  ];

  const currentSpeedValue = settings.maxDownloadSpeed ? String(settings.maxDownloadSpeed) : 'unlimited';

  const handleSpeedChange = (val: string) => {
    if (val === 'unlimited') {
      onChange({ maxDownloadSpeed: null });
    } else {
      onChange({ maxDownloadSpeed: Number(val) });
    }
  };

  return (
    <div className="space-y-6">
      <SettingItem
        icon={Download}
        title="Download Speed Limit"
        description="Maximum download speed limit"
      >
        <select
          value={currentSpeedValue}
          onChange={(e) => handleSpeedChange(e.target.value)}
          className="w-full rounded-lg text-sm text-ink"
        >
          {speedOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
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
              onClick={() => onChange({ maxConcurrentDownloads: n })}
              className={cn(
                'w-10 h-10 rounded-lg text-sm font-medium transition-colors',
                settings.maxConcurrentDownloads === n
                  ? 'selectable-chip-active'
                  : 'selectable-chip'
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
        checked={settings.autoUpdateGames}
        onChange={(checked) => onChange({ autoUpdateGames: checked })}
      />
      <ToggleSetting
        title="Auto-update launcher"
        description="Automatically install launcher updates"
        checked={settings.autoUpdateLauncher}
        onChange={(checked) => onChange({ autoUpdateLauncher: checked })}
      />
    </div>
  );
}

function NotificationSettings() {
  // Purely visual notification settings
  const [gamesUpdate, setGamesUpdate] = useState(true);
  const [downloadComplete, setDownloadComplete] = useState(true);
  const [friendActivity, setFriendActivity] = useState(false);
  const [newsEvents, setNewsEvents] = useState(true);

  return (
    <div className="space-y-6">
      <ToggleSetting
        title="Game updates available"
        description="Notify when game updates are available"
        checked={gamesUpdate}
        onChange={setGamesUpdate}
      />
      <ToggleSetting
        title="Download complete"
        description="Notify when downloads finish"
        checked={downloadComplete}
        onChange={setDownloadComplete}
      />
      <ToggleSetting
        title="Friend activity"
        description="Notify about friends' game activity"
        checked={friendActivity}
        onChange={setFriendActivity}
      />
      <ToggleSetting
        title="News and events"
        description="Receive news about games and events"
        checked={newsEvents}
        onChange={setNewsEvents}
      />
    </div>
  );
}

function AboutSettings() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-transparent">
        <div className="w-16 h-16 rounded-xl bg-action flex items-center justify-center">
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
        <div className="w-8 h-8 rounded-lg bg-surface-light flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4 text-ink-muted" />
        </div>
        <div>
          <h4 className="font-medium text-ink">{title}</h4>
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
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleSetting({ title, description, checked, onChange }: ToggleSettingProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <h4 className="font-medium text-ink">{title}</h4>
        <p className="text-sm text-ink-muted">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          'w-11 h-6 rounded-full transition-colors relative',
          checked ? 'toggle-track-active' : 'toggle-track'
        )}
      >
        <div
          className={cn(
            'w-5 h-5 rounded-full toggle-thumb shadow-md transition-transform absolute top-0.5',
            checked ? 'translate-x-5' : 'translate-x-0.5'
          )}
        />
      </button>
    </div>
  );
}
