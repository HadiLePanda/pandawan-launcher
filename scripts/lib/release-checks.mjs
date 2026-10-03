export const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;

/**
 * Why a release cannot be cut, or nothing.
 *
 * The tag is what CI builds from, so every one of these is a way to tag a tree
 * that is not the release: a dirty tree puts unrelated edits inside the release
 * commit, and a tag that already exists attaches the build to an earlier commit.
 */
export function releaseChecks({ version, branch, dirty, tagExists }) {
  const errors = [];
  if (!SEMVER.test(version ?? '')) errors.push(`not a semver version: ${version ?? '(missing)'}`);
  if (branch !== 'main') errors.push(`releases are cut from main, not ${branch}`);
  if (dirty) errors.push('uncommitted changes: the release commit must be the version bump alone');
  if (tagExists) errors.push(`tag v${version} already exists`);
  return { ok: errors.length === 0, errors };
}
