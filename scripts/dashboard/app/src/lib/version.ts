/**
 * Version comparison and next-version suggestions.
 *
 * A plain string sort puts 0.4.10 before 0.4.9, so a lexicographic compare
 * silently names the OLDER build as the newest. Everything that asks "which is
 * newer" goes through these functions.
 */

/** Split a version into its numeric core and its prerelease suffix. */
function splitVersion(version: string | null | undefined): [number[], string] {
  const parts = String(version ?? '').split('-');
  const core = (parts.shift() ?? '').split('.').map((part) => {
    const n = Number(part);
    return Number.isFinite(n) ? n : 0;
  });
  return [core, parts.join('-')];
}

/** Negative, zero or positive: a is older than b, the same, or newer. */
export function compareVersions(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  const [aCore, aPre] = splitVersion(a);
  const [bCore, bPre] = splitVersion(b);
  for (let i = 0; i < Math.max(aCore.length, bCore.length); i++) {
    const diff = (aCore[i] ?? 0) - (bCore[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // Same numbers, so the prerelease decides - and a release outranks its own
  // prereleases, which is what makes 0.4.11 newer than 0.4.11-alpha.1. Two
  // prereleases of the same version fall back to text order, which only has to
  // be consistent, not clever.
  if (aPre === bPre) return 0;
  if (!aPre) return 1;
  if (!bPre) return -1;
  return aPre < bPre ? -1 : 1;
}

/** The newest of a list of version strings, or null when the list is empty. */
export function newestVersion(versions: readonly (string | null | undefined)[]): string | null {
  return versions
    .filter((v): v is string => Boolean(v))
    .reduce<string | null>((best, v) => (!best || compareVersions(v, best) > 0 ? v : best), null);
}

/**
 * What a level does to a version, for the preview beside a bump control.
 *
 * Display only - the script that writes the version owns the real bump. It is
 * shown so the level's effect is on screen: "minor" with nothing saying 0.2.0
 * reads the same as "patch", which would quietly produce 0.1.1.
 */
export function nextVersion(version: string, level: 'patch' | 'minor' | 'major'): string {
  const [core] = splitVersion(version);
  const major = core[0] ?? 0;
  const minor = core[1] ?? 0;
  const patch = core[2] ?? 0;
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * The version to suggest when publishing another build of a game.
 *
 * Bumps the patch component of whatever is live. Returns '' when nothing is
 * published yet: suggesting 0.1.0 for a game that has never shipped would be a
 * guess, and the operator's own CI version is the only source of that number.
 *
 * A prerelease is deliberately NOT carried forward: 0.4.0-alpha.2 becomes
 * 0.4.1, because the bump applies to the numeric core. Carrying it would leave
 * the field blank on exactly the channel where a suggestion is most useful.
 */
export function suggestNextVersion(current: string | null | undefined): string {
  const [core] = splitVersion(current);
  if (core.length !== 3 || !core.every(Number.isFinite)) return '';
  const next = [...core];
  next[2] = (next[2] ?? 0) + 1;
  return next.join('.');
}

/**
 * The build number to suggest.
 *
 * A build number is a per-game counter, so the next one is the highest number
 * already published plus one - the highest, not the newest version's. The
 * counters can differ per platform, and offering the lowest one risks
 * republishing over a build that already exists.
 */
export function suggestNextBuild(entries: readonly { build?: number | null }[]): number | null {
  const numbers = entries.map((entry) => Number(entry.build)).filter((n) => Number.isFinite(n));
  if (!numbers.length) return null;
  return Math.max(...numbers) + 1;
}
