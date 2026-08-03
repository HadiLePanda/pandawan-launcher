import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { useLauncherStore } from './store';
import { logger } from './logger';
import type { LauncherSettings } from '@/types';

type NotificationToggle = keyof Pick<
  LauncherSettings,
  'notifyGameUpdates' | 'notifyDownloadComplete' | 'notifyFriendActivity' | 'notifyNewsEvents'
>;

// The default settings in Settings.tsx enable all notification types we use,
// so a missing settings object (not loaded yet) is treated as "on".
async function notify(title: string, body: string, toggleKey: NotificationToggle): Promise<void> {
  try {
    const settings = useLauncherStore.getState().settings;
    if (settings && !settings[toggleKey]) {
      return;
    }

    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === 'granted';
    }
    if (!granted) {
      logger.warn('Notification skipped: permission denied', { title });
      return;
    }

    sendNotification({ title, body });
  } catch (err) {
    // Notifications must never break the install/update flow.
    logger.error('Failed to send notification', { title, error: String(err) });
  }
}

export function notifyInstallComplete(gameName: string): Promise<void> {
  return notify(gameName, 'Installation complete', 'notifyDownloadComplete');
}

export function notifyUpdateComplete(gameName: string): Promise<void> {
  return notify(gameName, 'Update complete', 'notifyDownloadComplete');
}

export function notifyUpdateAvailable(gameName: string): Promise<void> {
  return notify(gameName, 'Update available', 'notifyGameUpdates');
}
