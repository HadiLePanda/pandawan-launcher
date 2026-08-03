import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import type { LauncherSettings } from '@/types';

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

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

let mockSettings: LauncherSettings | null = DEFAULT_SETTINGS;

vi.mock('./store', () => ({
  useLauncherStore: {
    getState: () => ({ settings: mockSettings }),
  },
}));

describe('notifications', () => {
  let notifications: typeof import('./notifications');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockSettings = { ...DEFAULT_SETTINGS };
    (isPermissionGranted as Mock).mockResolvedValue(true);
    (requestPermission as Mock).mockResolvedValue('granted');
    notifications = await import('./notifications');
  });

  describe('notifyInstallComplete', () => {
    it('sends a notification when the toggle is on and permission is granted', async () => {
      await notifications.notifyInstallComplete('Quirheim Online');

      expect(sendNotification).toHaveBeenCalledWith({
        title: 'Quirheim Online',
        body: 'Installation complete',
      });
      // Already granted: no permission request needed
      expect(requestPermission).not.toHaveBeenCalled();
    });

    it('does nothing when notifyDownloadComplete is off', async () => {
      mockSettings = { ...DEFAULT_SETTINGS, notifyDownloadComplete: false };

      await notifications.notifyInstallComplete('Quirheim Online');

      expect(sendNotification).not.toHaveBeenCalled();
      expect(isPermissionGranted).not.toHaveBeenCalled();
    });
  });

  describe('notifyUpdateComplete', () => {
    it('sends an update-complete notification gated on notifyDownloadComplete', async () => {
      await notifications.notifyUpdateComplete('Quirheim Online');

      expect(sendNotification).toHaveBeenCalledWith({
        title: 'Quirheim Online',
        body: 'Update complete',
      });
    });

    it('does nothing when notifyDownloadComplete is off', async () => {
      mockSettings = { ...DEFAULT_SETTINGS, notifyDownloadComplete: false };

      await notifications.notifyUpdateComplete('Quirheim Online');

      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe('notifyUpdateAvailable', () => {
    it('sends an update-available notification gated on notifyGameUpdates', async () => {
      await notifications.notifyUpdateAvailable('Quirheim Online');

      expect(sendNotification).toHaveBeenCalledWith({
        title: 'Quirheim Online',
        body: 'Update available',
      });
    });

    it('does nothing when notifyGameUpdates is off', async () => {
      mockSettings = { ...DEFAULT_SETTINGS, notifyGameUpdates: false };

      await notifications.notifyUpdateAvailable('Quirheim Online');

      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe('permission handling', () => {
    it('requests permission lazily when not yet granted', async () => {
      (isPermissionGranted as Mock).mockResolvedValue(false);
      (requestPermission as Mock).mockResolvedValue('granted');

      await notifications.notifyInstallComplete('Quirheim Online');

      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    it('skips silently when permission is denied', async () => {
      (isPermissionGranted as Mock).mockResolvedValue(false);
      (requestPermission as Mock).mockResolvedValue('denied');

      await expect(notifications.notifyInstallComplete('Quirheim Online')).resolves.toBeUndefined();

      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('swallows plugin errors', async () => {
      (isPermissionGranted as Mock).mockRejectedValue(new Error('plugin unavailable'));

      await expect(notifications.notifyInstallComplete('Quirheim Online')).resolves.toBeUndefined();

      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('swallows sendNotification failures', async () => {
      (sendNotification as Mock).mockImplementation(() => {
        throw new Error('delivery failed');
      });

      await expect(notifications.notifyInstallComplete('Quirheim Online')).resolves.toBeUndefined();
    });
  });

  describe('missing settings', () => {
    it('treats unloaded settings as enabled (matches UI defaults)', async () => {
      mockSettings = null;

      await notifications.notifyUpdateAvailable('Quirheim Online');

      expect(sendNotification).toHaveBeenCalledTimes(1);
    });
  });
});
