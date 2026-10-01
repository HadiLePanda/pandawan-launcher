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
  box.textContent = '';
  // Colour alone would fail for colour-blind users, so the banner keeps a glyph
  // and the word "out of sync" as well.
  box.append(el('span', 'drift-mark', '!'));
  box.append(el('span', 'drift-label', 'out of sync'));

  // Name the mismatched versions rather than only the channel. Knowing that
  // "misspell alpha" drifted is half the answer; seeing that macOS is on 0.4.0
  // while Windows is on 0.4.1 is the other half, and it is already in the
  // payload, so the banner shows it instead of sending the reader to the grid.
  for (const item of drift) {
    const line = el('span', 'drift-item');
    line.append(el('span', 'mono drift-game', `${item.gameId}/${item.channel}`));
    for (const [platform, entry] of Object.entries(item.versions ?? {})) {
      line.append(el('span', 'mono drift-version', `${platform} ${entry.version}`));
    }
    box.append(line);
  }
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

/** The most recent inventory payload, kept so a click on a row can be resolved
 *  later without the row closing over a copy of the whole dataset. */
let lastInventory = [];

function renderInventory(inventory) {
  const host = $('inventory');
  host.textContent = '';
  lastInventory = inventory;

  if (!inventory.length) {
    const empty = el('div', 'empty');
    empty.append(el('strong', null, 'Nothing published yet.'));
    empty.append(
      el('span', 'meta', 'Publish a build from the Games tab and it will show up here.')
    );
    host.append(empty);
    return;
  }

  // One row per channel, one cell per platform. A grid rather than a table so
  // the three platforms line up across channels and can be compared by eye
  // without reading down a column of repeated platform names.
  const grid = el('div', 'inv');

  const head = el('div', 'inv-row inv-head');
  head.append(el('div', 'inv-game', 'Game'));
  for (const platform of PLATFORMS) {
    head.append(el('div', `inv-cell inv-${platform}`, platform));
  }
  grid.append(head);

  for (const game of inventory) {
    for (const channel of game.channels) {
      const latest = channel.latest ?? {};
      const behind = compare(Object.values(latest).map((e) => e.version));

      const row = el('div', 'inv-row');
      if (behind) row.classList.add('inv-warn');

      // Clicking a row jumps to the publish form with the game and channel
      // already filled in. Publishing is the reason this page exists, and
      // retyping the two identifiers that are visible right here was the most
      // repetitive part of the old flow.
      row.classList.add('inv-link');
      row.tabIndex = 0;
      row.title = `Publish another ${game.id} build`;
      const go = () => prefillPublish(game.id, channel.channel);
      row.addEventListener('click', go);
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        go();
      });

      const label = el('div', 'inv-game');
      label.append(el('span', 'inv-name', game.id));
      label.append(el('span', 'inv-channel', channel.channel));
      label.append(el('span', 'inv-go', 'publish →'));
      row.append(label);

      for (const platform of PLATFORMS) {
        const entry = latest[platform];
        const cell = el('div', `inv-cell inv-${platform}`);

        if (!entry) {
          // Absent is shown by absence. A "none" badge in every empty cell is
          // repeated text saying nothing; the empty cell already says it, and
          // the platform headings above show what was expected here.
          cell.classList.add('is-empty');
          row.append(cell);
          continue;
        }

        // Only a platform that is actually behind gets marked. Marking the
        // healthy ones the same way made the eye work to find the one row that
        // mattered, which is the opposite of what the colour is for.
        const isBehind = behind && entry.version === behind;
        if (isBehind) cell.classList.add('is-behind');
        cell.append(el('span', 'mono inv-version', entry.version));
        cell.append(el('span', 'inv-build', `#${entry.build}`));
        cell.append(el('span', 'inv-when', ago(channel.updated?.[platform])));
        row.append(cell);
      }

      grid.append(row);
    }
  }

  host.append(grid);
}

/**
 * Send the user to the publish form with the game and channel filled in.
 *
 * The version is left blank on purpose: it has to be a new number, and
 * pre-filling it with the current one is the easiest way to publish a duplicate.
 */
function prefillPublish(gameId, channel) {
  $('gameId').value = gameId;
  $('channel').value = channel;

  // Always recompute the suggested version. It used to be applied only when the
  // field was empty, so after one publish the field kept the number just used
  // and the next click-to-publish offered the same version again: clicking a
  // different game to redo it looked broken unless you cleared the field by hand.
  const current = inventoryVersion(gameId, channel);
  if (current) {
    const parts = current.split('-')[0].split('.').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      parts[2] += 1;
      $('version').value = parts.join('.');
    }
  }

  // The build number is a per-game counter, so the next one is whatever is
  // published now plus one, and the executable name follows the game.
  const entry = inventoryEntry(gameId, channel);
  if (entry?.build) {
    const build = Number(entry.build);
    if (Number.isFinite(build)) $('buildNumber').value = String(build + 1);
  }
  $('executable').value = `${gameId}.exe`;

  // Platform directories describe local build output and cannot be inferred.
  // Leaving the previous game's paths in place would publish this game's files
  // from another game's folder, so clear them and make the user choose.
  for (const id of ['winDir', 'macDir', 'linuxDir', 'inputDir']) {
    $(id).value = '';
  }

  selectTab('games');
  $('version').focus();
  $('version').select();
}

/**
 * The current build entry for a channel, preferring the platform with the
 * highest build number. Used to suggest the next build: the counters can differ
 * per platform, and offering the lowest one risks republishing over a build that
 * already exists.
 */
function inventoryEntry(gameId, channel) {
  const game = lastInventory.find((g) => g.id === gameId);
  const entry = game?.channels.find((c) => c.channel === channel);
  const entries = Object.values(entry?.latest ?? {}).filter(Boolean);
  if (!entries.length) return null;
  return entries.reduce((a, b) => (Number(a.build) >= Number(b.build) ? a : b));
}

/** The newest version published for a channel, across whichever platforms have one. */
function inventoryVersion(gameId, channel) {
  const game = lastInventory.find((g) => g.id === gameId);
  const entry = game?.channels.find((c) => c.channel === channel);
  const versions = Object.values(entry?.latest ?? {})
    .map((e) => e.version)
    .filter(Boolean);

  // Compare numerically per component rather than as strings: a plain sort puts
  // "0.4.10" before "0.4.9" and would suggest bumping the wrong one.
  const newest = versions.reduce((best, v) => {
    if (!best) return v;
    const a = best.split('-')[0].split('.').map(Number);
    const b = v.split('-')[0].split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const diff = (a[i] ?? 0) - (b[i] ?? 0);
      if (diff !== 0) return diff > 0 ? best : v;
    }
    return best;
  }, null);

  return newest;
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

/** A number with its unit underneath it, so the magnitude reads before the word. */
function fact(value, label) {
  const item = el('div', 'fact');
  item.append(el('span', 'fact-value', value));
  item.append(el('span', 'fact-label', label));
  return item;
}

/** Show what players currently get, and offer the tags that exist to publish. */
async function refreshLauncher() {
  const box = $('launcherState');
  try {
    const data = await (await fetch('/api/launcher/status')).json();
    if (data.error) throw new Error(data.error);

    box.textContent = '';

    // The version ladder: repo, what is published, and what is waiting between
    // them, shown as three positions on one scale. This was a sentence reading
    // "players get v0.1.0 ... repo is at v0.1.0", which made the reader assemble
    // the comparison themselves. Rendering both versions adjacent to each other
    // shows the one fact that matters - whether they differ - at a glance.
    const ladder = el('div', 'ladder');

    const rung = (label, value, state) => {
      const item = el('div', `rung rung-${state}`);
      item.append(el('span', 'rung-label', label));
      item.append(el('span', 'mono rung-value', value));
      return item;
    };

    ladder.append(rung('repo', `v${data.packageVersion}`, 'repo'));
    ladder.append(rung('live', data.published ? `v${data.published.version}` : 'none', 'live'));

    // Only present the third rung when there is a gap. When repo and live match
    // there is nothing to say, and an empty "pending" rung would imply one.
    const pending = (data.releases ?? []).filter(
      (r) => !data.published || r.tagName !== `v${data.published.version}`
    );
    if (pending.length) {
      ladder.append(rung('waiting', pending.map((r) => r.tagName).join(' '), 'pending'));
    }

    box.append(ladder);

    // Artifact count as a tally rather than a clause inside a sentence.
    if (data.published) {
      const facts = el('div', 'facts');
      facts.append(fact(String(data.published.targets.length), 'targets'));
      facts.append(fact(String(data.published.artifactCount), 'installers'));
      box.append(facts);
    }

    // Offer the tags that exist but are not the published version: those are
    // exactly the ones waiting for a publish.
    const options = $('tagOptions');
    options.textContent = '';
    for (const release of pending) {
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
