/**
 * Version comparison and next-version suggestions.
 *
 * Ported verbatim from app.js's `splitVersion` / `compareVersions` /
 * `newestVersion`, including the comment that explains why: a plain string sort
 * puts 0.4.10 before 0.4.9, so a lexicographic compare once named the OLDER build
 * as the newest one on the page. Everything that asks "which is newer" here goes
 * through these functions, because the metric card and the publish form's
 * suggestion disagreed about the same data when each had a private copy.
 */

/** Split a version into its numeric core and its prerelease suffix. */
export function splitVersion(version: string | null | undefined): [number[], string] {
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
 * The version to suggest when publishing another build of a game.
 *
 * Bumps the patch component of whatever is live. Returns '' when nothing is
 * published yet: suggesting 0.1.0 for a game that has never shipped would be a
 * guess, and the operator's own CI version is the only source of that number.
 *
 * A prerelease is deliberately NOT carried forward. 0.4.0-alpha.2 becomes
 * 0.4.1, not 0.4.0-alpha.3 - the old logic only bumped when the core was
 * exactly three finite components, so a prerelease fell through and left the
 * field blank. That blank read as "nothing to suggest" on exactly the channel
 * where a suggestion is most useful.
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
