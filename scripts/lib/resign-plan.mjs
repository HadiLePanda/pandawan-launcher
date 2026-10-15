/**
 * Which published manifests still need a signature, and under which cache header.
 *
 * Pure, so the two decisions that could leave a game uninstallable - which keys are
 * manifests at all, and how long a client may cache the signature - are testable
 * without a bucket.
 */

/** Keys arrive from `listKeysWithMeta` as objects, or as plain strings from a test. */
const nameOf = (entry) => (typeof entry === 'string' ? entry : entry.key);

/** A version directory begins with a digit: 0.4.0, 1.2, 2026.1. */
const isVersionDir = (segment) => /^\d/.test(segment);

/**
 * Every manifest under `prefix`: the channel-root copy, plus one per version
 * directory. The launcher verifies both - a fresh install reads the version
 * `latest.json` names, an older client the channel root - so both need a signature.
 */
export function manifestKeys(keys, prefix) {
  return keys
    .map(nameOf)
    .filter((key) => {
      const rest = key.slice(prefix.length + 1);
      if (rest === 'manifest.json') return true;
      const parts = rest.split('/');
      return parts.length === 2 && parts[1] === 'manifest.json' && isVersionDir(parts[0]);
    })
    .sort();
}

/**
 * The header the signature is stored under, which has to be the document's own: a
 * version directory is published immutable, the channel root is not.
 */
export function cacheControlFor(key, prefix) {
  return key === `${prefix}/manifest.json` ? 'no-cache' : 'immutable';
}

/**
 * The manifests to sign, and the ones already carrying a signature. `force` re-signs
 * everything, for a signature made with a key that is no longer trusted.
 */
export function planResign(keys, prefix, { force = false } = {}) {
  const present = new Set(keys.map(nameOf));
  const sign = [];
  const skip = [];
  for (const key of manifestKeys(keys, prefix)) {
    const entry = { key, cache: cacheControlFor(key, prefix) };
    if (present.has(`${key}.sig`) && !force) skip.push(entry);
    else sign.push(entry);
  }
  return { sign, skip };
}
