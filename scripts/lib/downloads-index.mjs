/**
 * The website's download index (launcher/downloads.json).
 *
 * latest.json is the *updater's* manifest, so it lists only updater artifacts.
 * That omits the macOS .dmg a person actually clicks - the .app.tar.gz is an
 * updater format nobody installs by hand. The index is derived from the
 * published file names instead, so the page can offer the .dmg too and cannot
 * drift from what was really published.
 *
 * Every entry carries the SHA256 of its bytes, and the document is signed with
 * the release key. The site is the one path that hands a binary to a person
 * without the updater's signature check, so an R2 writer who replaces an
 * installer or a URL must not be able to do it unnoticed. The signature proves
 * the list; the hash proves the file the list points at.
 *
 * Pure: it takes file names and hashes, not a bucket, so it is testable without
 * R2 credentials and reusable by both the local publisher and the CI index-only
 * mode. The caller decides which files exist; this decides how they are grouped,
 * labelled and ordered.
 */

/**
 * The one human installer each platform ships, and the order a person wants it.
 *
 * This table is the single source for classification, labels and ordering. A new
 * platform or format is one row here, not four matching regexes.
 */
export const INSTALLERS = [
  { platform: 'windows', pattern: /-setup\.exe$/, label: 'EXE installer' },
  { platform: 'macos', pattern: /\.dmg$/, label: 'Disk image' },
];

export const PLATFORMS = INSTALLERS.map(({ platform }) => platform);

export const PLATFORM_ORDER = Object.fromEntries(
  INSTALLERS.map(({ platform, label }) => [platform, [label]])
);

const SHA256 = /^[0-9a-f]{64}$/;

/** Whether a value is a lowercase hex SHA256, the only form the index accepts. */
export function isSha256(value) {
  return typeof value === 'string' && SHA256.test(value);
}

/** The platform a published file belongs to, or null when it is not a download. */
export function classifyAsset(name) {
  return INSTALLERS.find(({ pattern }) => pattern.test(name))?.platform ?? null;
}

/** The label the download page shows for a file. */
export function assetLabel(name) {
  return INSTALLERS.find(({ pattern }) => pattern.test(name))?.label ?? name;
}

/** Whether a release asset is a human installer. */
export function isInstaller(name) {
  return INSTALLERS.some(({ pattern }) => pattern.test(name));
}

/** Whether a release asset is the updater signature of a human installer. */
export function isInstallerSignature(name) {
  return name.endsWith('.sig') && isInstaller(name.slice(0, -4));
}

/**
 * Build the index from a version and the published files.
 *
 * `files` entries are `{ name, sha256 }`. A download with no hash is refused
 * rather than listed: an entry the site cannot verify must never be offered,
 * and a missing hash is how a planted file would slip through.
 *
 * The page leads with the first entry of each group, and the website now takes
 * items[0] as the download to offer - so the ordering here is what a person
 * actually downloads, not decoration.
 */
export function buildDownloadsIndex({ version, files, base }) {
  const groups = Object.fromEntries(PLATFORMS.map((platform) => [platform, []]));

  for (const file of files ?? []) {
    const { name, sha256 } = file ?? {};
    if (!name) continue;
    // Signatures are consumed by the updater, never clicked by a person; an
    // unrecognised name (latest.json, the CI asset map) is not a download either.
    if (name.endsWith('.sig') || name === 'latest.json') continue;
    const platform = classifyAsset(name);
    if (!platform) continue;
    if (!isSha256(sha256)) {
      throw new Error(
        `downloads.json: ${name} has no sha256. Every download is hashed so the site ` +
          'can refuse bytes that were replaced in the bucket.'
      );
    }
    groups[platform].push({
      label: assetLabel(name),
      url: `${base}/${encodeURIComponent(name)}`,
      sha256,
    });
  }

  // It must name every platform: an unlisted one falls through to alphabetical
  // order, which silently leads macOS with the .app.tar.gz updater format
  // instead of the .dmg a human wants.
  for (const [platform, items] of Object.entries(groups)) {
    const preferred = PLATFORM_ORDER[platform];
    items.sort((a, b) => {
      const ai = preferred?.indexOf(a.label) ?? 99;
      const bi = preferred?.indexOf(b.label) ?? 99;
      return ai - bi || a.label.localeCompare(b.label);
    });
  }

  // A label this version does not know still needs a deliberate position;
  // without the assertion a new artifact type sorts alphabetically and can
  // displace the format we meant to lead with.
  for (const [platform, items] of Object.entries(groups)) {
    const known = new Set(PLATFORM_ORDER[platform]);
    for (const item of items) {
      if (!known.has(item.label)) {
        throw new Error(
          `downloads.json: unexpected "${item.label}" on ${platform}. ` +
            'Add it to PLATFORM_ORDER in downloads-index.mjs so its position is deliberate.'
        );
      }
    }
  }

  return { version, platforms: groups };
}

/**
 * Fold a freshly built index into the one the bucket already serves.
 *
 * A producer that builds one platform must not drop the others: uploading the
 * new document whole would erase the downloads another producer published. Each
 * platform the new index has files for is replaced; a platform it built nothing
 * for keeps what is live.
 *
 * A live entry with no SHA256 is dropped, not carried forward. Signing the
 * merged document would otherwise turn an unverifiable entry into a signed one,
 * and the site would have no hash to check the bytes against.
 */
export function mergeDownloadsIndex(live, incoming) {
  const platforms = {};
  for (const [id, items] of Object.entries(incoming.platforms)) {
    const next = items.length ? items : (live?.platforms?.[id] ?? []);
    const verified = next.filter((item) => isSha256(item?.sha256));
    if (verified.length) platforms[id] = verified;
  }
  return { version: incoming.version, platforms };
}
