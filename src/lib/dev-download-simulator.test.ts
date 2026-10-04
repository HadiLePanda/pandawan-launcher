// The default environment is node (vite.config.ts) and this project ships no
// DOM environment - jsdom/happy-dom are not dependencies - so the window object
// and its listener are stubbed here rather than pulling one in for two cases.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLauncherStore } from './store';
import {
  playFakeDownload,
  stallFakeDownload,
  stopFakeDownload,
  installDevDownloadSimulator,
} from './dev-download-simulator';
import type { Game, GameInfo } from '@/types';

// The simulator writes store fields and nothing else, so the real store is
// what it is tested against - a mocked store would prove only that the mock was
// called. It is imported statically here purely because a test runs in dev
// mode; the shipping exclusion is asserted separately below.
vi.mock('./notifications', () => ({
  notifyInstallComplete: vi.fn(),
  notifyUpdateAvailable: vi.fn(),
  notifyUpdateComplete: vi.fn(),
}));

vi.mock('./commands', () => ({
  commands: {
    getInstalledGames: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
    fetchRemoteText: vi.fn(),
  },
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  BaseDirectory: { AppData: 'AppData' },
}));

const info: GameInfo = {
  id: 'misspell',
  channel: 'alpha',
  name: 'Misspell',
  description: '',
  developer: 'Pandawan Corp',
  genre: [],
  iconUrl: '',
  bannerUrl: '',
  screenshots: [],
  version: '0.4.0-alpha.1',
  sizeBytes: 442_012_495,
  isAvailableOnThisPlatform: true,
  releaseDate: '2026-09-30T00:00:00Z',
};

const game: Game = {
  info,
  installation: null,
  status: 'not_installed',
  hasUpdate: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  useLauncherStore.setState({ games: [game], activeDownloads: new Map(), error: null });
});

afterEach(() => {
  stopFakeDownload();
  vi.useRealTimers();
});

describe('dev download simulator', () => {
  it('drives the progress bar the real flow writes, from empty to complete', () => {
    playFakeDownload('misspell');

    // The card must read as downloading, or the row shows a moving bar on a
    // game the launcher still calls not installed.
    expect(useLauncherStore.getState().games[0]?.status).toBe('downloading');

    const first = useLauncherStore.getState().activeDownloads.get('misspell');
    expect(first).toBeDefined();
    expect(first?.totalBytes).toBe(442_012_495);
    expect(first?.totalFiles).toBe(267);
    expect(first?.downloadedBytes).toBe(0);
    expect(first?.currentFile).toBeTruthy();
    // The opening snapshot has no measured rate, matching the real `Started`
    // event. A speed shown there would be a number with no history behind it.
    expect(first?.speed).toBe('');

    vi.advanceTimersByTime(80);
    const second = useLauncherStore.getState().activeDownloads.get('misspell');
    expect(second?.downloadedBytes).toBeGreaterThan(0);
    expect(second?.overallProgress).toBeGreaterThan(0);
    expect(second?.speed).toMatch(/MB\/s/);
    // The bar must only ever move forward, never jump back to 0: that was the
    // freeze where 267 Started events slammed it back to the beginning.
    expect(second?.overallProgress).toBeGreaterThanOrEqual(first?.overallProgress ?? 0);
  });

  it('lands the same end state a real install does', () => {
    playFakeDownload('misspell');
    vi.advanceTimersByTime(80 * 200);

    const state = useLauncherStore.getState();
    // A real install removes the row and marks the game installed.
    expect(state.activeDownloads.has('misspell')).toBe(false);
    expect(state.games[0]?.status).toBe('installed');
  });

  it('stalls on request and can be cleared, leaving no card stuck downloading', () => {
    stallFakeDownload('misspell', 40);
    vi.advanceTimersByTime(80 * 200);

    const stalled = useLauncherStore.getState().activeDownloads.get('misspell');
    expect(stalled?.overallProgress).toBeCloseTo(40, 0);
    expect(useLauncherStore.getState().games[0]?.status).toBe('downloading');

    stopFakeDownload();

    const state = useLauncherStore.getState();
    expect(state.activeDownloads.has('misspell')).toBe(false);
    // Left on 'downloading' the card would be a lie until restart.
    expect(state.games[0]?.status).toBe('not_installed');
  });

  it('is not reachable from a shipping build', async () => {
    // The guarantee that matters: `import.meta.env.DEV` is statically false in
    // a release build, so Rollup drops the branch and never emits the chunk. A
    // launcher able to fake a download is a security problem, not dead weight.
    const { readFileSync } = await import('node:fs');
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');

    const guarded = /if\s*\(import\.meta\.env\.DEV\)\s*\{[^}]*dev-download-simulator/.test(main);
    expect(guarded).toBe(true);
  });
});

describe('dev download shortcut', () => {
  /** Minimal stand-in: the module only reads `window` for these two things. */
  function stubWindow() {
    const listeners: ((event: KeyboardEvent) => void)[] = [];
    const fake = {
      addEventListener: (type: string, fn: (event: KeyboardEvent) => void) => {
        if (type === 'keydown') listeners.push(fn);
      },
    };
    vi.stubGlobal('window', fake);
    return {
      fake,
      press: (init: KeyboardEventInit) => {
        const event = { ...init, preventDefault: () => {}, key: init.key ?? '' } as KeyboardEvent;
        listeners.forEach((fn) => fn(event));
      },
      count: () => listeners.length,
    };
  }

  it('binds ctrl+shift+d and exposes the controls on window', () => {
    const w = stubWindow();
    installDevDownloadSimulator();

    expect(w.count()).toBe(1);
    expect(window.__launcherDownload).toBeDefined();
    expect(typeof window.__launcherDownload?.play).toBe('function');
    expect(typeof window.__launcherDownload?.stall).toBe('function');
    expect(typeof window.__launcherDownload?.stop).toBe('function');
  });

  it('starts a preview on ctrl+shift+d and ignores the key without shift', () => {
    const w = stubWindow();
    installDevDownloadSimulator();

    w.press({ key: 'd', ctrlKey: true, shiftKey: true });
    expect(useLauncherStore.getState().activeDownloads.has('misspell')).toBe(true);

    stopFakeDownload();

    w.press({ key: 'd', ctrlKey: true });
    w.press({ key: 'd', metaKey: true, shiftKey: true, altKey: true });
    expect(useLauncherStore.getState().activeDownloads.has('misspell')).toBe(false);
  });
});
