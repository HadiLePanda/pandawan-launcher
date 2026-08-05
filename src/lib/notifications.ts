import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import i18n from './i18n';
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
  return notify(gameName, i18n.t('notifications.installComplete'), enabled);
}

export function notifyUpdateComplete(gameName: string, enabled: boolean): Promise<void> {
  return notify(gameName, i18n.t('notifications.updateComplete'), enabled);
}

export function notifyUpdateAvailable(gameName: string, enabled: boolean): Promise<void> {
  return notify(gameName, i18n.t('notifications.updateAvailable'), enabled);
}
