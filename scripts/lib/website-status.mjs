/**
 * The pure website decisions the dashboard's Website panel shares.
 *
 * Total functions over plain values - no network, no filesystem, no child
 * processes - so dashboard.mjs stays a transport that gathers bytes and hands
 * them to these rules.
 *
 * Four questions, deliberately separate:
 *
 *   1. What does downloads.json mean for a person? (summariseDownloads) The site
 *      renders it by a rule of its own, so the panel must apply the same rule or
 *      it reports a different artifact than the button does.
 *   2. What does `git status --porcelain` say? (siteGitSummary, parseAheadCount)
 *      "Dirty" has to mean one thing to the status row and to the deploy warning.
 *   3. What does wrangler say about the deployed site? (parsePagesDeployments)
 *      The deployment list is the only answer to "is what is live the same as
 *      what is checked out".
 *   4. What should be said when the repo is missing? (siteMissingMessage) Named
 *      once so the panel and the refusal cannot disagree. The site repo is a
 *      separate checkout that publishes launcher/downloads.json to R2, which the
 *      site reads through a Pages Function - so publishing a launcher version
 *      changes what the site shows without the site being redeployed.
 */

/**
 * The Pages project the site repo deploys to.
 *
 * Hard-coded because the site repo deliberately has no wrangler.toml - its
 * presence makes wrangler take over the deploy and break the Pages native
 * upload - and the name equals the directory name Pages defaults to, so there
 * is no second place to read it from. Overridable for a fork.
 */
export const SITE_PROJECT_NAME = process.env.DASHBOARD_SITE_PROJECT || 'pandawan-launcher-site';

/**
 * Which format leads when a platform ships more than one.
 *
 * Mirrors PREFERRED in the site's own app.js, because that map is what the page
 * matches on and the panel must report the artifact the button will actually be.
 * A mismatch silently changes which file a person downloads; where the two
 * genuinely disagree, the site's verify.mjs is the authority and this is a
 * display detail.
 */
export const SITE_PREFERRED = {
  windows: 'MSI installer',
  macos: 'Disk image',
  linux: 'Debian / Ubuntu',
};

/** Display names for the platform ids, so the panel does not invent its own. */
export const SITE_PLATFORM_NAMES = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

/** Known platform ids, in the order the site renders its cards. */
export const SITE_PLATFORMS = Object.keys(SITE_PREFERRED);

/**
 * The refusal shown when the site repo is not checked out.
 *
 * One message for both the status panel and the two write verbs: three wordings
 * of "it is missing" is how an operator ends up unsure whether the deploy
 * refused or the panel failed. It names the path that was checked, because the
 * actual failure is almost always a clone next to the wrong parent folder.
 */
export function siteMissingMessage(siteRoot) {
  return `The website repo is not checked out at ${siteRoot}. Clone pandawan-launcher-site next to this repository (../pandawan-launcher-site) to use this.`;
}

/**
 * The filename at the end of a download URL, decoded, or null.
 *
 * downloads.json percent-encodes its asset names, so a raw slice would show
 * "Pandawan.Launcher_0.1.0_x64%20en-US.msi" where the operator knows the file as
 * "...x64 en-US.msi". Decoding is guarded because a malformed escape makes
 * decodeURIComponent throw, and a status panel must not die on one bad string.
 */
export function artifactFilename(url) {
  if (typeof url !== 'string' || !url) return null;
  const last = url.split('?')[0].split('#')[0].split('/').filter(Boolean).pop();
  if (last === undefined) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** The lowercase extension of a download URL (".msi"), or '' when it has none. */
export function artifactExtension(url) {
  const name = artifactFilename(url);
  if (!name) return '';
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * A usable download entry, or null. Anything else is skipped, not rendered.
 *
 * Every entry is normalised the same way, preferred or not: a dropdown entry
 * that reported no extension would make the panel answer "which file is this"
 * differently depending on where in the list it appeared.
 */
function downloadEntry(item) {
  if (!item || typeof item !== 'object' || typeof item.url !== 'string' || !item.url) return null;
  const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : null;
  return {
    label,
    url: item.url,
    filename: artifactFilename(item.url),
    extension: artifactExtension(item.url),
  };
}

/**
 * What the page will actually offer, per platform.
 *
 * The site's own rule, copied rather than re-guessed: it takes the first entry
 * whose `label` equals PREFERRED[platform], falling back to items[0] when no
 * label matches. `fallback` is reported because a renamed label does not break
 * the page - it changes which file the Download button leads with, and nothing
 * else would say so. `alternatives` is the rest of the group, in document order
 * (the site shows these as a dropdown).
 *
 * Known platforms come first in the site's order, then any extra id the document
 * carries - an unlisted platform is not filtered out, because a platform the page
 * renders but the panel hides is worse than an odd row.
 *
 * @param doc the parsed downloads.json, or anything else
 * @returns {{version: string|null, platforms: object[]}}
 */
export function summariseDownloads(doc) {
  const groups = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc.platforms : null;
  const version =
    doc && typeof doc.version === 'string' && doc.version.trim() ? doc.version.trim() : null;

  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) {
    return { version, platforms: [] };
  }

  const ids = [
    ...SITE_PLATFORMS,
    ...Object.keys(groups)
      .filter((id) => !SITE_PLATFORMS.includes(id))
      .sort((a, b) => a.localeCompare(b)),
  ];

  const platforms = [];
  for (const id of ids) {
    const raw = Array.isArray(groups[id]) ? groups[id].map(downloadEntry).filter(Boolean) : [];

    if (raw.length === 0) {
      // Reported, not omitted. The site renders this card as "Not available yet",
      // so an absent platform IS something the page is showing.
      platforms.push({
        platform: id,
        name: SITE_PLATFORM_NAMES[id] ?? id,
        count: 0,
        empty: true,
        preferred: null,
        alternatives: [],
      });
      continue;
    }

    const wanted = SITE_PREFERRED[id];
    const index = wanted ? raw.findIndex((entry) => entry.label === wanted) : -1;
    const chosen = index === -1 ? raw[0] : raw[index];

    platforms.push({
      platform: id,
      name: SITE_PLATFORM_NAMES[id] ?? id,
      count: raw.length,
      empty: false,
      preferred: {
        label: chosen.label,
        url: chosen.url,
        filename: chosen.filename,
        extension: chosen.extension,
        // True when no entry carried the expected label and the page fell back
        // to the first one. Not an error here; it is the thing verify.mjs fails
        // a deploy over, so it needs to be visible before the deploy, not after.
        fallback: index === -1,
      },
      alternatives: raw.filter((entry) => entry !== chosen),
    });
  }

  return { version, platforms };
}

/**
 * What `git status --porcelain` says, as a shape.
 *
 * Any non-empty porcelain output means dirty, including a single untracked file:
 * an untracked run-website.bat is still a file the deploy's `npm run build`
 * would not use but which a git-based deploy would ship. The line count is kept
 * so the warning can say how much, which is more useful than a bare yes/no.
 *
 * @param porcelain raw stdout of `git status --porcelain`
 */
export function parsePorcelain(porcelain) {
  const lines = String(porcelain ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { dirty: lines.length > 0, changedFiles: lines.length };
}

/**
 * Commits HEAD has that its upstream does not, or null.
 *
 * `rev-list --left-right --count HEAD...@{upstream}` prints "behind\tahead" -
 * the RIGHT number is the one that says whether a deploy would ship something
 * that is not pushed yet. Null, not 0, when the command fails, because the usual
 * reason is that the checkout has no upstream at all: a fresh clone of a
 * detached tag, or a local branch nobody pushed. That is normal, and reporting
 * it as "0 ahead" would claim the operator is in step with a remote that does
 * not exist.
 */
export function parseAheadCount(stdout) {
  const match = String(stdout ?? '')
    .trim()
    .match(/^(\d+)\s+(\d+)$/);
  return match ? Number(match[2]) : null;
}

/** The URL of `remote`, or null. Used for display only. */
export function parseGitRemote(stdout) {
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const match = line.trim().match(/^(\S+)\s+(\S+?)(?:\s+\(.*\))?$/);
    if (match && match[1]) return match[2];
  }
  return null;
}

/**
 * The git facts about the site repo, or null when there is nothing to report.
 *
 * Assembled from already-collected command output rather than run here, so the
 * rules stay pure and the panel can gather the four values however it likes.
 * `ahead` is passed through untouched, including null, so "no upstream" stays
 * distinguishable from "in step".
 *
 * Every field defaults to null rather than to an empty string: a repo with no
 * commits, or a `git` that is not installed, must read as unknown, and an empty
 * string in a table cell looks like a blank value rather than a missing one.
 */
export function siteGitSummary({ porcelain, branch, commit, subject, ahead, remote } = {}) {
  const status = parsePorcelain(porcelain);
  return {
    branch: branch || null,
    commit: commit || null,
    subject: subject || null,
    dirty: status.dirty,
    changedFiles: status.changedFiles,
    ahead: typeof ahead === 'number' && Number.isFinite(ahead) ? ahead : null,
    remote: remote || null,
  };
}

/**
 * One row of a deployment list, or null for an entry with no id.
 *
 * Only fields the panel can act on are kept. wrangler's `Status` column is a
 * human string ("1 day ago") rather than a timestamp, so it is passed through
 * verbatim instead of being parsed into a date that would be wrong.
 */
function deploymentRow(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = typeof entry.Id === 'string' ? entry.Id : null;
  if (!id) return null;
  return {
    id,
    environment: typeof entry.Environment === 'string' ? entry.Environment : null,
    branch: typeof entry.Branch === 'string' ? entry.Branch : null,
    // The short commit sha the deployment was built from, so "live" can be
    // compared against the checkout's own commit without opening Cloudflare.
    source: typeof entry.Source === 'string' ? entry.Source : null,
    url: typeof entry.Deployment === 'string' ? entry.Deployment : null,
    status: typeof entry.Status === 'string' ? entry.Status : null,
    build: typeof entry.Build === 'string' ? entry.Build : null,
  };
}

/**
 * Why wrangler's output could not be read, in one bounded line.
 *
 * The JSON parser's own message is not reused: V8 echoes the input it choked on,
 * which for a failed `wrangler` call is the whole Cloudflare error page and would
 * put kilobytes of stack noise into a panel cell. wrangler's first line of output
 * is the part an operator can act on ("error: not logged in"), so that is what is
 * kept, capped in case a line is unusually long.
 */
function unreadableReason(raw) {
  const first = String(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!first) return 'wrangler printed no deployment list';
  const short = first.length > 200 ? `${first.slice(0, 200)}...` : first;
  return `wrangler printed something that is not a deployment list: ${short}`;
}

/**
 * The offset of the first `[` that starts a line and begins a parsable array, or
 * -1.
 *
 * A plain `indexOf('[')` is wrong here: wrangler prints `▲ [WARNING] ...` before
 * its output often enough, and slicing from that bracket yields nonsense that
 * then reports "no Cloudflare CLI" for a command that worked. Only a bracket that
 * could begin a line of JSON is considered, and each candidate is parsed before
 * being accepted, so the recovery cannot itself invent a shape.
 */
function arrayStartAfterBanner(raw) {
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '[') continue;
    if (i !== 0 && raw[i - 1] !== '\n') continue;
    const end = raw.lastIndexOf(']');
    if (end <= i) continue;
    try {
      if (Array.isArray(JSON.parse(raw.slice(i, end + 1)))) return i;
    } catch {
      // Not the array; keep looking rather than giving up on the whole command.
    }
  }
  return -1;
}

/**
 * The deployed site state, from `wrangler pages deployment list --json`.
 *
 * Tolerant of a banner: wrangler suppresses it for --json, but an older build or
 * a logged warning in front of the array would otherwise turn a successful list
 * into "wrangler is unavailable" - the one answer this panel must not get wrong,
 * because it is what says whether the live site matches the checkout.
 *
 * `latest` is the first entry as wrangler orders it (newest first), hoisted out
 * because "what is live right now" is the question the panel opens with.
 *
 * @returns {{deployments: object[], latest: object|null, error: string|null}}
 */
export function parsePagesDeployments(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { deployments: [], latest: null, error: null };

  const isList = (candidate) => {
    try {
      const value = JSON.parse(candidate);
      return Array.isArray(value);
    } catch {
      return false;
    }
  };

  let list = null;
  if (isList(raw)) {
    list = JSON.parse(raw);
  } else {
    const start = arrayStartAfterBanner(raw);
    if (start !== -1) list = JSON.parse(raw.slice(start, raw.lastIndexOf(']') + 1));
  }

  if (!list) {
    return { deployments: [], latest: null, error: unreadableReason(raw) };
  }

  const deployments = list.map(deploymentRow).filter(Boolean);
  return { deployments, latest: deployments[0] ?? null, error: null };
}
