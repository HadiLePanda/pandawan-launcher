/**
 * The website's download index (launcher/downloads.json).
 *
 * latest.json is the *updater's* manifest, so it lists only updater artifacts.
 * That omits the macOS .dmg a person actually clicks - the .app.tar.gz is an
 * updater format nobody installs by hand. The index is derived from the
 * published file names instead, so the page can offer the .dmg too and cannot
 * drift from what was really published.
 *
 * Pure: it takes file names, not a bucket, so it is testable without R2
 * credentials and reusable by both the local publisher and the CI index-only
 * mode. The caller decides which files exist; this decides how they are grouped,
 * labelled and ordered.
 */

export const PLATFORM_ORDER = {
  windows: ['MSI installer', 'EXE installer'],
  macos: ['Disk image', 'App archive'],
  linux: ['Debian / Ubuntu', 'Fedora / RHEL'],
};

/** The platform a published file belongs to, or null when it is not a download. */
export function classifyAsset(name) {
  if (/\.msi$/.test(name) || /-setup\.exe$/.test(name)) return 'windows';
  if (/\.dmg$/.test(name) || /\.app\.tar\.gz$/.test(name)) return 'macos';
  if (/\.deb$/.test(name) || /\.rpm$/.test(name)) return 'linux';
  return null;
}

/** The label the download page shows for a file. */
export function assetLabel(name) {
  if (/\.msi$/.test(name)) return 'MSI installer';
  if (/-setup\.exe$/.test(name)) return 'EXE installer';
  if (/\.dmg$/.test(name)) return 'Disk image';
  if (/\.app\.tar\.gz$/.test(name)) return 'App archive';
  if (/\.deb$/.test(name)) return 'Debian / Ubuntu';
  if (/\.rpm$/.test(name)) return 'Fedora / RHEL';
  return name;
}

/**
 * Build the index from a version and the names of the published files.
 *
 * The page leads with the first entry of each group, and the website now takes
 * items[0] as the download to offer - so the ordering here is what a person
 * actually downloads, not decoration.
 */
export function buildDownloadsIndex({ version, files, base }) {
  const groups = { windows: [], macos: [], linux: [] };

  for (const name of files ?? []) {
    // Signatures are consumed by the updater, never clicked by a person; an
    // unrecognised name (latest.json, the CI asset map) is not a download either.
    if (name.endsWith('.sig') || name === 'latest.json') continue;
    const platform = classifyAsset(name);
    if (!platform) continue;
    groups[platform].push({ label: assetLabel(name), url: `${base}/${encodeURIComponent(name)}` });
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
 * for keeps what is live. A local Windows publish therefore leaves the macOS and
 * Linux entries untouched, and the page stays whole.
 */
export function mergeDownloadsIndex(live, incoming) {
  const platforms = {};
  for (const [id, items] of Object.entries(incoming.platforms)) {
    const next = items.length ? items : (live?.platforms?.[id] ?? []);
    if (next.length) platforms[id] = next;
  }
  return { version: incoming.version, platforms };
}
