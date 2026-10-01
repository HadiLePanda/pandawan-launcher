import { Channel } from '@tauri-apps/api/core';
import type { DownloadEvent } from '@/types';
import { logger } from './logger';

export interface DownloadProgressSnapshot {
  /** This file's progress, 0-100. */
  progress: number;
  /** Whole game's progress, 0-100, from real byte counts. */
  overallProgress: number;
  /** Human-readable rate, e.g. "12.4 MB/s". */
  speed: string;
  currentFile: string | null;
  completedFiles: number;
  totalFiles: number;
  /** Bytes moved so far, across every file. Drives "x of y". */
  downloadedBytes: number;
  /** Total bytes for the whole build. */
  totalBytes: number;
}

export type DownloadProgressHandler = (gameId: string, snapshot: DownloadProgressSnapshot) => void;
export type DownloadCompleteHandler = (gameId: string) => void;

export function createDownloadChannel(
  gameId: string,
  handlers: {
    onProgress: DownloadProgressHandler;
    onComplete: DownloadCompleteHandler;
    onError?: (message: string) => void;
  }
) {
  const channel = new Channel<DownloadEvent>();

  // Totals for the whole build, learned from whichever event carries them.
  // A Unity build is a few hundred files and most are a few KB, so the backend
  // only emits `progress` for files long enough to hit its 500ms throttle. The
  // per-file `started`/`fileComplete` pair still arrives for all of them, so
  // these are what keep the bar honest between the sparse updates.
  let totalBytes = 0;
  let downloadedBytes = 0;

  channel.onmessage = (message) => {
    switch (message.event) {
      case 'started': {
        if (message.data.overallTotal) totalBytes = message.data.overallTotal;
        else if (totalBytes === 0) totalBytes = message.data.totalSize;
        if (message.data.overallDownloaded !== undefined) {
          downloadedBytes = message.data.overallDownloaded ?? 0;
        }
        handlers.onProgress(gameId, {
          progress: 0,
          // NOT zero. Resetting to 0 here was what froze the bar: it fired once
          // per file, so 267 starts slammed it back to the beginning while only
          // a handful of large files ever pushed it forward.
          overallProgress: totalBytes ? Math.min(100, (downloadedBytes / totalBytes) * 100) : 0,
          speed: '',
          currentFile: message.data.filePath,
          completedFiles: message.data.fileIndex,
          totalFiles: message.data.totalFiles,
          downloadedBytes,
          totalBytes,
        });
        break;
      }
      case 'progress': {
        const currentTotal = message.data.total || totalBytes || 1;
        downloadedBytes = message.data.overallDownloaded ?? message.data.downloaded;
        const overallTotal = message.data.overallTotal || totalBytes || currentTotal;
        totalBytes = overallTotal;
        handlers.onProgress(gameId, {
          progress: (message.data.downloaded / currentTotal) * 100,
          overallProgress: overallTotal > 0 ? (downloadedBytes / overallTotal) * 100 : 0,
          speed: formatSpeed(message.data.speedBps),
          currentFile: message.data.currentFile || message.data.filePath,
          completedFiles: message.data.completedFiles ?? 0,
          totalFiles: message.data.totalFiles ?? 0,
          downloadedBytes,
          totalBytes: overallTotal,
        });
        break;
      }
      case 'fileComplete': {
        // Also NOT 100. One file finishing is not the whole build; claiming so
        // made the bar jump to the end and sit there.
        if (message.data.overallTotal) totalBytes = message.data.overallTotal;
        if (message.data.overallDownloaded !== undefined) {
          downloadedBytes = message.data.overallDownloaded ?? 0;
        }
        handlers.onProgress(gameId, {
          progress: 100,
          overallProgress: totalBytes ? Math.min(100, (downloadedBytes / totalBytes) * 100) : 0,
          speed: '',
          currentFile: message.data.filePath,
          completedFiles: message.data.completedFiles ?? 0,
          totalFiles: message.data.totalFiles ?? 0,
          downloadedBytes,
          totalBytes,
        });
        break;
      }
      case 'complete': {
        handlers.onComplete(gameId);
        break;
      }
      case 'error': {
        handlers.onError?.(message.data.message);
        break;
      }
      case 'retry': {
        logger.warn('Download retry', {
          attempt: message.data.attempt,
          maxAttempts: message.data.maxAttempts,
          filePath: message.data.filePath,
          error: message.data.error,
        });
        break;
      }
    }
  };

  return channel;
}

/** Bytes per second as a short human string. Sub-megabyte rates read better in KB/s. */
export function formatSpeed(bytesPerSecond: number): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return '';
  const mb = bytesPerSecond / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
}
