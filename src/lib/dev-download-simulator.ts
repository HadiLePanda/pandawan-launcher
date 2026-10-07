import { useLauncherStore } from './store';
import type { DownloadProgressSnapshot } from './download-channel';

/**
 * Dev-only fake download, for looking at the install flow.
 *
 * It exists because the download UI is nearly impossible to inspect honestly any
 * other way: a real install of a real build is 442 MB and deletes a folder to do
 * it, and a unit test cannot show you the bar easing, the ETA counting down or
 * the filename ticking over. This drives the exact same store fields the real
 * flow writes, so what you see is the real component reading the real snapshot
 * shape, not a mock of it.
 *
 * It is loaded through a dynamic import inside an `import.meta.env.DEV` branch
 * in main.tsx. That branch is statically false in a release build, so Rollup
 * drops it and never emits this module: a shipping launcher cannot contain code
 * that fakes a download. Same guarantee as dev-updater-forcer.
 *
 * Everything here writes store fields only. It never calls installGame or
 * gameService.patchGame, so forcing a download cannot touch the disk or spend
 * the user's bandwidth.
 */

declare global {
  interface Window {
    __launcherDownload?: LauncherDownloadSimulator;
  }
}

export interface LauncherDownloadSimulator {
  /** Start a fake install of `gameId`, playing through to completion. */
  play: (gameId: string) => void;
  /** Start and leave it hanging at `stopAt`, for looking at a stalled bar. */
  stall: (gameId: string, stopAt?: number) => void;
  /** Stop the simulation and remove the row. */
  stop: () => void;
}

/** Mirrors the real example-game alpha build's shape: 267 files, ~442 MB. */
const PREVIEW_TOTAL_BYTES = 442_012_495;
const PREVIEW_TOTAL_FILES = 267;
const PREVIEW_GAME_ID = 'example-game';

// Real names from the published manifest, so the row looks like the real thing
// rather than "file1.bin". A Unity build is mostly data files, which is exactly
// the boring-looking case worth checking.
const PREVIEW_FILES = [
  'Example Game.exe',
  'UnityPlayer.dll',
  'D3D12/D3D12Core.dll',
  'Example Game_Data/globalgamemanagers',
  'Example Game_Data/level0',
  'Example Game_Data/boot.config',
  'Example Game_Data/il2cpp_data/Metadata/global-metadata.dat',
  'MonoBleedingEdge/bin/mono-sgen.exe',
  'resources.assets',
] as const;

// ~14s end to end. Long enough to read the width easing, the ETA falling and
// the filename changing; short enough to not feel broken. The real thing is
// minutes, and the point is to look at the UI, not to be timed by it.
const STEP_MS = 80;
const PREVIEW_STEPS = 175;

// Average throughput across the sample window, in MB/s, used to render a
// plausible speed. Derived from the total and duration so it cannot drift out of
// step with the bar if one of them is changed.
const PREVIEW_SPEED_BPS = PREVIEW_TOTAL_BYTES / ((PREVIEW_STEPS * STEP_MS) / 1000);

let timer: ReturnType<typeof setInterval> | null = null;
let activeGameId: string | null = null;

function clearTimer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function fileAt(step: number): string {
  return PREVIEW_FILES[Math.floor((step / PREVIEW_STEPS) * PREVIEW_FILES.length)] ?? 'example-game.exe';
}

function snapshotAt(step: number, totalBytes: number): DownloadProgressSnapshot {
  const overallProgress = (step / PREVIEW_STEPS) * 100;

  return {
    progress: overallProgress,
    overallProgress,
    // Empty on the opening snapshot, because the real backend's first event is
    // `Started` and carries no rate: the bar is created before anything has been
    // measured, so claiming a speed there would be a number with no history.
    speed: step === 0 ? '' : `${(PREVIEW_SPEED_BPS / 1_000_000).toFixed(1)} MB/s`,
    currentFile: fileAt(step),
    completedFiles: Math.floor((step / PREVIEW_STEPS) * PREVIEW_TOTAL_FILES),
    totalFiles: PREVIEW_TOTAL_FILES,
    downloadedBytes: Math.round((overallProgress / 100) * totalBytes),
    totalBytes,
  };
}

function push(snapshot: DownloadProgressSnapshot): void {
  const { setDownloadProgress } = useLauncherStore.getState();
  setDownloadProgress(activeGameId ?? PREVIEW_GAME_ID, snapshot);
}

/** Run the bar to `stopAt` percent, then stop driving it. */
function run(stopAt: number, autoComplete: boolean): void {
  clearTimer();
  activeGameId = activeGameId ?? PREVIEW_GAME_ID;

  // Mark the card as downloading, exactly as runPatchFlow does before it calls
  // patchGame. The GamePage progress bar and the card's own state both read
  // this, so leaving it out would show a moving bar on a card that says
  // "not installed".
  useLauncherStore.getState().updateGameStatus(activeGameId, 'downloading');

  // Pushed before the timer starts, so the row exists the instant the preview
  // is triggered. The real backend's first event arrives over IPC asynchronously
  // too, but a keypress that shows nothing until the next tick reads as a dead
  // shortcut.
  push(snapshotAt(0, PREVIEW_TOTAL_BYTES));

  let step = 0;
  timer = setInterval(() => {
    step += 1;
    const percent = (step / PREVIEW_STEPS) * 100;

    push(snapshotAt(step, PREVIEW_TOTAL_BYTES));

    if (percent >= stopAt) {
      if (autoComplete) {
        finish();
      } else {
        clearTimer();
      }
      return;
    }
  }, STEP_MS);
}

/**
 * Land the flow the way a real install does: row removed, card set to installed,
 * notification queued. Deliberately the same shape runPatchFlow produces, so
 * this is a preview of the real end state rather than a nicer-looking one.
 */
function finish(): void {
  clearTimer();
  const gameId = activeGameId ?? PREVIEW_GAME_ID;
  const { removeDownload, updateGameStatus } = useLauncherStore.getState();

  updateGameStatus(gameId, 'installed');
  removeDownload(gameId);
  activeGameId = null;
}

export function playFakeDownload(gameId: string = PREVIEW_GAME_ID): void {
  activeGameId = gameId;
  run(100, true);
}

export function stallFakeDownload(gameId: string = PREVIEW_GAME_ID, stopAt = 63): void {
  activeGameId = gameId;
  run(stopAt, false);
}

export function stopFakeDownload(): void {
  clearTimer();
  const gameId = activeGameId ?? PREVIEW_GAME_ID;
  const { removeDownload, updateGameStatus } = useLauncherStore.getState();
  // Back to not_installed rather than leaving a card stuck on "downloading"
  // forever: a preview that leaves the app in a broken state is worse than one
  // that resets cleanly.
  const game = useLauncherStore.getState().games.find((g) => g.info.id === gameId);
  updateGameStatus(gameId, game?.installation ? 'installed' : 'not_installed');
  removeDownload(gameId);
  activeGameId = null;
}

function handleShortcut(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
  // Rejects Alt too: Ctrl+Alt+Shift+D is the Windows "next DWM desktop" chord,
  // so accepting it here would hijack a real OS shortcut whenever the launcher
  // has focus.
  if (event.altKey) return;
  if (event.key.toLowerCase() !== 'd') return;

  event.preventDefault();
  // No game chosen by hand: previewing the example-game build is the case worth
  // looking at, and the row falls back to the id if the catalog is empty.
  playFakeDownload(PREVIEW_GAME_ID);
}

export function installDevDownloadSimulator(): void {
  window.__launcherDownload = {
    play: playFakeDownload,
    stall: stallFakeDownload,
    stop: stopFakeDownload,
  };
  window.addEventListener('keydown', handleShortcut);
}
