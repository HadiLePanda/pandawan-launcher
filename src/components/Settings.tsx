import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Folder, Download, Bell, Globe, HardDrive } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import type { LauncherSettings } from '@/types';

export function Settings() {
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await invoke<LauncherSettings>('get_settings');
      setSettings(data);
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = <K extends keyof LauncherSettings>(
    key: K,
    value: LauncherSettings[K]
  ) => {
    setSettings((prev) => {
      if (!prev) return prev;
      return { ...prev, [key]: value };
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!settings) return;
    
    try {
      await invoke('save_settings', { newSettings: settings });
      setHasChanges(false);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const path = await invoke<string | null>('select_install_folder');
      if (path) {
        handleChange('gamesInstallPath', path);
      }
    } catch (err) {
      console.error('Failed to select folder:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="h-full flex items-center justify-center text-ink-muted">
        Failed to load settings
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Settings</h1>
            <p className="text-ink-muted">Customize your launcher experience</p>
          </div>
          {hasChanges && (
            <button
              onClick={handleSave}
              className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors btn-press"
            >
              Save Changes
            </button>
          )}
        </div>

        <div className="space-y-8">
          {/* Installation */}
          <section className="bg-surface rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
                <Folder className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="font-semibold">Installation</h2>
                <p className="text-sm text-ink-muted">Where your games are installed</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Games Install Location</label>
                <div className="flex gap-3">
                  <div className="flex-1 px-4 py-3 bg-canvas rounded-lg text-ink-muted text-sm truncate">
                    {settings.gamesInstallPath || 'Default location'}
                  </div>
                  <button
                    onClick={handleSelectFolder}
                    className="px-4 py-2 bg-surface-light hover:bg-surface-hover rounded-lg text-sm font-medium transition-colors"
                  >
                    Browse
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-border">
                <div>
                  <label className="font-medium">Auto-update games</label>
                  <p className="text-sm text-ink-muted">Automatically update games when available</p>
                </div>
                <button
                  onClick={() => handleChange('autoUpdateGames', !settings.autoUpdateGames)}
                  className={cn(
                    'w-12 h-6 rounded-full transition-colors relative',
                    settings.autoUpdateGames ? 'bg-accent' : 'bg-surface-light'
                  )}
                >
                  <div
                    className={cn(
                      'w-5 h-5 rounded-full bg-white transition-transform absolute top-0.5',
                      settings.autoUpdateGames ? 'translate-x-6' : 'translate-x-0.5'
                    )}
                  />
                </button>
              </div>
            </div>
          </section>

          {/* Downloads */}
          <section className="bg-surface rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
                <Download className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="font-semibold">Downloads</h2>
                <p className="text-sm text-ink-muted">Control how games are downloaded</p>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium mb-3">
                  Max concurrent downloads: {settings.maxConcurrentDownloads}
                </label>
                <input
                  type="range"
                  min="1"
                  max="8"
                  value={settings.maxConcurrentDownloads}
                  onChange={(e) => handleChange('maxConcurrentDownloads', parseInt(e.target.value))}
                  className="w-full accent-accent"
                />
                <div className="flex justify-between text-xs text-ink-muted mt-1">
                  <span>1</span>
                  <span>8</span>
                </div>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-border">
                <div>
                  <label className="font-medium">Limit download speed</label>
                  <p className="text-sm text-ink-muted">Restrict bandwidth usage</p>
                </div>
                <button
                  onClick={() => handleChange('maxDownloadSpeed', settings.maxDownloadSpeed ? null : 10_000_000)}
                  className={cn(
                    'w-12 h-6 rounded-full transition-colors relative',
                    settings.maxDownloadSpeed !== null ? 'bg-accent' : 'bg-surface-light'
                  )}
                >
                  <div
                    className={cn(
                      'w-5 h-5 rounded-full bg-white transition-transform absolute top-0.5',
                      settings.maxDownloadSpeed !== null ? 'translate-x-6' : 'translate-x-0.5'
                    )}
                  />
                </button>
              </div>
            </div>
          </section>

          {/* Launcher */}
          <section className="bg-surface rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
                <HardDrive className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="font-semibold">Launcher</h2>
                <p className="text-sm text-ink-muted">Launcher behavior settings</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between py-3">
                <div>
                  <label className="font-medium">Minimize to tray</label>
                  <p className="text-sm text-ink-muted">Keep launcher running in system tray</p>
                </div>
                <button
                  onClick={() => handleChange('minimizeToTray', !settings.minimizeToTray)}
                  className={cn(
                    'w-12 h-6 rounded-full transition-colors relative',
                    settings.minimizeToTray ? 'bg-accent' : 'bg-surface-light'
                  )}
                >
                  <div
                    className={cn(
                      'w-5 h-5 rounded-full bg-white transition-transform absolute top-0.5',
                      settings.minimizeToTray ? 'translate-x-6' : 'translate-x-0.5'
                    )}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-border">
                <div>
                  <label className="font-medium">Close to tray</label>
                  <p className="text-sm text-ink-muted">Don't close launcher when closing window</p>
                </div>
                <button
                  onClick={() => handleChange('closeToTray', !settings.closeToTray)}
                  className={cn(
                    'w-12 h-6 rounded-full transition-colors relative',
                    settings.closeToTray ? 'bg-accent' : 'bg-surface-light'
                  )}
                >
                  <div
                    className={cn(
                      'w-5 h-5 rounded-full bg-white transition-transform absolute top-0.5',
                      settings.closeToTray ? 'translate-x-6' : 'translate-x-0.5'
                    )}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between py-3 border-t border-border">
                <div>
                  <label className="font-medium">Auto-update launcher</label>
                  <p className="text-sm text-ink-muted">Automatically install launcher updates</p>
                </div>
                <button
                  onClick={() => handleChange('autoUpdateLauncher', !settings.autoUpdateLauncher)}
                  className={cn(
                    'w-12 h-6 rounded-full transition-colors relative',
                    settings.autoUpdateLauncher ? 'bg-accent' : 'bg-surface-light'
                  )}
                >
                  <div
                    className={cn(
                      'w-5 h-5 rounded-full bg-white transition-transform absolute top-0.5',
                      settings.autoUpdateLauncher ? 'translate-x-6' : 'translate-x-0.5'
                    )}
                  />
                </button>
              </div>
            </div>
          </section>

          {/* About */}
          <section className="bg-surface rounded-2xl p-6">
            <h2 className="font-semibold mb-4">About</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-muted">Version</span>
                <span>0.1.0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">Developer</span>
                <span>Pandawan Corp</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
