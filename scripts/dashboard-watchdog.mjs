/**
 * Kills what a dashboard run started, when that run is not around to do it.
 *
 * Two ways in:
 *
 *   node scripts/dashboard-watchdog.mjs <manifest path>
 *     Wait for the dashboard to die, then reap. This is the process the dashboard
 *     spawns for itself, and it is what covers the X-close: Windows delivers no
 *     signal and no `exit` event then, so nothing in the dashboard runs.
 *
 *   node scripts/dashboard-watchdog.mjs <manifest path> --now
 *     Reap immediately. This is what `run-dashboard.bat stop` needs, because a
 *     tree a hard kill stranded holds no port for it to be found by.
 *
 * The waiting form holds the write end of the dashboard's stdin without ever
 * being sent a byte, so the read end reaching EOF *is* the death notice: exact,
 * with no polling and no pid to re-check against a recycled one.
 */
import { reapManifest } from './lib/service-reaper.mjs';

const [manifestPath, flag] = process.argv.slice(2);
if (!manifestPath) process.exit(0);

if (flag === '--now') {
  reapManifest(manifestPath);
  process.exit(0);
}

// EOF, 'close' and an error on the pipe all mean the same thing: the parent is
// gone. The first one to arrive wins.
let finished = false;
const finish = () => {
  if (finished) return;
  finished = true;
  reapManifest(manifestPath);
  process.exit(0);
};

process.stdin.on('end', finish);
process.stdin.on('close', finish);
process.stdin.on('error', finish);
process.stdin.resume();
