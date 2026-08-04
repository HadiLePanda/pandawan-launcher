import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { logger } from './logger';

// `enabled` is the resolved settings toggle for this notification type,
// supplied by the caller (the launcher store) so this module stays
// dependency-free of the store.
async function notify(title: string, body: string, enabled: boolean): Promise<void> {
  try {
    if (!enabled) {
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

export function notifyInstallComplete(gameName: string, enabled: boolean): Promise<void> {
  return notify(gameName, 'Installation complete', enabled);
}

export function notifyUpdateComplete(gameName: string, enabled: boolean): Promise<void> {
  return notify(gameName, 'Update complete', enabled);
}

export function notifyUpdateAvailable(gameName: string, enabled: boolean): Promise<void> {
  return notify(gameName, 'Update available', enabled);
}
