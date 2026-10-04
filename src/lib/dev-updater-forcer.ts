import { useUpdaterStore, type UpdaterStatus } from './updater-service';

/**
 * Dev-only launcher-updater state forcer.
 *
 * It exists so every update-UI state can be inspected without installing an
 * update, and it is loaded through a dynamic import inside an
 * `import.meta.env.DEV` branch in main.tsx. That branch is statically false in a
 * release build, so Rollup drops it and never emits this module: a shipping
 * launcher cannot contain code that fakes an update state. That guarantee is
 * the point - a build able to forge an update is a security problem, not just
 * dead weight.
 *
 * Everything here writes store fields only. It never calls check(),
 * downloadAndInstall() or relaunch(), so forcing a state cannot start a real
 * download or install.
 */

const PREVIEW_VERSION = '0.2.1';
const PREVIEW_TOTAL_BYTES = 42 * 1024 * 1024;
// Fills the bar over ~5s: long enough to read the width easing and the shimmer
// sweep, short enough to not feel broken.
const PREVIEW_STEP_MS = 100;
const PREVIEW_STEPS = 50;

export interface LauncherUpdaterForcer {
  force: (status: UpdaterStatus) => void;
  cycle: () => void;
  states: readonly UpdaterStatus[];
}

declare global {
  interface Window {
    __launcherUpdater?: LauncherUpdaterForcer;
  }
}

// Cycle starts on a visible state so the first keypress does something.
const STATES: readonly UpdaterStatus[] = [
  'checking',
  'available',
  'downloading',
  'ready',
  'up-to-date',
  'error',
  'idle',
];

let previewTimer: ReturnType<typeof setInterval> | null = null;
// A forced "checking" state resolves itself so the preview cannot leave the UI
// stranded on a spinner - the same guarantee a real check gets from its timeout.
const CHECKING_PREVIEW_MS = 2500;
let resolvePreviewTimer: ReturnType<typeof setTimeout> | null = null;

function stopPreview(): void {
  if (previewTimer !== null) {
    clearInterval(previewTimer);
    previewTimer = null;
  }
  if (resolvePreviewTimer !== null) {
    clearTimeout(resolvePreviewTimer);
    resolvePreviewTimer = null;
  }
}

export function forceUpdaterState(status: UpdaterStatus): void {
  stopPreview();

  switch (status) {
    case 'checking':
      useUpdaterStore.setState({
        status,
        version: null,
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
        dismissed: false,
      });
      resolvePreviewTimer = setTimeout(() => {
        resolvePreviewTimer = null;
        forceUpdaterState('available');
      }, CHECKING_PREVIEW_MS);
      break;
    case 'available':
      useUpdaterStore.setState({
        status,
        version: PREVIEW_VERSION,
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
        dismissed: false,
      });
      break;
    case 'downloading': {
      useUpdaterStore.setState({
        status,
        version: PREVIEW_VERSION,
        downloadedBytes: 0,
        totalBytes: PREVIEW_TOTAL_BYTES,
        error: null,
        dismissed: false,
      });
      let step = 0;
      previewTimer = setInterval(() => {
        step += 1;
        useUpdaterStore.setState({
          downloadedBytes: Math.round((PREVIEW_TOTAL_BYTES * step) / PREVIEW_STEPS),
        });
        if (step >= PREVIEW_STEPS) stopPreview();
      }, PREVIEW_STEP_MS);
      break;
    }
    case 'ready':
      useUpdaterStore.setState({
        status,
        version: PREVIEW_VERSION,
        downloadedBytes: PREVIEW_TOTAL_BYTES,
        totalBytes: PREVIEW_TOTAL_BYTES,
        error: null,
        dismissed: false,
      });
      break;
    case 'error':
      useUpdaterStore.setState({
        status,
        version: null,
        downloadedBytes: 0,
        totalBytes: null,
        error: 'Simulated update-check failure (dev only)',
        dismissed: false,
      });
      break;
    default:
      // 'idle' | 'checking' | 'up-to-date' carry no version or progress.
      useUpdaterStore.setState({
        status,
        version: null,
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
        dismissed: false,
      });
  }
}

let cycleIndex = -1;

export function cycleUpdaterState(): void {
  cycleIndex = (cycleIndex + 1) % STATES.length;
  // cycleIndex was just reduced modulo STATES.length, so this cannot be missing.
  forceUpdaterState(STATES[cycleIndex] as UpdaterStatus);
}

function handleShortcut(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'u') {
    event.preventDefault();
    cycleUpdaterState();
  }
}

export function installDevUpdaterForcer(): void {
  window.__launcherUpdater = {
    force: forceUpdaterState,
    cycle: cycleUpdaterState,
    states: STATES,
  };
  window.addEventListener('keydown', handleShortcut);
}
