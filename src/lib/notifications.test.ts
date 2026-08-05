import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import i18n from './i18n';
import {
  notifyInstallComplete,
  notifyUpdateAvailable,
  notifyUpdateComplete,
} from './notifications';

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

describe('notifications', () => {
  beforeEach(async () => {
    // resetAllMocks also clears implementations, so defaults are
    // re-established here for every test.
    vi.resetAllMocks();
    (isPermissionGranted as Mock).mockResolvedValue(true);
    (requestPermission as Mock).mockResolvedValue('granted');
    // Bodies resolve through the shared i18next instance; pin it to English.
    await i18n.changeLanguage('en');
  });

  describe('notifyInstallComplete', () => {
    it('sends a notification when enabled and permission is granted', async () => {
      await notifyInstallComplete('Quirheim Online', true);

      expect(sendNotification).toHaveBeenCalledWith({
        title: 'Quirheim Online',
        body: 'Installation complete',
      });
      // Already granted: no permission request needed
      expect(requestPermission).not.toHaveBeenCalled();
    });

    it('does nothing when disabled', async () => {
      await notifyInstallComplete('Quirheim Online', false);

      expect(sendNotification).not.toHaveBeenCalled();
      expect(isPermissionGranted).not.toHaveBeenCalled();
    });
  });

  describe('notifyUpdateComplete', () => {
    it('sends an update-complete notification', async () => {
      await notifyUpdateComplete('Quirheim Online', true);

      expect(sendNotification).toHaveBeenCalledWith({
        title: 'Quirheim Online',
        body: 'Update complete',
      });
    });

    it('does nothing when disabled', async () => {
      await notifyUpdateComplete('Quirheim Online', false);

      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe('notifyUpdateAvailable', () => {
    it('sends an update-available notification', async () => {
      await notifyUpdateAvailable('Quirheim Online', true);

      expect(sendNotification).toHaveBeenCalledWith({
        title: 'Quirheim Online',
        body: 'Update available',
      });
    });

    it('does nothing when disabled', async () => {
      await notifyUpdateAvailable('Quirheim Online', false);

      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe('localization', () => {
    it('resolves the body in the active language', async () => {
      await i18n.changeLanguage('fr');

      await notifyInstallComplete('Quirheim Online', true);

      expect(sendNotification).toHaveBeenCalledWith({
        title: 'Quirheim Online',
        body: 'Installation terminée',
      });
    });

    it('keeps the game name as the title regardless of language', async () => {
      await i18n.changeLanguage('fr');

      await notifyUpdateAvailable('Quirheim Online', true);

      expect(sendNotification).toHaveBeenCalledWith({
        title: 'Quirheim Online',
        body: 'Mise à jour disponible',
      });
    });
  });

  describe('permission handling', () => {
    it('requests permission lazily when not yet granted', async () => {
      (isPermissionGranted as Mock).mockResolvedValue(false);
      (requestPermission as Mock).mockResolvedValue('granted');

      await notifyInstallComplete('Quirheim Online', true);

      expect(requestPermission).toHaveBeenCalledTimes(1);
      expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    it('skips silently when permission is denied', async () => {
      (isPermissionGranted as Mock).mockResolvedValue(false);
      (requestPermission as Mock).mockResolvedValue('denied');

      await expect(notifyInstallComplete('Quirheim Online', true)).resolves.toBeUndefined();

      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('swallows plugin errors', async () => {
      (isPermissionGranted as Mock).mockRejectedValue(new Error('plugin unavailable'));

      await expect(notifyInstallComplete('Quirheim Online', true)).resolves.toBeUndefined();

      expect(sendNotification).not.toHaveBeenCalled();
    });

    it('swallows sendNotification failures', async () => {
      (sendNotification as Mock).mockImplementation(() => {
        throw new Error('delivery failed');
      });

      await expect(notifyInstallComplete('Quirheim Online', true)).resolves.toBeUndefined();
    });
  });
});
