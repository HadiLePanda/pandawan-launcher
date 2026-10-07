export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

/**
 * Why the current version's tag cannot be moved onto HEAD, or nothing.
 *
 * Moving a tag is only meaningful when the build the tag produced was never
 * published: the tag's commit is checked, but the release it points at is not
 * live. That is the failed-CI case, and it is why this is a verb of its own
 * rather than a flag on a release - re-pointing a tag whose release players
 * already have would swap the bytes under an unchanged version, and every
 * client would keep the version number it already has.
 *
 * A tag already at HEAD is refused rather than allowed as a no-op: pushing an
 * unchanged ref fires no workflow run, so the operator would see "moved" and get
 * no build. Bump instead, or push the tag if only the push is missing.
 */
export function retagPlan({ version, branch, dirty, headSha, tagSha }) {
  const errors = [];
  if (!SEMVER.test(version ?? '')) errors.push(`not a semver version: ${version ?? '(missing)'}`);
  if (branch !== 'main') errors.push(`the tag is moved from main, not ${branch}`);
  if (dirty) errors.push('uncommitted changes: commit them before moving the tag');
  if (tagSha && headSha && tagSha === headSha) {
    errors.push(`tag v${version} already points at HEAD; push it, or bump the version`);
  }
  return { ok: errors.length === 0, errors, tag: `v${version}` };
}
