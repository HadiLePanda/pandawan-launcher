import { create } from 'zustand';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { logger } from './logger';
import { commands } from './commands';

export type UpdaterStatus =
  'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdaterState {
  status: UpdaterStatus;
  /** Version of the available update, if any. */
  version: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  /** Banner hidden for the rest of the session. */
  dismissed: boolean;
  error: string | null;

  dismissBanner: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set) => ({
  status: 'idle',
  version: null,
  downloadedBytes: 0,
  totalBytes: null,
  dismissed: false,
  error: null,

  dismissBanner: () => set({ dismissed: true }),
}));

// The Update resource returned by check(), kept between the check and the
// user-initiated download. Not part of the store: it is not serializable UI state.
let pendingUpdate: Update | null = null;

export interface CheckForUpdatesOptions {
  /** Manual checks (Settings) re-surface a dismissed banner. */
  manual?: boolean;
}

function replacePendingUpdate(update: Update | null): void {
  const previous = pendingUpdate;
  pendingUpdate = update;
  if (previous && previous !== update) {
    previous.close().catch((err) => {
      logger.warn('Failed to close previous update resource', { error: String(err) });
    });
  }
}

/**
 * Mirror an update becoming available into the tray tooltip.
 *
 * The tray lives in Rust and cannot see the JS updater's state, so it is pushed
 * across. Failures are swallowed: the tray tooltip is cosmetic and must never
 * break a real update check. In a non-Tauri context (tests) the invoke throws
 * synchronously, which is why this is wrapped rather than merely `.catch`ed.
 */
function syncTrayUpdateState(status: UpdaterStatus): void {
  const available = status === 'available' || status === 'downloading' || status === 'ready';
  try {
    void commands.setLauncherUpdateAvailable(available).catch(() => {});
  } catch (err) {
    logger.warn('Failed to sync the tray update state', { error: String(err) });
  }
}

// A check that never settles would strand the UI on "Checking…" forever, so it
// is capped and the timeout surfaces as an ordinary error.
const CHECK_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Update check timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function checkForUpdates(options?: CheckForUpdatesOptions): Promise<UpdaterStatus> {
  const current = useUpdaterStore.getState().status;
  // Keep a downloaded update pending until relaunch; a re-check would leak the
  // Update resource and invite a redundant re-download.
  if (current === 'checking' || current === 'downloading' || current === 'ready') {
    return current;
  }

  useUpdaterStore.setState({ status: 'checking', error: null });
  try {
    const update = await withTimeout(check(), CHECK_TIMEOUT_MS);
    if (!update) {
      replacePendingUpdate(null);
      useUpdaterStore.setState({ status: 'up-to-date', version: null });
      syncTrayUpdateState('up-to-date');
      return 'up-to-date';
    }
    replacePendingUpdate(update);
    logger.info('Launcher update available', { version: update.version });
    useUpdaterStore.setState((state) => ({
      status: 'available',
      version: update.version,
      dismissed: options?.manual ? false : state.dismissed,
    }));
    syncTrayUpdateState('available');
    return 'available';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Launcher update check failed', { error: message });
    useUpdaterStore.setState({ status: 'error', error: message });
    return 'error';
  }
}

// Silent startup update check, gated on the autoUpdateLauncher setting.
// `undefined` means settings have not loaded yet: skip rather than guess.
// Manual checks (Settings -> About) call checkForUpdates directly and are
// unaffected by the toggle.
export async function checkForUpdatesOnStartup(
  autoUpdateEnabled: boolean | undefined
): Promise<void> {
  if (!autoUpdateEnabled) return;
  await checkForUpdates();
}

export async function downloadAndInstall(): Promise<void> {
  const update = pendingUpdate;
  if (!update || useUpdaterStore.getState().status === 'downloading') {
    return;
  }

  useUpdaterStore.setState({
    status: 'downloading',
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
  });
  syncTrayUpdateState('downloading');
  try {
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          useUpdaterStore.setState({
            downloadedBytes: 0,
            totalBytes: event.data.contentLength ?? null,
          });
          break;
        case 'Progress':
          useUpdaterStore.setState((state) => ({
            downloadedBytes: state.downloadedBytes + event.data.chunkLength,
          }));
          break;
        case 'Finished':
          break;
      }
    });
    logger.info('Launcher update installed, restart required');
    // Re-surface the banner (even if dismissed) so the user can restart.
    useUpdaterStore.setState({ status: 'ready', dismissed: false });
    syncTrayUpdateState('ready');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Launcher update download failed', { error: message });
    // Back to available so the user can retry.
    useUpdaterStore.setState({ status: 'available', error: message });
    syncTrayUpdateState('available');
  }
}

export async function restartToApplyUpdate(): Promise<void> {
  try {
    await relaunch();
  } catch (err) {
    logger.error('Failed to relaunch launcher', { error: String(err) });
  }
}

/**
 * Exit the launcher.
 *
 * Called from the frontend only after the user confirms a quit while a game is
 * running, so the confirmation lives where the copy does. A no-game quit is
 * handled directly in Rust and never reaches here.
 */
export async function quitLauncher(): Promise<void> {
  try {
    await commands.quitLauncher();
  } catch (err) {
    logger.error('Failed to quit the launcher', { error: String(err) });
  }
}
