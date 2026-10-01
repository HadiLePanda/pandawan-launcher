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
 * @param activeVersion version the live manifest points at, if known. May be a
 *   single string or, on a per-platform channel, one version per platform — every
 *   one of them is protected, because deleting the version a platform is pinned to
 *   removes that platform's game rather than just its history.
 * @param olderThanDays additionally drop builds untouched for this long, on top
 *   of the keep-N rule. Never overrides a pinned version.
 */
export function planPrune(
  keys,
  prefix,
  keep,
  activeVersion,
  { olderThanDays = null, now = Date.now() } = {}
) {
  // Keys may carry a timestamp (from listKeysWithMeta) or be plain strings.
  const timestampOf = (key) => (typeof key === 'string' ? null : key.lastModified);
  const nameOf = (key) => (typeof key === 'string' ? key : key.key);
  const pinned = new Set(
    (Array.isArray(activeVersion) ? activeVersion : [activeVersion]).filter(Boolean)
  );
  const versions = new Map();
  for (const entry of keys) {
    const rest = nameOf(entry)
      .slice(prefix.length + 1)
      .split('/');
    if (rest.length < 2) continue;
    const version = rest[0];
    if (!isVersionSegment(version)) continue;
    if (!versions.has(version)) versions.set(version, { objects: 0, lastModified: null });
    const record = versions.get(version);
    record.objects += 1;
    const lastModified = timestampOf(entry);
    if (lastModified && (!record.lastModified || lastModified > record.lastModified)) {
      record.lastModified = lastModified;
    }
  }

  const all = Array.from(versions.entries()).sort(([a], [b]) =>
    b.localeCompare(a, undefined, { numeric: true })
  );

  // Files left over from the pre-version-stamped layout sit directly under the
  // channel prefix, alongside the manifest. They are dead weight, but they cannot
  // be swept with a recursive delete: the objects beside them are live.
  //
  // manifest.json and latest.json are both excluded because both are mutable
  // channel files. latest.json is the per-platform pointer, and deleting it
  // leaves every client unable to resolve which version is current.
  const CHANNEL_FILES = new Set(['manifest.json', 'latest.json']);

  const flatLeftovers = keys.filter((entry) => {
    const rest = nameOf(entry)
      .slice(prefix.length + 1)
      .split('/');
    if (CHANNEL_FILES.has(rest[0])) return false;
    return !isVersionSegment(rest[0]);
  });

  const protectedVersions = new Set(all.slice(0, keep).map(([version]) => version));
  for (const version of pinned) protectedVersions.add(version);

  // Age is an extra rule, not a replacement: a channel published rarely would
  // otherwise keep a build forever purely because it is the newest of its small
  // set. A pinned version is never dropped by age, since it is the live build for
  // whichever platform is on it.
  const cutoff = olderThanDays === null ? null : now - Number(olderThanDays) * 86400000;

  const doomed = all.filter(([version, info]) => {
    if (protectedVersions.has(version)) return false;
    return (
      cutoff === null || (info.lastModified !== null && Date.parse(info.lastModified) < cutoff)
    );
  });

  return {
    all,
    // Names, not the raw entries: listKeysWithMeta yields objects, and callers
    // slice and prefix these strings directly.
    flatLeftovers: flatLeftovers.map(nameOf),
    protectedVersions,
    pinned,
    doomed,
    // Reported rather than silently kept, so `--older-than` never looks like it
    // deleted more than it did.
    skippedAsYoung:
      cutoff === null
        ? []
        : all
            .filter(([version, info]) => !protectedVersions.has(version))
            .filter(
              ([, info]) => info.lastModified === null || Date.parse(info.lastModified) >= cutoff
            )
            .map(([version]) => version),
  };
}

/**
 * Every version currently pinned on a channel, keyed by platform.
 *
 * This is what makes a per-platform prune safe. A channel can have Windows on
 * 0.4.0 and macOS on 0.3.9 at once, and deleting 0.3.9 would not remove history —
 * it would remove macOS's game entirely.
 */
export function readPinnedVersions(indexJson) {
  if (!indexJson) return null;
  try {
    const parsed = JSON.parse(indexJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out = {};
    for (const [platform, entry] of Object.entries(parsed)) {
      if (entry && typeof entry.version === 'string') out[platform] = entry.version;
    }
    return out;
  } catch {
    return null;
  }
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
