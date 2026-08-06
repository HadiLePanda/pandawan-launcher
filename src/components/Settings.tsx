import { useState, useEffect } from 'react';
import {
  X,
  Folder,
  Download,
  Bell,
  FileText,
  Globe,
  HardDrive,
  Info,
  SunMoon,
  RefreshCw,
  User,
} from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { appLogDir } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-shell';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useLauncherStore } from '@/lib/store';
import { AVATAR_IDS, avatarUrl } from '@/lib/avatars';
import * as gameService from '@/lib/game-service';
import { logger } from '@/lib/logger';
import { useUpdaterStore, checkForUpdates } from '@/lib/updater-service';
import type { LauncherSettings } from '@/types';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'downloads' | 'notifications' | 'account' | 'about';

const tabs = [
  { id: 'general' as SettingsTab, icon: HardDrive },
  { id: 'downloads' as SettingsTab, icon: Download },
  { id: 'notifications' as SettingsTab, icon: Bell },
  { id: 'account' as SettingsTab, icon: User },
  { id: 'about' as SettingsTab, icon: Info },
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
  const { t } = useTranslation();
  const { settings, setSettings, error } = useLauncherStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [editedSettings, setEditedSettings] = useState<LauncherSettings>(DEFAULT_SETTINGS);
  const [saveError, setSaveError] = useState<string | null>(null);

  const tabLabels: Record<SettingsTab, string> = {
    general: t('settings.tabs.general'),
    downloads: t('settings.tabs.downloads'),
    notifications: t('settings.tabs.notifications'),
    account: t('settings.tabs.account'),
    about: t('settings.tabs.about'),
  };

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

      <div className="modal settings-modal animate-slide-up">
        <div className="modal-sidebar">
          <h2 className="modal-title">{t('settings.title')}</h2>
          <nav className="stack-sm">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn('modal-nav-item', activeTab === tab.id && 'modal-nav-item-active')}
                >
                  <Icon className="modal-nav-icon" />
                  {tabLabels[tab.id]}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="modal-header">
            <h3 className="title-3">{tabLabels[activeTab]}</h3>
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
            {activeTab === 'account' && <AccountSettings />}
            {activeTab === 'about' && <AboutSettings />}
          </div>

          <div className="modal-footer">
            <button onClick={onClose} className="btn btn-ghost">
              {t('common.cancel')}
            </button>
            <button onClick={handleSave} className="btn btn-primary">
              {t('settings.saveChanges')}
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
  const { t } = useTranslation();
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
        title={t('settings.general.installLocation.title')}
        description={t('settings.general.installLocation.description')}
      >
        <div className="cluster cluster-md">
          <div className="install-path-box">
            {settings.gamesInstallPath || t('settings.general.installLocation.defaultPath')}
          </div>
          <button onClick={handleBrowse} className="btn btn-secondary btn-sm">
            {t('settings.general.installLocation.browse')}
          </button>
        </div>
      </SettingItem>

      <SettingItem icon={Globe} title={t('settings.general.language.title')}>
        <select
          value={settings.language}
          onChange={(e) => onChange({ language: e.target.value })}
          className="w-full"
        >
          <option value="en">{t('settings.general.language.en')}</option>
          <option value="fr">{t('settings.general.language.fr')}</option>
        </select>
      </SettingItem>

      <SettingItem icon={SunMoon} title={t('settings.general.theme.title')}>
        <select
          value={settings.theme}
          onChange={(e) => onChange({ theme: e.target.value })}
          className="w-full"
        >
          <option value="adaptive">{t('settings.general.theme.adaptive')}</option>
          <option value="dark">{t('settings.general.theme.dark')}</option>
          <option value="light">{t('settings.general.theme.light')}</option>
        </select>
      </SettingItem>
    </div>
  );
}

function DownloadSettings({ settings, onChange }: TabProps) {
  const { t } = useTranslation();
  const speedOptions = [
    { value: 'unlimited', label: t('settings.downloads.speedLimit.unlimited') },
    { value: '1000000', label: '1 MB/s' },
    { value: '5000000', label: '5 MB/s' },
    { value: '10000000', label: '10 MB/s' },
    { value: '25000000', label: '25 MB/s' },
    { value: '50000000', label: '50 MB/s' },
  ];

  const currentSpeedValue = settings.maxDownloadSpeed
    ? String(settings.maxDownloadSpeed)
    : 'unlimited';

  const handleSpeedChange = (val: string) => {
    if (val === 'unlimited') {
      onChange({ maxDownloadSpeed: null });
    } else {
      onChange({ maxDownloadSpeed: Number(val) });
    }
  };

  return (
    <div className="setting-group">
      <SettingItem icon={Download} title={t('settings.downloads.speedLimit.title')}>
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

      <SettingItem icon={HardDrive} title={t('settings.downloads.concurrent.title')}>
        <select
          value={String(settings.maxConcurrentDownloads)}
          onChange={(e) => onChange({ maxConcurrentDownloads: Number(e.target.value) })}
          className="w-full"
        >
          {[1, 2, 4, 6, 8].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </SettingItem>

      <ToggleSetting
        title={t('settings.downloads.autoUpdateGames.title')}
        description={t('settings.downloads.autoUpdateGames.description')}
        checked={settings.autoUpdateGames}
        onChange={(checked) => onChange({ autoUpdateGames: checked })}
      />
      <ToggleSetting
        title={t('settings.downloads.autoUpdateLauncher.title')}
        description={t('settings.downloads.autoUpdateLauncher.description')}
        checked={settings.autoUpdateLauncher}
        onChange={(checked) => onChange({ autoUpdateLauncher: checked })}
      />
    </div>
  );
}

function NotificationSettings({ settings, onChange }: TabProps) {
  const { t } = useTranslation();
  // notifyFriendActivity and notifyNewsEvents have no behavior behind them
  // yet; the LauncherSettings fields are kept for a future implementation.
  return (
    <div className="setting-group">
      <ToggleSetting
        title={t('settings.notifications.gameUpdates.title')}
        description={t('settings.notifications.gameUpdates.description')}
        checked={settings.notifyGameUpdates}
        onChange={(checked) => onChange({ notifyGameUpdates: checked })}
      />
      <ToggleSetting
        title={t('settings.notifications.downloadComplete.title')}
        description={t('settings.notifications.downloadComplete.description')}
        checked={settings.notifyDownloadComplete}
        onChange={(checked) => onChange({ notifyDownloadComplete: checked })}
      />
    </div>
  );
}

function AccountSettings() {
  const { t } = useTranslation();
  const avatarId = useLauncherStore((s) => s.avatarId);
  const setAvatarId = useLauncherStore((s) => s.setAvatarId);
  return (
    <div className="setting-group">
      <SettingItem
        icon={User}
        title={t('settings.account.avatar.title')}
        description={t('settings.account.avatar.description')}
      >
        <div className="avatar-picker">
          {AVATAR_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setAvatarId(id)}
              className={cn('avatar-option', avatarId === id && 'avatar-option-selected')}
              aria-label={id}
              title={id}
            >
              <img src={avatarUrl(id)} alt={id} className="avatar-image" />
            </button>
          ))}
        </div>
      </SettingItem>
      <p className="caption">{t('settings.account.comingSoon')}</p>
    </div>
  );
}

function AboutSettings() {
  const { t } = useTranslation();
  const [currentVersion, setCurrentVersion] = useState<string>('');
  const [logsError, setLogsError] = useState<string | null>(null);
  const [openingLogs, setOpeningLogs] = useState(false);
  const updaterStatus = useUpdaterStore((s) => s.status);
  const updateVersion = useUpdaterStore((s) => s.version);
  const updaterError = useUpdaterStore((s) => s.error);

  useEffect(() => {
    getVersion()
      .then(setCurrentVersion)
      .catch((err) => {
        logger.warn('Failed to read app version', { error: String(err) });
      });
  }, []);

  const handleOpenLogs = async () => {
    setLogsError(null);
    setOpeningLogs(true);
    try {
      const dir = await appLogDir();
      await open(dir);
    } catch (err) {
      setLogsError(t('settings.about.logs.openError', { error: String(err) }));
    } finally {
      setOpeningLogs(false);
    }
  };

  const busy = updaterStatus === 'checking' || updaterStatus === 'downloading';
  const statusText =
    updaterStatus === 'checking'
      ? t('settings.about.updates.checking')
      : updaterStatus === 'up-to-date'
        ? t('settings.about.updates.upToDate', {
            suffix: currentVersion ? ` (${currentVersion})` : '',
          })
        : updaterStatus === 'available'
          ? t('settings.about.updates.available', { version: updateVersion })
          : updaterStatus === 'downloading'
            ? t('settings.about.updates.downloading')
            : updaterStatus === 'ready'
              ? t('settings.about.updates.ready')
              : updaterStatus === 'error'
                ? t('settings.about.updates.error', { error: updaterError })
                : null;

  return (
    <div className="setting-group">
      <div className="cluster cluster-md p-4 rounded-xl">
        <div className="w-14 h-14 rounded-xl bg-action flex items-center justify-center">
          <span className="text-xl font-bold text-white">P</span>
        </div>
        <div className="min-w-0">
          <h4 className="title-3">Pandawan Launcher</h4>
          <p className="caption">
            {t('settings.about.version', { version: currentVersion || '—' })}
          </p>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-header">
          <div className="setting-icon">
            <RefreshCw className="w-4 h-4" />
          </div>
          {statusText && <span className="caption">{statusText}</span>}
        </div>
        <div className="setting-control">
          <button
            onClick={() => void checkForUpdates({ manual: true })}
            disabled={busy}
            className="btn btn-secondary btn-sm"
          >
            {t('settings.about.updates.checkButton')}
          </button>
        </div>
      </div>

      <div className="setting-item">
        <div className="setting-header">
          <div className="setting-icon">
            <FileText className="w-4 h-4" />
          </div>
          {logsError && <span className="caption">{logsError}</span>}
        </div>
        <div className="setting-control">
          <button
            onClick={() => void handleOpenLogs()}
            disabled={openingLogs}
            className="btn btn-secondary btn-sm"
          >
            {t('settings.about.logs.openButton')}
          </button>
        </div>
      </div>

      <div className="stack-md">
        <div className="flex justify-between py-3">
          <span className="body">{t('settings.about.developer')}</span>
          <span>Pandawan Corp</span>
        </div>
        <div className="flex justify-between py-3">
          <span className="body">{t('settings.about.license')}</span>
          <span>MIT License</span>
        </div>
        <div className="flex justify-between py-3">
          <span className="body">{t('settings.about.tauriVersion')}</span>
          <span>2.0.0</span>
        </div>
      </div>
    </div>
  );
}

interface SettingItemProps {
  icon: typeof Folder;
  title: string;
  description?: string;
  children: React.ReactNode;
  controlClassName?: string;
}

function SettingItem({
  icon: Icon,
  title,
  description,
  children,
  controlClassName = 'setting-control',
}: SettingItemProps) {
  return (
    <div className="setting-item">
      <div className="setting-header">
        <div className="setting-icon">
          <Icon className="w-4 h-4" />
        </div>
        <div>
          <h4 className="setting-title">{title}</h4>
          {description && <p className="setting-desc">{description}</p>}
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
