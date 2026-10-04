import { describe, it, expect, vi } from 'vitest';
import { createDownloadChannel } from './download-channel';

const mockChannelInstances: Array<{ onmessage: ((message: unknown) => void) | null }> = [];

vi.mock('@tauri-apps/api/core', () => ({
  Channel: vi.fn(function (this: unknown) {
    const instance = { onmessage: null as ((message: unknown) => void) | null };
    mockChannelInstances.push(instance);
    return instance;
  }),
}));

function lastChannel() {
  // Every caller has just created a channel, so the array cannot be empty here.
  return mockChannelInstances.at(-1)!;
}

/**
 * The exact event stream `DownloadManager::download_files` pushes to the
 * Channel for a two-file install: a small file that finishes inside the 500ms
 * progress throttle and emits only Started/FileComplete, and a large one that
 * also emits Progress. Tags and field names are verbatim from the serde output
 * of `DownloadEvent` (src-tauri/src/types.rs); see the wire-contract test there.
 */
const INSTALL_EVENTS = [
  {
    event: 'Started',
    data: {
      filePath: 'game.exe',
      totalSize: 2_000,
      fileIndex: 0,
      totalFiles: 2,
      overallDownloaded: 0,
      overallTotal: 1_002_000,
    },
  },
  {
    event: 'FileComplete',
    data: {
      filePath: 'game.exe',
      completedFiles: 1,
      totalFiles: 2,
      overallDownloaded: 2_000,
      overallTotal: 1_002_000,
    },
  },
  {
    event: 'Started',
    data: {
      filePath: 'assets/data.pak',
      totalSize: 1_000_000,
      fileIndex: 1,
      totalFiles: 2,
      overallDownloaded: 2_000,
      overallTotal: 1_002_000,
    },
  },
  {
    event: 'Progress',
    data: {
      filePath: 'assets/data.pak',
      downloaded: 500_000,
      total: 1_000_000,
      speedBps: 5_242_880,
      overallDownloaded: 502_000,
      overallTotal: 1_002_000,
      completedFiles: 1,
      totalFiles: 2,
      currentFile: 'assets/data.pak',
    },
  },
  {
    event: 'FileComplete',
    data: {
      filePath: 'assets/data.pak',
      completedFiles: 2,
      totalFiles: 2,
      overallDownloaded: 1_002_000,
      overallTotal: 1_002_000,
    },
  },
  { event: 'Complete', data: { completedFiles: 2, totalFiles: 2 } },
];

describe('createDownloadChannel', () => {
  it('maps totalFiles from progress events', () => {
    const onProgress = vi.fn();
    const onComplete = vi.fn();

    createDownloadChannel('game-1', { onProgress, onComplete });

    const channel = lastChannel();
    expect(channel.onmessage).toBeTypeOf('function');

    channel.onmessage!({
      event: 'Progress',
      data: {
        filePath: '/tmp/file.bin',
        downloaded: 50,
        total: 100,
        speedBps: 1_048_576,
        overallDownloaded: 50,
        overallTotal: 100,
        completedFiles: 1,
        currentFile: '/tmp/file.bin',
        totalFiles: 5,
      },
    });

    expect(onProgress).toHaveBeenCalledWith('game-1', expect.objectContaining({ totalFiles: 5 }));
  });

  it('drives the bar from the exact event sequence an install emits', () => {
    const onProgress = vi.fn();
    const onComplete = vi.fn();

    createDownloadChannel('game-1', { onProgress, onComplete });

    const channel = lastChannel();
    for (const event of INSTALL_EVENTS) channel.onmessage!(event);

    // Every Started/Progress/FileComplete must produce a snapshot, and the
    // Complete must finish the download. If the handler keys on the wrong tag
    // values none of these fire and the store map stays empty, which is the
    // reported "no progress" on the game details page.
    expect(onProgress).toHaveBeenCalledTimes(5);
    expect(onComplete).toHaveBeenCalledTimes(1);

    const snapshots = onProgress.mock.calls.map((call) => call[1]);

    // The small file's FileComplete must already have moved the bar off zero,
    // even though that file never emitted a Progress event of its own.
    expect(snapshots[1].overallProgress).toBeGreaterThan(0);
    expect(snapshots[1].downloadedBytes).toBe(2_000);
    expect(snapshots[1].totalBytes).toBe(1_002_000);

    // The large file's Progress lands roughly halfway.
    expect(snapshots[3].overallProgress).toBeCloseTo(50.1, 1);

    // The final FileComplete is the whole build, so the bar reaches 100.
    expect(snapshots[4].overallProgress).toBe(100);
  });

  it('reports the snapshot under the same id the store writes and App reads', () => {
    const onProgress = vi.fn();

    createDownloadChannel('pandawan-td', { onProgress, onComplete: vi.fn() });

    lastChannel().onmessage!(INSTALL_EVENTS[0]!);

    // App.tsx reads activeDownloads.get(selectedGame.info.id); the install was
    // started for that same catalog id, so the write key and the read key match.
    expect(onProgress).toHaveBeenCalledWith(
      'pandawan-td',
      expect.objectContaining({ currentFile: 'game.exe' })
    );
  });

  it('does not reset the bar to 0 on a started event', () => {
    const onProgress = vi.fn();

    createDownloadChannel('game-1', { onProgress, onComplete: vi.fn() });
    const channel = lastChannel();

    channel.onmessage!({
      event: 'Progress',
      data: {
        filePath: 'a.pak',
        downloaded: 500,
        total: 1_000,
        speedBps: 0,
        overallDownloaded: 500,
        overallTotal: 1_000,
        completedFiles: 0,
        totalFiles: 2,
        currentFile: 'a.pak',
      },
    });
    // A new file starting must carry the running total forward, not zero it.
    channel.onmessage!({
      event: 'Started',
      data: {
        filePath: 'b.pak',
        totalSize: 500,
        fileIndex: 1,
        totalFiles: 2,
        overallDownloaded: 500,
        overallTotal: 1_000,
      },
    });

    const last = onProgress.mock.calls.at(-1)![1];
    expect(last.overallProgress).toBe(50);
  });

  it('does not jump the bar to 100 when a single file finishes', () => {
    const onProgress = vi.fn();

    createDownloadChannel('game-1', { onProgress, onComplete: vi.fn() });

    lastChannel().onmessage!({
      event: 'FileComplete',
      data: {
        filePath: 'a.pak',
        completedFiles: 1,
        totalFiles: 3,
        overallDownloaded: 1_000,
        overallTotal: 3_000,
      },
    });

    const last = onProgress.mock.calls.at(-1)![1];
    expect(last.overallProgress).toBeCloseTo(33.3, 1);
  });
});
