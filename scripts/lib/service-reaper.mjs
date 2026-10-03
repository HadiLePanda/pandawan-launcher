/**
 * The bookkeeping that makes "started by the dashboard" provable after the fact.
 *
 * On Windows, a console window closed with X delivers no signal and no `exit`
 * event, so nothing inside the dashboard runs to clean up after itself. The
 * manifest is what both cleaners read instead: the watchdog the moment the
 * dashboard dies, and the next launch for anything a hard kill stranded.
 *
 * Every pid is stored with its process start time because that is what makes a
 * later kill safe - a recycled pid will not match, so an unrelated program is
 * never killed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Read a process's start time, or null if it is gone. Retries, because a
 * process spawned a moment ago is not always visible to Get-Process yet; an
 * unverifiable pid must never be killed later.
 */
export function processStartedAt(pid, attempts = 5) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const script =
    'try { $p = Get-Process -Id ' +
    pid +
    ' -ErrorAction Stop; ' +
    'Write-Output $p.StartTime.ToUniversalTime().ToString("o") } catch { Write-Output "" }';
  for (let i = 0; i < attempts; i++) {
    const out = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
    const value = (out.stdout ?? '').trim();
    if (value) return value;
    spawnSync('ping', ['-n', '2', '127.0.0.1'], { stdio: 'ignore' });
  }
  return null;
}

export function readManifest(manifestPath) {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return [];
  }
}

export function writeManifest(manifestPath, entries) {
  try {
    writeFileSync(manifestPath, JSON.stringify(entries, null, 2));
  } catch {
    // A missing manifest costs a possible orphan on a hard kill; it must never
    // stop the dashboard from starting.
  }
}

/**
 * Kill a process and everything it started. `/T` is the whole point: `npm run
 * tauri:dev` puts node, cargo and the built exe several levels below the pid we
 * spawned, and killing only that pid strands them holding ports. `/F` because
 * these trees do not respond to a polite close.
 */
export function killTree(pid) {
  if (!pid) return;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
}

/**
 * Kill everything the manifest still describes, then empty it. Entries whose
 * pid is gone, and entries whose start time no longer matches, are skipped
 * rather than guessed at.
 */
export function reapManifest(manifestPath) {
  const stale = readManifest(manifestPath);
  if (!stale.length) return 0;
  let killed = 0;
  for (const entry of stale) {
    if (!Number.isInteger(entry.pid) || entry.pid <= 0) continue;
    if (!entry.startedAt) continue;
    const startedAt = processStartedAt(entry.pid);
    if (startedAt === null) continue; // already gone
    if (startedAt !== entry.startedAt) continue; // pid was reused
    killTree(entry.pid);
    killed++;
  }
  writeManifest(manifestPath, []);
  return killed;
}
