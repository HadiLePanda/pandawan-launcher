import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  exists,
  mkdir,
  remove,
  rename,
  stat,
  writeTextFile,
  BaseDirectory,
} from '@tauri-apps/plugin-fs';

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppLog: 26 },
  exists: vi.fn(),
  mkdir: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  stat: vi.fn(),
  writeTextFile: vi.fn(),
}));

const LOG_OPTIONS = { baseDir: BaseDirectory.AppLog };
const ONE_MB = 1024 * 1024;

function makeEntry(message = 'hello') {
  return { level: 'info' as const, message, timestamp: '2026-08-04T00:00:00.000Z' };
}

describe('logger file sink', () => {
  let loggerModule: typeof import('./logger');

  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    (exists as Mock).mockResolvedValue(false);
    (mkdir as Mock).mockResolvedValue(undefined);
    (remove as Mock).mockResolvedValue(undefined);
    (rename as Mock).mockResolvedValue(undefined);
    (stat as Mock).mockResolvedValue({ size: 0 });
    (writeTextFile as Mock).mockResolvedValue(undefined);
    loggerModule = await import('./logger');
  });

  it('appends entries as single-line JSON in the app log dir', async () => {
    await loggerModule.appendEntryToLogFile(makeEntry());

    expect(writeTextFile).toHaveBeenCalledWith('launcher.log', `${JSON.stringify(makeEntry())}\n`, {
      ...LOG_OPTIONS,
      append: true,
    });
    expect(rename).not.toHaveBeenCalled();
  });

  it('ensures the log directory once', async () => {
    await loggerModule.appendEntryToLogFile(makeEntry());
    await loggerModule.appendEntryToLogFile(makeEntry());

    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(mkdir).toHaveBeenCalledWith('.', { ...LOG_OPTIONS, recursive: true });
  });

  it('rotates to a single previous generation when the log exceeds 1 MB', async () => {
    (exists as Mock).mockImplementation(async (path: string) => path === 'launcher.log');
    (stat as Mock).mockResolvedValue({ size: ONE_MB + 1 });

    await loggerModule.appendEntryToLogFile(makeEntry());

    expect(rename).toHaveBeenCalledWith('launcher.log', 'launcher.prev.log', {
      oldPathBaseDir: BaseDirectory.AppLog,
      newPathBaseDir: BaseDirectory.AppLog,
    });
    expect(remove).not.toHaveBeenCalled();
    expect(writeTextFile).toHaveBeenCalledWith('launcher.log', expect.any(String), {
      ...LOG_OPTIONS,
      append: true,
    });
  });

  it('removes the previous generation before rotating over it', async () => {
    (exists as Mock).mockResolvedValue(true);
    (stat as Mock).mockResolvedValue({ size: 2 * ONE_MB });

    await loggerModule.appendEntryToLogFile(makeEntry());

    expect(remove).toHaveBeenCalledWith('launcher.prev.log', LOG_OPTIONS);
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it('does not rotate at or below the 1 MB threshold', async () => {
    (exists as Mock).mockResolvedValue(true);
    (stat as Mock).mockResolvedValue({ size: ONE_MB });

    await loggerModule.appendEntryToLogFile(makeEntry());

    expect(rename).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('keeps the console sink unchanged and enqueues a file write', async () => {
    const messages: string[] = [];
    loggerModule.setLogSink((entry) => messages.push(entry.message));

    loggerModule.logger.info('queued line', { detail: 1 });

    expect(messages).toEqual(['queued line']);
    await vi.waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(1));
    const line = (writeTextFile as Mock).mock.calls[0][1] as string;
    expect(JSON.parse(line)).toMatchObject({
      level: 'info',
      message: 'queued line',
      context: { detail: 1 },
    });
  });

  it('swallows file write failures without breaking logging', async () => {
    const messages: string[] = [];
    loggerModule.setLogSink((entry) => messages.push(entry.message));
    (mkdir as Mock).mockRejectedValue(new Error('fs unavailable'));

    loggerModule.logger.info('still logged');
    loggerModule.logger.warn('and again');

    expect(messages).toEqual(['still logged', 'and again']);
    // let the queue settle; no unhandled rejection should escape
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
