import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { processStartedAt, reapManifest } from './service-reaper.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const watchdog = path.join(here, '..', 'dashboard-watchdog.mjs');

// The reaper is Windows-only: it reads a process start time through PowerShell's
// Get-Process and kills a tree with taskkill, neither of which exists on the
// Linux CI runner. A run there can only fail - and its waits can stall the file
// so it never reports at all. The launcher's real coverage is the rust-windows
// job's platform, and this skips off Windows the same way.
const onWindows = process.platform === 'win32';

/** A stand-in for a dev service: alive until something kills it. */
const spawnDummy = () =>
  spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitFor = async (predicate: () => boolean, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return predicate();
};

const running: ChildProcess[] = [];
const dummy = () => {
  const child = spawnDummy();
  running.push(child);
  return child;
};

const manifestPath = () => path.join(mkdtempSync(path.join(tmpdir(), 'reaper-')), 'services.json');

const record = (manifest: string, pid: number, startedAt: string | null) => {
  writeFileSync(manifest, JSON.stringify([{ pid, startedAt, id: 'test' }]));
};

afterEach(() => {
  for (const child of running.splice(0)) child.kill('SIGKILL');
});

describe.skipIf(!onWindows)('reaping what a previous run recorded', () => {
  it('kills a recorded tree and empties the manifest', async () => {
    const child = dummy();
    const manifest = manifestPath();
    record(manifest, child.pid!, processStartedAt(child.pid!));

    expect(reapManifest(manifest)).toBe(1);
    expect(await waitFor(() => !alive(child.pid!), 5000)).toBe(true);
    expect(JSON.parse(readFileSync(manifest, 'utf8'))).toEqual([]);
  }, 20000);

  it('leaves a pid alone when the recorded start time does not match', async () => {
    // A recycled pid is the whole reason the start time is stored: killing on the
    // number alone would kill an unrelated program that inherited it.
    const child = dummy();
    const manifest = manifestPath();
    record(manifest, child.pid!, '1999-01-01T00:00:00.0000000Z');

    expect(reapManifest(manifest)).toBe(0);
    expect(alive(child.pid!)).toBe(true);
  }, 20000);

  it('survives a recorded pid that is already gone', async () => {
    const child = dummy();
    const pid = child.pid!;
    const startedAt = processStartedAt(pid);
    child.kill('SIGKILL');
    await waitFor(() => !alive(pid), 5000);

    const manifest = manifestPath();
    record(manifest, pid, startedAt);

    expect(reapManifest(manifest)).toBe(0);
  }, 30000);

  it('does nothing when there is no manifest yet', () => {
    expect(reapManifest(path.join(tmpdir(), 'reaper-absent', 'services.json'))).toBe(0);
  });
});

describe.skipIf(!onWindows)('the watchdog', () => {
  it('kills the recorded tree when the parent it outlives goes away', async () => {
    // The parent here is this test process, holding the write end of the
    // watchdog's stdin: nothing is ever written to it, so the pipe closing IS the
    // death notice. Ending it stands in for the dashboard being closed or killed.
    const child = dummy();
    const manifest = manifestPath();
    record(manifest, child.pid!, processStartedAt(child.pid!));

    const parent = spawn(process.execPath, [watchdog, manifest], {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    running.push(parent);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(alive(child.pid!)).toBe(true);

    parent.stdin!.end();

    // Wait on the manifest rather than the child's liveness. taskkill returns as
    // soon as it has asked, so the process can be gone a moment before
    // writeManifest runs; polling `alive()` reports the kill done while the
    // manifest still lists the pid, which failed about one run in five.
    // writeFileSync truncates before it writes, so a read can catch it empty or
    // half-written; that is not a failure, it is just not finished yet.
    const manifestEmptied = () => {
      try {
        return JSON.parse(readFileSync(manifest, 'utf8')).length === 0;
      } catch {
        return false;
      }
    };
    expect(await waitFor(manifestEmptied, 15000)).toBe(true);
    expect(alive(child.pid!)).toBe(false);
  }, 40000);

  it('reaps on the spot with --now, without waiting for a parent to die', async () => {
    // `run-dashboard.bat stop` has no port to find a stranded tree by, so it asks
    // for the kill now rather than after a death.
    const child = dummy();
    const manifest = manifestPath();
    record(manifest, child.pid!, processStartedAt(child.pid!));

    expect(spawnSync(process.execPath, [watchdog, manifest, '--now']).status).toBe(0);
    expect(await waitFor(() => !alive(child.pid!), 5000)).toBe(true);
    expect(JSON.parse(readFileSync(manifest, 'utf8'))).toEqual([]);
  }, 20000);
});
