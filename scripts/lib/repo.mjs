/**
 * The GitHub "owner/repo" a remote URL points at, or null.
 *
 * Parsed rather than named. The publishing tools here run against whatever
 * repository they are cloned into, and must never carry a hard-coded owner: a
 * baked-in name would let a copy of the tool act on the original's CI and
 * releases by accident. `git remote get-url origin` supplies the URL; this turns
 * it into the two parts the `gh` API needs.
 */
export function parseGithubRepo(remoteUrl) {
  const url = String(remoteUrl ?? '').trim();
  if (!url) return null;

  // git@github.com:owner/repo.git
  const ssh = url.match(/^git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return `${ssh[1]}/${ssh[2]}`;

  // https://github.com/owner/repo.git  (also the .git-less and trailing-slash forms)
  const https = url.match(/^https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (https) return `${https[1]}/${https[2]}`;

  return null;
}
