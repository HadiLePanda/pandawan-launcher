import { useState, useEffect } from 'react';
import {
  X,
  Folder,
  Download,
  Bell,
  Globe,
  HardDrive,
  Info,
  SunMoon,
  User,
  Check,
  Copy,
  Loader2,
} from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { appLogDir } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-shell';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useLauncherStore } from '@/lib/store';
import { AVATAR_IDS, avatarUrl } from '@/lib/avatars';
import * as gameService from '@/lib/game-service';
import { commands } from '@/lib/commands';
import { unwrapResult } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  useUpdaterStore,
  checkForUpdates,
  downloadAndInstall,
  restartToApplyUpdate,
} from '@/lib/updater-service';
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
};

export function Settings({ isOpen, onClose }: SettingsProps) {
  const { t } = useTranslation();
  const { settings, setSettings } = useLauncherStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [editedSettings, setEditedSettings] = useState<LauncherSettings>(DEFAULT_SETTINGS);
  const [saveError, setSaveError] = useState<string | null>(null);
  // What the editor was seeded from, so a later open can tell a real settings
  // change apart from the same object being handed back by the store.
  const [seededFrom, setSeededFrom] = useState<{
    isOpen: boolean;
    settings: LauncherSettings | null;
  }>({ isOpen, settings });

  const tabLabels: Record<SettingsTab, string> = {
    general: t('settings.tabs.general'),
    downloads: t('settings.tabs.downloads'),
    notifications: t('settings.tabs.notifications'),
    account: t('settings.tabs.account'),
    about: t('settings.tabs.about'),
  };

  // Reseeding the editor from the store. Done during render instead of in an
  // effect so the modal never paints one frame with the previous session's
  // edits still in the fields - an effect would commit them to screen first.
  // `seededFrom` holds what the current edit buffer was seeded from; a
  // difference means the store moved under us, or the modal was (re)opened, and
  // the buffer is stale by definition. Closed, this never fires, matching the
  // old guard that only seeded while open.
  if (isOpen !== seededFrom.isOpen || (isOpen && seededFrom.settings !== settings)) {
    setSeededFrom({ isOpen, settings });
    if (isOpen) {
      setEditedSettings(settings || DEFAULT_SETTINGS);
      setSaveError(null);
    }
  }

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
            {saveError && <div className="settings-error-toast">{saveError}</div>}
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
  const [copied, setCopied] = useState(false);

  // The real default, resolved from the backend, so the field can show an
  // actual path. Showing the word "Default" hid where games go, which is the
  // one thing someone moves installs or checks free space needs to know.
  const [defaultPath, setDefaultPath] = useState<string>('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const dir = unwrapResult(await commands.getDefaultInstallFolder());
        if (alive) setDefaultPath(dir);
      } catch (err) {
        logger.warn('Failed to resolve default install folder', { error: String(err) });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The path is often long enough to clip, and users need it for support,
  // moving installs, and checking free space. Showing it truncated with no way to
  // read the whole thing was the gap.
  const installPath = settings.gamesInstallPath ?? '';
  const resolvedPath = installPath || defaultPath;
  // True when the setting is empty and installs are using the backend default,
  // which is the only case where Reset is worth showing.
  const usingDefault = !installPath && Boolean(defaultPath);

  const handleReset = () => {
    onChange({ gamesInstallPath: null });
  };

  const handleCopy = async () => {
    if (!resolvedPath) return;
    try {
      await navigator.clipboard.writeText(resolvedPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      logger.error('Failed to copy install path', { error: String(err) });
    }
  };

  const handleOpenFolder = async () => {
    if (!resolvedPath) return;
    try {
      await open(resolvedPath);
    } catch (err) {
      logger.error('Failed to open install folder', { path: resolvedPath, error: String(err) });
    }
  };

  const handleBrowse = async () => {
    try {
      // Open the picker at the folder currently in use, so changing it is a
      // small move rather than a full re-navigation each time.
      const selected = await gameService.selectInstallFolder(resolvedPath || undefined);
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
        {/* Stacked rather than side by side: the setting's control column is a row
            for a single control, which put the note beside the path and squeezed
            it to a few words. */}
        <div className="install-path-stack">
          <div className="install-path-row">
            {/* One line that scrolls rather than wraps: a wrapped path grew the
                row and pushed the controls out of the panel. */}
            <div className="install-path-box" title={resolvedPath}>
              {resolvedPath}
            </div>
            <div className="cluster cluster-sm">
              {/* These act on the folder in use, which exists even on the default,
                so they are available either way. */}
              <button
                onClick={handleOpenFolder}
                className="btn btn-secondary btn-sm"
                title={t('settings.general.installLocation.openFolder')}
                aria-label={t('settings.general.installLocation.openFolder')}
              >
                <Folder className="w-4 h-4" />
              </button>
              <button
                onClick={handleCopy}
                className="btn btn-secondary btn-sm"
                title={t('settings.general.installLocation.copyPath')}
                aria-label={t('settings.general.installLocation.copyPath')}
              >
                {copied ? <Check className="w-4 h-4 text-action" /> : <Copy className="w-4 h-4" />}
              </button>
              <button onClick={handleBrowse} className="btn btn-secondary btn-sm">
                {t('settings.general.installLocation.browse')}
              </button>
              {/* Only meaningful once a custom path is set: there is nothing to
                reset back to otherwise. */}
              {installPath && (
                <button
                  onClick={handleReset}
                  className="btn btn-ghost btn-sm"
                  title={t('settings.general.installLocation.reset')}
                >
                  {t('settings.general.installLocation.reset')}
                </button>
              )}
            </div>
          </div>
          {/* Say where the path came from, so an unchanged field does not read as
            "never configured". */}
          {usingDefault && (
            <p className="caption">{t('settings.general.installLocation.usingDefault')}</p>
          )}
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

      <ToggleSetting
        title={t('settings.general.minimizeToTray.title')}
        description={t('settings.general.minimizeToTray.description')}
        checked={settings.minimizeToTray}
        onChange={(checked) => onChange({ minimizeToTray: checked })}
      />
      <ToggleSetting
        title={t('settings.general.closeToTray.title')}
        description={t('settings.general.closeToTray.description')}
        checked={settings.closeToTray}
        onChange={(checked) => onChange({ closeToTray: checked })}
      />
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

  // Dev-build only, and only while nothing real is happening: the forcer does
  // not exist in a release build and must not compete with a genuine update.
  const showDevHint =
    import.meta.env.DEV && (updaterStatus === 'idle' || updaterStatus === 'up-to-date');

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
        {/* The real Circle-P mark, not a letter in a box. The app icon and the
            download site use the same artwork, so this matches what the user
            already recognises. */}
        <img src="/logo-circle-p.png" alt="" className="about-logo" width={56} height={56} />
        <div className="min-w-0">
          <h4 className="title-3">Pandawan Launcher</h4>
          <p className="caption">
            {/* getVersion() returns a bare semver, which read as a stray number.
                Release versions are referred to with a leading v everywhere else
                in the app and on the download site. */}
            {currentVersion ? `v${currentVersion}` : '—'}
          </p>
        </div>
      </div>

      {/* Grouped into one panel with both actions, rather than two full-width
          rows that each carry an icon and a one-line caption. The status text
          belongs to the update action, and the log folder is a support action
          that does not warrant a row of its own. */}
      <div className="about-actions">
        {/* Heading and action on one line: the buttons are the point of this card,
            and stacking them under the title left the right half empty. */}
        <div className="about-actions-head">
          <span className="body">{t('settings.about.updates.title')}</span>
          <div className="about-actions-row">
            <button
              onClick={() => void checkForUpdates({ manual: true })}
              disabled={busy}
              className="btn btn-secondary btn-sm"
            >
              {updaterStatus === 'checking' && <Loader2 className="update-spinner w-3.5 h-3.5" />}
              {t('settings.about.updates.checkButton')}
            </button>
            {/* The update is found here, so installing it belongs here too:
                sending the user to the top-right button to act on what this
                panel just told them was the wrong place to look. */}
            {updaterStatus === 'available' && (
              <button
                onClick={() => void downloadAndInstall()}
                className="btn btn-primary btn-sm update-enter"
              >
                {t('settings.about.updates.installButton')}
              </button>
            )}
            {updaterStatus === 'ready' && (
              <button
                onClick={() => void restartToApplyUpdate()}
                className="btn btn-primary btn-sm update-restart"
              >
                <svg
                  className="update-check w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 12.5l5 5L20 6.5" />
                </svg>
                {t('settings.about.updates.restartButton')}
              </button>
            )}
            <button
              onClick={() => void handleOpenLogs()}
              disabled={openingLogs}
              className="btn btn-ghost btn-sm"
            >
              {t('settings.about.logs.openButton')}
            </button>
          </div>
        </div>
        {statusText && <p className="caption">{statusText}</p>}
        {showDevHint && <p className="caption">{t('settings.about.updates.devHint')}</p>}
        {logsError && <p className="caption text-red-400">{logsError}</p>}
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
      </div>

      {/* A build-time detail, not an app version. As its own label/value row it
          read as a second version next to the launcher's in the header above. */}
      <p className="text-xs text-ink-muted mt-3">{t('settings.about.tauriVersion')} · 2.0.0</p>
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
