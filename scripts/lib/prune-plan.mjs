/**
 * Which builds a prune may delete.
 *
 * Extracted from prune-builds.mjs so the destructive decision is testable. This
 * is the only part of pruning that can lose data, and it runs against a live
 * bucket, so it should never depend on being read carefully.
 */

/**
 * A version directory begins with a digit (0.4.0, 1.2, 2026.1).
 *
 * Requiring that rules out the pre-layout directories — D3D12,
 * MonoBleedingEdge, misspell_Data — which must never be read as a build to
 * delete. "Contains a digit" is not enough: D3D12 has both a 3 and a 1.
 */
const isVersionSegment = (segment) => /^\d/.test(segment);

/**
 * @param keys      every key under the channel prefix
 * @param prefix    e.g. "games/misspell/alpha"
 * @param keep      how many newest builds to keep
 * @param activeVersion version the live manifest points at, if known
 */
export function planPrune(keys, prefix, keep, activeVersion) {
  const versions = new Map();
  for (const key of keys) {
    const rest = key.slice(prefix.length + 1).split('/');
    if (rest.length < 2) continue;
    const version = rest[0];
    if (!isVersionSegment(version)) continue;
    if (!versions.has(version)) versions.set(version, { objects: 0, bytes: 0 });
    versions.get(version).objects += 1;
  }

  const all = Array.from(versions.entries()).sort(([a], [b]) =>
    b.localeCompare(a, undefined, { numeric: true })
  );

  // Files left over from the pre-version-stamped layout sit directly under the
  // channel prefix, alongside the manifest. They are dead weight, but they cannot
  // be swept with a recursive delete: the manifest.json beside them is live and
  // deleting it would break every install.
  const flatLeftovers = keys.filter((key) => {
    const rest = key.slice(prefix.length + 1).split('/');
    if (rest[0] === 'manifest.json') return false;
    return !isVersionSegment(rest[0]);
  });

  const protectedVersions = new Set(all.slice(0, keep).map(([version]) => version));
  if (activeVersion) protectedVersions.add(activeVersion);

  return {
    all,
    flatLeftovers,
    protectedVersions,
    doomed: all.filter(([version]) => !protectedVersions.has(version)),
  };
}

/**
 * The version the live manifest names, or null when it cannot be read.
 *
 * Read best-effort: when this fails the caller keeps the newest build only, which
 * is the safe direction to be wrong in.
 */
export function readActiveVersion(manifestJson) {
  if (!manifestJson) return null;
  try {
    const parsed = JSON.parse(manifestJson);
    return parsed?.version ?? null;
  } catch {
    return null;
  }
}
