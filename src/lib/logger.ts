import {
  exists,
  mkdir,
  remove,
  rename,
  stat,
  writeTextFile,
  BaseDirectory,
} from '@tauri-apps/plugin-fs';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

type LogSink = (entry: LogEntry) => void;

const defaultSink: LogSink = (entry) => {
  const { level, message, context } = entry;
  if (context && Object.keys(context).length > 0) {
    console[level](message, context);
  } else {
    console[level](message);
  }
};

let sink: LogSink = defaultSink;

export function setLogSink(newSink: LogSink): void {
  sink = newSink;
}

const LOG_FILE_NAME = 'launcher.log';
const PREVIOUS_LOG_FILE_NAME = 'launcher.prev.log';
const MAX_LOG_FILE_BYTES = 1024 * 1024;

const logFileOptions = { baseDir: BaseDirectory.AppLog } as const;

let logDirEnsured = false;
let fileWriteQueue: Promise<void> = Promise.resolve();

/**
 * Appends one entry as a single JSON line to `launcher.log` in the app log
 * directory, rotating the file to `launcher.prev.log` first when it exceeds
 * ~1 MB (single previous generation, overwritten each rotation).
 * Exported for tests; app code should go through `logger`.
 */
export async function appendEntryToLogFile(entry: LogEntry): Promise<void> {
  if (!logDirEnsured) {
    await mkdir('.', { ...logFileOptions, recursive: true });
    logDirEnsured = true;
  }

  if (await exists(LOG_FILE_NAME, logFileOptions)) {
    const info = await stat(LOG_FILE_NAME, logFileOptions);
    if (info.size > MAX_LOG_FILE_BYTES) {
      // plugin-fs rename maps to std::fs::rename, which fails on Windows when
      // the destination exists, so the previous generation is removed first.
      if (await exists(PREVIOUS_LOG_FILE_NAME, logFileOptions)) {
        await remove(PREVIOUS_LOG_FILE_NAME, logFileOptions);
      }
      await rename(LOG_FILE_NAME, PREVIOUS_LOG_FILE_NAME, {
        oldPathBaseDir: logFileOptions.baseDir,
        newPathBaseDir: logFileOptions.baseDir,
      });
    }
  }

  await writeTextFile(LOG_FILE_NAME, `${JSON.stringify(entry)}\n`, {
    ...logFileOptions,
    append: true,
  });
}

// File writes are fire-and-forget: queued to avoid interleaved appends, and
// failures are swallowed so logging can never break the app.
function enqueueFileWrite(entry: LogEntry): void {
  fileWriteQueue = fileWriteQueue.then(() => appendEntryToLogFile(entry)).catch(() => {});
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    message,
    context,
    timestamp: new Date().toISOString(),
  };
  sink(entry);
  enqueueFileWrite(entry);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => log('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => log('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => log('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => log('error', message, context),
};
