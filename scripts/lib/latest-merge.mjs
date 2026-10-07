/**
 * Merging two Tauri updater manifests, as a pure decision.
 *
 * The workflow and the local Windows build each produce a latest.json that
 * describes only the platforms they built. Writing either one wholesale drops
 * the other's platforms from the bucket, and the dropped platforms stop seeing
 * updates. So the two are merged, platform by platform.
 */

/**
 * Merge `incoming` into `existing`, or return `incoming` unchanged.
 *
 * A single Tauri latest.json carries ONE top-level `version` that every platform
 * entry shares, so a merge is only valid between two documents at the same
 * version. Different versions (or no existing document) return the incoming
 * document alone: merging would advertise a platform at a version the top level
 * does not claim.
 *
 * Incoming wins per platform, so a rebuild of a platform replaces its entry.
 */
export function mergeLatest(existing, incoming) {
  if (!incoming || typeof incoming.platforms !== 'object' || incoming.platforms === null) {
    throw new Error('incoming latest.json has no platforms object');
  }
  if (
    !existing ||
    typeof existing.platforms !== 'object' ||
    existing.platforms === null ||
    existing.version !== incoming.version
  ) {
    return incoming;
  }
  return {
    ...incoming,
    platforms: { ...existing.platforms, ...incoming.platforms },
  };
}
