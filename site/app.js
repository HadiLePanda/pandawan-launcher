/**
 * Renders the current launcher release, read from the updater manifest.
 *
 * The manifest is the same file the in-app updater polls, so this page can never
 * advertise a download that the launcher would not accept - there is no second
 * list of versions to keep in sync.
 */

/**
 * Manifest → the buttons to show.
 *
 * tauri-action emits a `platforms` map keyed by updater target, and several
 * targets can point at one file: every `darwin-*` target shares a single
 * universal .app.tar.gz. Showing a button per target would list macOS six
 * times, so entries are grouped by the file they actually download and the
 * shortest representative filename wins.
 */
function downloadsFrom(manifest) {
  const byFile = new Map();

  for (const [target, entry] of Object.entries(manifest.platforms ?? {})) {
    if (!entry?.url) continue;
    const file = decodeURIComponent(entry.url.split('/').pop());
    const existing = byFile.get(file);
    if (!existing || file.length < existing.file.length) {
      byFile.set(file, { file, url: entry.url, target });
    }
  }

  // Returns named fields, not a positional array: this is spread into the item,
  // and spreading an array would produce keys named "0" and "1" instead.
  const label = (file) => {
    if (/\.msi$/.test(file)) return { platform: 'Windows', kind: 'MSI installer' };
    if (/-setup\.exe$/.test(file)) return { platform: 'Windows', kind: 'EXE installer' };
    if (/\.dmg$/.test(file)) return { platform: 'macOS', kind: 'Disk image' };
    if (/\.app\.tar\.gz$/.test(file)) return { platform: 'macOS', kind: 'App archive' };
    if (/\.deb$/.test(file)) return { platform: 'Linux', kind: 'Debian / Ubuntu' };
    if (/\.rpm$/.test(file)) return { platform: 'Linux', kind: 'Fedora / RHEL' };
    return { platform: 'Other', kind: file };
  };

  return [...byFile.values()].map((item) => ({ ...item, ...label(item.file) }));
}

function render(manifest) {
  const host = document.getElementById('downloads');
  host.textContent = '';

  const downloads = downloadsFrom(manifest);
  if (!downloads.length) {
    host.textContent = 'No downloads are published yet.';
    return;
  }

  const version = document.getElementById('version');
  version.textContent = `Version ${manifest.version}`;
  version.hidden = false;

  for (const item of downloads) {
    const link = document.createElement('a');
    link.className = 'btn';
    link.href = item.url;

    const platform = document.createElement('span');
    platform.className = 'platform';
    platform.textContent = item.platform;

    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = item.kind;

    // No file sizes: the bucket sends no CORS headers, so a browser cannot read
    // them for the size of an element without adding bucket CORS rules. Not
    // worth the configuration for one label.
    link.append(platform, kind);
    host.append(link);
  }
}

async function load() {
  const status = document.getElementById('status');
  try {
    // /latest.json is served by a Pages Function rather than fetched from the
    // bucket directly: the bucket sends no CORS header, so a browser would be
    // blocked from reading it cross-origin.
    const response = await fetch('/latest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`manifest returned ${response.status}`);
    render(await response.json());
  } catch (error) {
    status.textContent = `Could not load the release manifest. ${error.message}`;
  }
}

load();
