const PLATFORMS = ['windows', 'macos', 'linux'];
const $ = (id) => document.getElementById(id);

// --- Tabs -----------------------------------------------------------------
//
// Panels are already in the DOM and hidden, so switching is attribute work
// rather than a render pass. The chosen tab is kept in the hash so a reload
// lands where you were: publishing is slow enough that losing your place
// mid-task is annoying.

function selectTab(name, { push = true } = {}) {
  for (const tab of document.querySelectorAll('.tab')) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    // Roving tabindex: only the selected tab stays in the tab order, so Tab
    // moves past the whole strip to the panel instead of through four stops.
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of document.querySelectorAll('.tabpanel')) {
    panel.hidden = panel.dataset.panel !== name;
  }

  if (push && location.hash.slice(1) !== name) {
    history.replaceState(null, '', `#${name}`);
  }
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
}

document.addEventListener('keydown', (event) => {
  // Arrow keys move between tabs, which is what a tablist is expected to do.
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
  const tabs = [...document.querySelectorAll('.tab')];
  const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
  if (current === -1) return;

  const step = event.key === 'ArrowRight' ? 1 : -1;
  const next = tabs[(current + step + tabs.length) % tabs.length];
  selectTab(next.dataset.tab);
  next.focus();
});

selectTab(location.hash.slice(1) || 'overview', { push: false });

function compare(versions) {
  const list = versions.filter(Boolean);
  if (list.length < 2) return null;
  const newest = list.reduce((a, b) => (a < b ? b : a));
  return list.find((v) => v !== newest) ?? null;
}

function renderDrift(drift) {
  const box = $('drift');
  if (!drift.length) {
    box.hidden = true;
    box.textContent = '';
    return;
  }
  box.hidden = false;
  box.textContent = drift
    .map((d) => `${d.gameId} ${d.channel}: platforms disagree on version`)
    .join('  �  ');
}

function ago(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}

function renderInventory(inventory) {
  const host = $('inventory');
  host.textContent = '';

  for (const game of inventory) {
    const card = el('section', 'card');
    card.append(el('h2', null, game.id));

    for (const channel of game.channels) {
      const latest = channel.latest ?? {};
      const behind = compare(Object.values(latest).map((e) => e.version));

      const head = el('div', 'card-head');
      head.append(el('span', 'tag', channel.channel));
      if (behind) head.append(el('span', 'tag warn', 'platforms out of sync'));
      card.append(head);

      const table = el('table');
      const headRow = el('tr');
      headRow.append(el('th', null, 'Platform'));
      headRow.append(el('th', null, 'Version'));
      headRow.append(el('th', null, 'Build'));
      headRow.append(el('th', null, 'Shipped'));
      table.append(headRow);

      for (const platform of PLATFORMS) {
        const entry = latest[platform];
        const row = el('tr', entry ? null : 'muted');
        row.append(el('td', null, platform));
        row.append(el('td', entry ? 'mono' : 'mono', entry ? entry.version : '�'));
        row.append(el('td', 'mono', entry ? entry.build : '�'));
        row.append(
          el('td', 'muted', entry ? ago(channel.updated?.[platform]) : String.fromCharCode(0x2014))
        );
        if (entry && behind && entry.version === behind) {
          row.classList.add('behind');
          row.title = `behind ${Object.values(latest)[0].version}`;
        }
        table.append(row);
      }
      card.append(table);

      if (channel.published.length > 1) {
        card.append(
          el('p', 'meta', `published: ${channel.published.map((v) => v.version).join(', ')}`)
        );
      }
    }
    host.append(card);
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildArgs() {
  const args = [
    '--game-id',
    $('gameId').value.trim(),
    '--channel',
    $('channel').value.trim(),
    '--version',
    $('version').value.trim(),
    '--build-number',
    $('buildNumber').value.trim(),
    '--executable',
    $('executable').value.trim(),
    '--input-dir',
    $('inputDir').value.trim(),
  ];
  const dirs = {
    windows: $('winDir').value.trim(),
    macos: $('macDir').value.trim(),
    linux: $('linuxDir').value.trim(),
  };
  for (const [platform, dir] of Object.entries(dirs)) {
    if (dir) args.push('--platform', `${platform}=${dir}`);
  }
  return args;
}

async function refresh() {
  const status = $('status');
  try {
    const res = await fetch('/api/inventory');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    renderDrift(data.drift);
    renderInventory(data.inventory);
    status.textContent = 'connected';
    status.classList.add('ok');
  } catch (err) {
    status.textContent = String(err.message ?? err);
    status.classList.add('bad');
  }
}

$('preview').addEventListener('click', () => {
  const out = $('previewOut');
  out.hidden = false;
  out.textContent = ['node scripts/publish-game.mjs', ...buildArgs()]
    .map((a) => (a.includes(' ') ? `"${a}"` : a))
    .join(' ');
});

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await stream('/api/publish', { args: buildArgs() }, 'log');
  refresh();
});

$('publishCatalog').addEventListener('click', async () => {
  await stream('/api/catalog', {}, 'catalogLog');
});

$('pruneForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const confirm = $('pruneConfirm').checked;
  if (
    confirm &&
    !window.confirm(`Permanently delete all but the newest ${$('pruneKeep').value} builds?`)
  ) {
    return;
  }

  await stream(
    '/api/prune',
    {
      gameId: $('pruneGameId').value.trim(),
      channel: $('pruneChannel').value.trim(),
      keep: $('pruneKeep').value.trim(),
      confirm,
    },
    'pruneLog'
  );

  $('pruneConfirm').checked = false;
  refresh();
});

/**
 * Every command this project uses, rendered as a copyable reference so nobody
 * has to memorise them or keep notes elsewhere.
 *
 * Held as data rather than prose so each entry stays next to the description of
 * what it does, and each names the npm script the forms above mirror.
 */
const COMMANDS = [
  {
    group: 'Launcher releases',
    items: [
      {
        cmd: 'npm run release',
        about: 'Bump patch, tag, push. Triggers the CI build for all three platforms.',
        hint: 'Also: -- minor | major | 0.2.0-beta.1 | --dry-run',
      },
      {
        cmd: 'npm run release:publish -- --tag v0.1.0 --confirm',
        about: 'Upload the built, signed launcher to R2. Dry run without --confirm.',
      },
      { cmd: 'npm run keys:check', about: 'Prove the signing key works and the pubkey is synced.' },
      {
        cmd: 'npm run keys:generate',
        about: 'New signing keypair. Refuses to overwrite an existing one.',
      },
      {
        cmd: 'npm run sync:updater-key',
        about: 'Copy updater.pub into tauri.conf.json. Runs before builds.',
      },
      { cmd: 'npm run tauri:build', about: 'Local signed build. ~5 minutes on Windows.' },
      { cmd: 'npm run tauri:dev', about: 'Run the launcher in dev mode.' },
    ],
  },
  {
    group: 'Game builds',
    items: [
      {
        cmd: 'npm run publish:game -- --game-id pandawan-rising --channel alpha --version 1.2.0 --build-number 102 --executable "Game.exe" --name "Pandawan Rising" --input-dir ./Builds',
        about: 'Upload a game build and make it visible to the launcher.',
      },
      {
        cmd: 'npm run publish:catalog',
        about: 'Upload catalog.json and news. New games stay invisible until this runs.',
      },
      {
        cmd: 'npm run prune:builds -- --game-id pandawan-rising --keep 3',
        about: 'Delete all but the 3 newest builds. Dry run unless --yes.',
        hint: 'Pinned versions are never deleted.',
      },
      {
        cmd: 'npm run backfill:latest',
        about: 'Rewrite latest.json from what is already in the bucket.',
      },
      { cmd: 'npm run dashboard', about: 'Open this dashboard.' },
    ],
  },
  {
    group: 'Checks',
    items: [
      { cmd: 'npm test', about: 'Frontend unit tests.' },
      { cmd: 'npm run lint', about: 'ESLint.' },
      { cmd: 'npm run build', about: 'Typecheck and production frontend build.' },
      { cmd: 'npm run format:check', about: 'Prettier check.' },
      { cmd: 'npm run format', about: 'Apply Prettier.' },
      {
        cmd: 'cd src-tauri; cargo test',
        about: 'Rust tests, including the updater signing checks.',
      },
    ],
  },
  {
    group: 'Troubleshooting in CI',
    items: [
      {
        cmd: 'gh run list --workflow=release.yml',
        about: 'Recent release builds and whether they passed.',
      },
      { cmd: 'gh run view <id> --log-failed', about: 'Read why a CI step failed.' },
      {
        cmd: 'gh run rerun <id> --failed',
        about: 'Re-run only the failed steps.',
        hint: 'Uses the tagged commit, not main — check the fix is in the tag.',
      },
      {
        cmd: 'gh secret list',
        about: 'Secret names and when they were set. Values are never shown.',
      },
      {
        cmd: 'gh workflow run release.yml -f publish_only=true -f tag=v0.1.0',
        about: 'Re-publish to R2 from CI without rebuilding. ~30 seconds.',
      },
    ],
  },
];

/** Copy text and confirm it, falling back to a selection when clipboard is blocked. */
async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.textContent;
    button.textContent = 'copied';
    setTimeout(() => {
      button.textContent = original;
    }, 1200);
  } catch {
    // Clipboard needs a secure context or permission. Selecting the text is a
    // working fallback rather than failing silently.
    const range = document.createRange();
    range.selectNodeContents(button.previousElementSibling);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function renderCommands(filter = '') {
  const host = document.getElementById('cmdList');
  host.textContent = '';
  const needle = filter.trim().toLowerCase();

  for (const group of COMMANDS) {
    const items = group.items.filter(
      (item) =>
        !needle || `${item.cmd} ${item.about} ${item.hint ?? ''}`.toLowerCase().includes(needle)
    );
    if (!items.length) continue;

    const section = document.createElement('section');
    section.className = 'cmd-group';

    const heading = document.createElement('h3');
    heading.textContent = group.group;
    section.append(heading);

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'cmd';

      const code = document.createElement('code');
      code.className = 'mono';
      code.textContent = item.cmd;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy';
      button.textContent = 'copy';
      button.addEventListener('click', () => copy(item.cmd, button));

      const about = document.createElement('p');
      about.className = 'meta';
      about.textContent = item.about;

      row.append(code, button);
      section.append(row, about);

      if (item.hint) {
        const hint = document.createElement('p');
        hint.className = 'meta hint';
        hint.textContent = item.hint;
        section.append(hint);
      }
    }
    host.append(section);
  }

  if (!host.children.length) {
    const empty = document.createElement('p');
    empty.className = 'meta';
    empty.textContent = 'No commands match that.';
    host.append(empty);
  }
}

document.getElementById('cmdFilter')?.addEventListener('input', (event) => {
  renderCommands(event.target.value);
});

renderCommands();
/** POST a verb, write its output stream into the given log element. */
async function stream(url, body, logId) {
  const log = $(logId);
  log.hidden = false;
  log.textContent = '';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      if (/^event: output$/m.test(frame))
        log.textContent += /^data: ([\s\S]*)$/m.exec(frame)?.[1] ?? '';
    }
  }
}

// --- Launcher ---------------------------------------------------------

/** Show what players currently get, and offer the tags that exist to publish. */
async function refreshLauncher() {
  const box = $('launcherState');
  try {
    const data = await (await fetch('/api/launcher/status')).json();
    if (data.error) throw new Error(data.error);

    box.textContent = '';

    const current = data.published
      ? `v${data.published.version} — ${data.published.targets.length} targets, ${data.published.artifactCount} installers`
      : 'nothing published yet';

    box.append(el('span', 'tag ok', 'live'));
    box.append(el('span', 'meta', `  players get ${current}`));
    box.append(el('span', 'meta', `  ·  repo is at v${data.packageVersion}`));

    // Offer the tags that exist but are not the published version: those are
    // exactly the ones waiting for a publish.
    const options = $('tagOptions');
    options.textContent = '';
    for (const release of data.releases ?? []) {
      if (data.published && release.tagName === `v${data.published.version}`) continue;
      const option = document.createElement('option');
      option.value = release.tagName;
      options.append(option);
    }

    if (!$('launcherTag').value && options.firstChild) {
      $('launcherTag').value = options.firstChild.value;
    }
  } catch (err) {
    box.textContent = String(err.message ?? err);
  }
}

$('launcherForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const confirm = $('launcherConfirm').checked;
  if (confirm && !window.confirm('Upload this launcher to R2? Players will see it immediately.')) {
    return;
  }
  await stream(
    '/api/launcher/publish',
    { tag: $('launcherTag').value.trim(), confirm },
    'launcherLog'
  );
  $('launcherConfirm').checked = false;
  refreshLauncher();
});

$('launcherKeys')?.addEventListener('click', async () => {
  await stream('/api/launcher/keys', {}, 'launcherLog');
});

$('releaseRun')?.addEventListener('click', async () => {
  const dryRun = $('releaseDryRun').checked;
  if (!dryRun && !window.confirm('Bump the version, commit and push a tag? This triggers CI.')) {
    return;
  }
  await stream('/api/launcher/release', { level: $('releaseLevel').value, dryRun }, 'releaseLog');
  refreshLauncher();
});

refreshLauncher();
refresh();
