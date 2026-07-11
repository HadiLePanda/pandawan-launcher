import { useState, useEffect } from 'react';
import { X, Folder, Download, Bell, Globe, HardDrive, Info, SunMoon } from 'lucide-react';
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
  { id: 'about' as SettingsTab, label: 'About', icon: Info },
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
  notifyGameUpdates: true,
  notifyDownloadComplete: true,
  notifyFriendActivity: false,
  notifyNewsEvents: true,
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
    <div className="modal-overlay">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="modal animate-slide-up">
        <div className="modal-sidebar">
          <h2 className="modal-title">Settings</h2>
          <nav className="stack-sm">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'modal-nav-item',
                    activeTab === tab.id && 'modal-nav-item-active'
                  )}
                >
                  <Icon className="modal-nav-icon" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="modal-header">
            <h3 className="title-3">
              {tabs.find((t) => t.id === activeTab)?.label}
            </h3>
            <button onClick={onClose} className="icon-btn">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="modal-body">
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
            {activeTab === 'notifications' && (
              <NotificationSettings settings={editedSettings} onChange={handleUpdate} />
            )}
            {activeTab === 'about' && <AboutSettings />}
          </div>

          <div className="modal-footer">
            <button onClick={onClose} className="btn btn-ghost">
              Cancel
            </button>
            <button onClick={handleSave} className="btn btn-primary">
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
    <div className="setting-group">
      <SettingItem
        icon={Folder}
        title="Game Install Location"
        description="Where your games are installed"
      >
        <div className="cluster cluster-md">
          <div className="install-path-box">
            {settings.gamesInstallPath || 'Default (PandawanGames)'}
          </div>
          <button onClick={handleBrowse} className="btn btn-secondary btn-sm">
            Browse
          </button>
        </div>
      </SettingItem>

      <SettingItem icon={Globe} title="Language" description="Interface language">
        <select
          value={settings.language}
          onChange={(e) => onChange({ language: e.target.value })}
          className="w-full"
        >
          <option value="en">English</option>
          <option value="fr">French</option>
          <option value="de">German</option>
          <option value="es">Spanish</option>
        </select>
      </SettingItem>

      <SettingItem icon={SunMoon} title="Theme" description="Launcher appearance theme">
        <select
          value={settings.theme}
          onChange={(e) => onChange({ theme: e.target.value })}
          className="w-full"
        >
          <option value="adaptive">Adaptive (System)</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </SettingItem>

      <hr className="border-border" />

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
    <div className="setting-group">
      <SettingItem
        icon={Download}
        title="Download Speed Limit"
        description="Maximum download speed limit"
      >
        <select
          value={currentSpeedValue}
          onChange={(e) => handleSpeedChange(e.target.value)}
          className="w-full"
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
        <div className="cluster cluster-md">
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

      <hr className="border-border" />

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

function NotificationSettings({ settings, onChange }: TabProps) {
  return (
    <div className="setting-group">
      <ToggleSetting
        title="Game updates available"
        description="Notify when game updates are available"
        checked={settings.notifyGameUpdates}
        onChange={(checked) => onChange({ notifyGameUpdates: checked })}
      />
      <ToggleSetting
        title="Download complete"
        description="Notify when downloads finish"
        checked={settings.notifyDownloadComplete}
        onChange={(checked) => onChange({ notifyDownloadComplete: checked })}
      />
      <ToggleSetting
        title="Friend activity"
        description="Notify about friends' game activity"
        checked={settings.notifyFriendActivity}
        onChange={(checked) => onChange({ notifyFriendActivity: checked })}
      />
      <ToggleSetting
        title="News and events"
        description="Receive news about games and events"
        checked={settings.notifyNewsEvents}
        onChange={(checked) => onChange({ notifyNewsEvents: checked })}
      />
    </div>
  );
}

function AboutSettings() {
  return (
    <div className="setting-group">
      <div className="cluster cluster-md p-5 rounded-xl">
        <div className="w-16 h-16 rounded-xl bg-action flex items-center justify-center">
          <span className="text-2xl font-bold text-white">P</span>
        </div>
        <div>
          <h4 className="title-3">Pandawan Launcher</h4>
          <p className="caption">Version 0.1.0</p>
        </div>
      </div>

      <div className="stack-md">
        <div className="flex justify-between py-3">
          <span className="body">Developer</span>
          <span>Pandawan Corp</span>
        </div>
        <div className="flex justify-between py-3">
          <span className="body">License</span>
          <span>MIT License</span>
        </div>
        <div className="flex justify-between py-3">
          <span className="body">Tauri Version</span>
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
  controlClassName?: string;
}

function SettingItem({ icon: Icon, title, description, children, controlClassName = 'setting-control' }: SettingItemProps) {
  return (
    <div className="setting-item">
      <div className="setting-header">
        <div className="setting-icon">
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <h4 className="setting-title">{title}</h4>
          <p className="setting-desc">{description}</p>
        </div>
      </div>
      <div className={controlClassName}>{children}</div>
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
    <div className="toggle-row">
      <div>
        <h4 className="setting-title">{title}</h4>
        <p className="setting-desc">{description}</p>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn('toggle', checked && 'toggle-active')}
        aria-pressed={checked}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  );
}
