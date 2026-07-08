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

describe('createDownloadChannel', () => {
  it('maps totalFiles from progress events', () => {
    const onProgress = vi.fn();
    const onComplete = vi.fn();

    createDownloadChannel('game-1', { onProgress, onComplete });

    const channel = mockChannelInstances[mockChannelInstances.length - 1];
    expect(channel.onmessage).toBeTypeOf('function');

    channel.onmessage!({
      event: 'progress',
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

    expect(onProgress).toHaveBeenCalledWith(
      'game-1',
      expect.objectContaining({ totalFiles: 5 })
    );
  });
});
