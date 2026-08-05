import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));

function makeUpdate(overrides?: Record<string, unknown>) {
  return {
    version: '0.2.0',
    currentVersion: '0.1.0',
    downloadAndInstall: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('updater-service', () => {
  let service: typeof import('./updater-service');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    service = await import('./updater-service');
  });

  describe('initial state', () => {
    it('starts idle', () => {
      const state = service.useUpdaterStore.getState();
      expect(state.status).toBe('idle');
      expect(state.version).toBeNull();
      expect(state.dismissed).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('checkForUpdates', () => {
    it('transitions to available when an update is found', async () => {
      (check as Mock).mockResolvedValue(makeUpdate());

      const result = await service.checkForUpdates();

      expect(result).toBe('available');
      const state = service.useUpdaterStore.getState();
      expect(state.status).toBe('available');
      expect(state.version).toBe('0.2.0');
    });

    it('transitions to up-to-date when no update is available', async () => {
      (check as Mock).mockResolvedValue(null);

      const result = await service.checkForUpdates();

      expect(result).toBe('up-to-date');
      expect(service.useUpdaterStore.getState().status).toBe('up-to-date');
      expect(service.useUpdaterStore.getState().version).toBeNull();
    });

    it('swallows check failures and records the error', async () => {
      (check as Mock).mockRejectedValue(new Error('network unreachable'));

      const result = await service.checkForUpdates();

      expect(result).toBe('error');
      const state = service.useUpdaterStore.getState();
      expect(state.status).toBe('error');
      expect(state.error).toBe('network unreachable');
    });

    it('does not start a second check while one is in flight', async () => {
      let resolveCheck: (value: null) => void = () => {};
      (check as Mock).mockImplementation(
        () => new Promise<null>((resolve) => (resolveCheck = resolve))
      );

      const first = service.checkForUpdates();
      const second = service.checkForUpdates();

      expect(await second).toBe('checking');
      expect(check).toHaveBeenCalledTimes(1);

      resolveCheck(null);
      expect(await first).toBe('up-to-date');
      expect(check).toHaveBeenCalledTimes(1);
    });

    it('ignores re-checks once an update is ready to apply', async () => {
      (check as Mock).mockResolvedValue(makeUpdate());
      await service.checkForUpdates();
      await service.downloadAndInstall();
      expect(service.useUpdaterStore.getState().status).toBe('ready');

      const result = await service.checkForUpdates({ manual: true });

      expect(result).toBe('ready');
      expect(check).toHaveBeenCalledTimes(1);
      const state = service.useUpdaterStore.getState();
      expect(state.status).toBe('ready');
      expect(state.version).toBe('0.2.0');
    });

    it('re-surfaces a dismissed banner on a manual re-check', async () => {
      (check as Mock).mockResolvedValue(makeUpdate());
      await service.checkForUpdates();
      service.useUpdaterStore.getState().dismissBanner();

      const result = await service.checkForUpdates({ manual: true });

      expect(result).toBe('available');
      expect(service.useUpdaterStore.getState().dismissed).toBe(false);
    });

    it('keeps the banner dismissed on a silent startup re-check', async () => {
      (check as Mock).mockResolvedValue(makeUpdate());
      await service.checkForUpdates();
      service.useUpdaterStore.getState().dismissBanner();

      const result = await service.checkForUpdates();

      expect(result).toBe('available');
      expect(service.useUpdaterStore.getState().dismissed).toBe(true);
    });

    it('closes the previous update resource when replacing it', async () => {
      const first = makeUpdate();
      const second = makeUpdate({ version: '0.3.0' });
      (check as Mock).mockResolvedValueOnce(first).mockResolvedValueOnce(second);

      await service.checkForUpdates();
      await service.checkForUpdates({ manual: true });

      expect(first.close).toHaveBeenCalledTimes(1);
      expect(service.useUpdaterStore.getState().version).toBe('0.3.0');
    });

    it('closes the pending update when the launcher turns up-to-date', async () => {
      const update = makeUpdate();
      (check as Mock).mockResolvedValueOnce(update).mockResolvedValueOnce(null);

      await service.checkForUpdates();
      await service.checkForUpdates();

      expect(update.close).toHaveBeenCalledTimes(1);
      expect(service.useUpdaterStore.getState().status).toBe('up-to-date');
    });
  });

  describe('downloadAndInstall', () => {
    it('tracks progress events and becomes ready when finished', async () => {
      const update = makeUpdate({
        downloadAndInstall: vi.fn(async (onEvent?: (event: unknown) => void) => {
          onEvent?.({ event: 'Started', data: { contentLength: 100 } });
          onEvent?.({ event: 'Progress', data: { chunkLength: 40 } });
          onEvent?.({ event: 'Progress', data: { chunkLength: 60 } });
          onEvent?.({ event: 'Finished' });
        }),
      });
      (check as Mock).mockResolvedValue(update);
      await service.checkForUpdates();
      service.useUpdaterStore.getState().dismissBanner();

      await service.downloadAndInstall();

      expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
      const state = service.useUpdaterStore.getState();
      expect(state.status).toBe('ready');
      expect(state.downloadedBytes).toBe(100);
      expect(state.totalBytes).toBe(100);
      // Ready state re-surfaces the banner so the user can restart
      expect(state.dismissed).toBe(false);
    });

    it('returns to available when the download fails', async () => {
      (check as Mock).mockResolvedValue(
        makeUpdate({
          downloadAndInstall: vi.fn(async () => {
            throw new Error('signature mismatch');
          }),
        })
      );
      await service.checkForUpdates();

      await service.downloadAndInstall();

      const state = service.useUpdaterStore.getState();
      expect(state.status).toBe('available');
      expect(state.error).toBe('signature mismatch');
    });

    it('is a no-op when no update has been checked', async () => {
      await service.downloadAndInstall();

      expect(service.useUpdaterStore.getState().status).toBe('idle');
      expect(check).not.toHaveBeenCalled();
    });

    it('is a no-op while a download is already running', async () => {
      const update = makeUpdate({
        downloadAndInstall: vi.fn(async () => {}),
      });
      (check as Mock).mockResolvedValue(update);
      await service.checkForUpdates();
      service.useUpdaterStore.setState({ status: 'downloading' });

      await service.downloadAndInstall();

      expect(update.downloadAndInstall).not.toHaveBeenCalled();
    });
  });

  describe('restartToApplyUpdate', () => {
    it('relaunches the application', async () => {
      await service.restartToApplyUpdate();

      expect(relaunch).toHaveBeenCalledTimes(1);
    });

    it('swallows relaunch failures', async () => {
      (relaunch as Mock).mockRejectedValue(new Error('restart denied'));

      await expect(service.restartToApplyUpdate()).resolves.toBeUndefined();
    });
  });

  describe('checkForUpdatesOnStartup', () => {
    it('checks for updates when the autoUpdateLauncher toggle is on', async () => {
      (check as Mock).mockResolvedValue(null);

      await service.checkForUpdatesOnStartup(true);

      expect(check).toHaveBeenCalledTimes(1);
    });

    it('skips the check when the autoUpdateLauncher toggle is off', async () => {
      await service.checkForUpdatesOnStartup(false);

      expect(check).not.toHaveBeenCalled();
      expect(service.useUpdaterStore.getState().status).toBe('idle');
    });

    it('skips the check while settings are not loaded yet', async () => {
      await service.checkForUpdatesOnStartup(undefined);

      expect(check).not.toHaveBeenCalled();
      expect(service.useUpdaterStore.getState().status).toBe('idle');
    });
  });

  describe('dismissBanner', () => {
    it('hides the banner for the session', () => {
      service.useUpdaterStore.setState({ status: 'available', version: '0.2.0' });

      service.useUpdaterStore.getState().dismissBanner();

      expect(service.useUpdaterStore.getState().dismissed).toBe(true);
      expect(service.useUpdaterStore.getState().status).toBe('available');
    });
  });
});
