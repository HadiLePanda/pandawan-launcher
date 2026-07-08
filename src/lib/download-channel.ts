import { Channel } from '@tauri-apps/api/core';
import type { DownloadEvent } from '@/types';
import { logger } from './logger';

export interface DownloadProgressSnapshot {
  progress: number;
  overallProgress: number;
  speed: string;
  currentFile: string | null;
  completedFiles: number;
  totalFiles: number;
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
  let totalBytes = 0;
  let downloadedBytes = 0;

  channel.onmessage = (message) => {
    switch (message.event) {
      case 'started': {
        totalBytes = message.data.totalSize;
        handlers.onProgress(gameId, {
          progress: 0,
          overallProgress: 0,
          speed: '',
          currentFile: message.data.filePath,
          completedFiles: message.data.fileIndex,
          totalFiles: message.data.totalFiles,
        });
        break;
      }
      case 'progress': {
        downloadedBytes = message.data.downloaded;
        const currentTotal = message.data.total || totalBytes || 1;
        const overallDownloaded = message.data.overallDownloaded ?? downloadedBytes;
        const overallTotal = message.data.overallTotal ?? currentTotal;
        handlers.onProgress(gameId, {
          progress: (downloadedBytes / currentTotal) * 100,
          overallProgress: overallTotal > 0 ? (overallDownloaded / overallTotal) * 100 : 0,
          speed: `${(message.data.speedBps / 1024 / 1024).toFixed(1)} MB/s`,
          currentFile: message.data.currentFile || message.data.filePath,
          completedFiles: message.data.completedFiles ?? 0,
          totalFiles: message.data.totalFiles ?? 0,
        });
        break;
      }
      case 'fileComplete': {
        handlers.onProgress(gameId, {
          progress: 100,
          overallProgress: 100,
          speed: '',
          currentFile: message.data.filePath,
          completedFiles: message.data.completedFiles ?? 0,
          totalFiles: message.data.totalFiles ?? 0,
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
