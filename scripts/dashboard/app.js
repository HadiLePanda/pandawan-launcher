const PLATFORMS = ['windows', 'macos', 'linux'];
const $ = (id) => document.getElementById(id);

// --- Drafts ---------------------------------------------------------------
//
// Half-finished edits used to live only in the inputs, so a reload - or a crash,
// or an accidental tab close - lost them silently. Each editor now keeps its
// in-progress values in localStorage under a key that names the target being
// edited, because a draft for one game is a lie on another and reusing one key
// for everything would restore an edit into the wrong form.
//
// The keys are built here and nowhere else, so "what does this page remember" is
// one grep rather than a hunt through the file. Every draft is an envelope
// (savedAt, target, values) rather than a bare value object: the resume path
// needs to know which game an unread key belonged to, and asking the key to carry
// that would mean parsing an id that may itself contain dots.
const DRAFT_KEYS = {
  meta: (gameId, channel) => `pandawan.draft.meta.${gameId}.${channel || 'alpha'}`,
  news: (itemId) => `pandawan.draft.news.${itemId || 'new'}`,
};

/** Prefixes for the resume scan, which walks every key rather than a known list. */
const DRAFT_SCAN = { meta: 'pandawan.draft.meta.', news: 'pandawan.draft.news.' };

// Reached through `window` on purpose. This file is linted with an explicit list
// of browser globals (see eslint.config.js) so that a typo cannot slip in
// unnoticed, and that list names `window` rather than `localStorage`; going
// through window uses the same object without widening the lint surface.
const STORE = window.localStorage;

function storeRead(key) {
  try {
    return STORE.getItem(key);
  } catch {
    // Private-mode and disabled-storage profiles throw on access rather than
    // returning null. Drafts are a convenience, so failing to read one must never
    // be the thing that breaks the editor.
    return null;
  }
}

function storeWrite(key, value) {
  try {
    STORE.setItem(key, value);
  } catch {
    /* Storage full or blocked: the edit still works, it just will not survive. */
  }
}

function storeRemove(key) {
  try {
    STORE.removeItem(key);
  } catch {
    /* As above. */
  }
}

/** Read one draft envelope, or null when absent, unparseable or stale-typed. */
function readDraft(key) {
  const raw = storeRead(key);
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw);
    return draft && typeof draft === 'object' ? draft : null;
  } catch {
    return null;
  }
}

/**
 * The most recently saved draft under a prefix.
 *
 * A reload has to land on the edit that was in progress, and which one that was
 * is only knowable by timestamp: there is no "current" key, because the whole
 * point is that a draft for a game the operator has not opened yet is still
 * there. Returns null when there is nothing to resume.
 */
function newestDraft(prefix) {
  let best = null;
  let bestAt = -Infinity;
  for (let i = 0; i < STORE.length; i++) {
    const key = STORE.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    const draft = readDraft(key);
    const at = Number(draft?.savedAt ?? 0);
    if (at > bestAt) {
      best = draft;
      bestAt = at;
    }
  }
  return best;
}

// --- Versions -------------------------------------------------------------
//
// One comparison for every "which is newer" question on this page. It used to
// exist twice: the metrics card took versions.at(-1) off a plain string sort,
// which orders 0.4.10 before 0.4.9, while the publish form compared component by
// component and correctly suggested 0.4.11. The card and the suggestion then
// disagreed about the same data, so both now call this.

/** Split a version into numeric components and its prerelease suffix. */
function splitVersion(version) {
  const parts = String(version ?? '').split('-');
  const core = parts
    .shift()
    .split('.')
    .map((part) => (Number.isFinite(Number(part)) ? Number(part) : 0));
  return [core, parts.join('-')];
}

/** Negative, zero or positive: a is older than b, the same, or newer. */
function compareVersions(a, b) {
  const [aCore, aPre] = splitVersion(a);
  const [bCore, bPre] = splitVersion(b);
  for (let i = 0; i < Math.max(aCore.length, bCore.length); i++) {
    const diff = (aCore[i] ?? 0) - (bCore[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // Same numbers, so the prerelease decides - and a release outranks its own
  // prereleases, which is what makes 0.4.11 newer than 0.4.11-alpha.1. Two
  // prereleases of the same version fall back to text order, which only has to be
  // consistent, not clever.
  if (aPre === bPre) return 0;
  if (!aPre) return 1;
  if (!bPre) return -1;
  return aPre < bPre ? -1 : 1;
}

/** The newest of a list of version strings, or null when the list is empty. */
function newestVersion(versions) {
  return versions
    .filter(Boolean)
    .reduce((best, v) => (!best || compareVersions(v, best) > 0 ? v : best), null);
}

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

  setPage(name);
  watchServices(name === 'services');

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
  // Not while typing. A caret in the game id box moves the whole page's section
  // when you press Left or Right to fix a typo, which is both a wrong-page
  // surprise and a half-finished form left on another tab.
  const target = event.target;
  if (target instanceof window.HTMLInputElement || target instanceof window.HTMLTextAreaElement)
    return;
  const tabs = [...document.querySelectorAll('.tab')];
  const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
  if (current === -1) return;

  const step = event.key === 'ArrowRight' ? 1 : -1;
  const next = tabs[(current + step + tabs.length) % tabs.length];
  selectTab(next.dataset.tab);
  next.focus();
});

// --- Games sub-tabs -----------------------------------------------------
//
// The Games page did four unrelated jobs in one scroll: publish a build, prune
// builds, republish the catalog, edit metadata. Separate tasks with separate
// risks - one of them deletes things - so they are separate panels now.
//
// This mirrors selectTab() deliberately rather than inventing a second pattern:
// same aria-selected, same roving tabindex, same arrow-key handling, so the two
// strips behave identically and one mental model covers both. The panels are
// already in the DOM, so switching is attribute work.
//
// Persisted in localStorage rather than the hash on purpose. The top-level hash
// is a single bare name (#games) and the app already owns its parsing; folding a
// second segment in there would mean every existing bookmark and every hashchange
// listener had to learn a new grammar to describe one piece of state.

const SUBTAB_KEY = 'pandawan.subtab.games';

function selectSubtab(name, { push = true } = {}) {
  const tabs = [...document.querySelectorAll('.subtab')];
  if (!tabs.length) return;
  const target = tabs.some((tab) => tab.dataset.subtab === name) ? name : tabs[0].dataset.subtab;

  for (const tab of tabs) {
    const selected = tab.dataset.subtab === target;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of document.querySelectorAll('.subpanel')) {
    panel.hidden = panel.dataset.subpanel !== target;
  }

  if (push) storeWrite(SUBTAB_KEY, target);
}

for (const tab of document.querySelectorAll('.subtab')) {
  tab.addEventListener('click', () => selectSubtab(tab.dataset.subtab));
}

// The summary sentence in each review panel names what happens on publish, and
// that depends on whether preview-only is ticked. The box itself is unchanged
// either way, so only the sentence has to be re-rendered.
$('metaDryRun')?.addEventListener('change', renderMetaDirtyCount);
$('newsDryRun')?.addEventListener('change', renderNewsDirtyCount);

// Scoped to the sub-strip: the handler above owns arrow keys for the top-level
// tablist, and one document listener cannot tell which strip it was called for
// without asking the event where it started.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
  if (!event.target?.classList?.contains('subtab')) return;

  const tabs = [...document.querySelectorAll('.subtab')];
  const current = tabs.indexOf(event.target);
  if (current === -1) return;

  event.preventDefault();
  const step = event.key === 'ArrowRight' ? 1 : -1;
  const next = tabs[(current + step + tabs.length) % tabs.length];
  selectSubtab(next.dataset.subtab);
  next.focus();
});

// Read once at load, and it defaults to the first panel in the markup. A stale
// value naming a panel that no longer exists falls back the same way, because
// selectSubtab() validates against the tabs that are actually on the page.
selectSubtab(storeRead(SUBTAB_KEY) ?? 'builds', { push: false });

const PAGES = {
  overview: ['Overview', 'What is published, and where the platforms disagree.'],
  games: ['Games', 'Publish a build, prune old ones, or edit what a game shows.'],
  news: ['News', 'The launcher news feed, edited item by item.'],
  launcher: ['Launcher', 'The version players are downloading, and what is queued.'],
  services: ['Services', 'Local dev servers, started and stopped from here.'],
  commands: ['Commands', 'Every command this project uses, copyable.'],
};

// Declared here, not next to watchServices() further down: selectTab() runs at
// load and calls watchServices(), which touches this. A let further down would
// still be in its temporal dead zone at that moment and would throw on load.
let serviceTimer = null;

function setPage(name) {
  const page = PAGES[name] ?? PAGES.overview;
  $('pageTitle').textContent = page[0];
  $('pageSub').textContent = page[1];
}

/** One metric card: label, number, qualifier, and the recessed strip. */
function metric(label, value, opts) {
  const o = opts ?? {};
  const card = el('div', 'metric' + (o.tone ? ' is-' + o.tone : ''));
  const top = el('div', 'metric-top');
  const labels = el('div');
  labels.append(el('div', 'metric-label', label));
  if (o.sub) labels.append(el('div', 'metric-sub', o.sub));
  top.append(labels, el('div', 'metric-value', value));
  card.append(top);
  if (o.strip) card.append(el('div', 'metric-strip', o.strip));
  return card;
}

function renderMetrics(inventory, drift) {
  const host = $('metrics');
  if (!host) return;
  host.textContent = '';

  const channels = inventory.reduce((n, g) => n + g.channels.length, 0);
  const platforms = new Set();
  const versions = [];
  for (const g of inventory) {
    for (const c of g.channels) {
      for (const p of c.platforms ?? []) platforms.add(p);
      for (const e of Object.values(c.latest ?? {})) if (e.version) versions.push(e.version);
    }
  }
  // Numeric, not lexicographic: "0.4.10" sorts before "0.4.9" as text, so a plain
  // versions.sort() named the older build as the newest one on the page.
  const newest = newestVersion(versions);

  host.append(
    metric('Games', String(inventory.length), {
      sub: channels + ' channel' + (channels === 1 ? '' : 's'),
      strip: inventory.length ? inventory.map((g) => g.id).join(', ') : 'nothing published yet',
    })
  );

  host.append(
    metric('Platforms live', String(platforms.size), {
      sub: 'of 3 possible',
      strip: [...platforms].sort().join(' · ') || 'none',
    })
  );

  host.append(
    metric('Out of sync', String(drift.length), {
      sub: drift.length ? 'needs a publish' : 'all aligned',
      strip: drift.length ? drift.map((d) => d.gameId).join(', ') : 'every channel agrees',
      tone: drift.length ? 'alert' : 'good',
    })
  );

  host.append(
    metric('Newest version', newest ?? '—', {
      sub: 'across all channels',
      strip: newest ? 'latest build on any platform' : 'publish a build to see this',
    })
  );
}

// --- Local dev services -------------------------------------------------
//
// One list, polled only while the Services tab is visible. Polling a hidden
// tab would keep five TCP connects running for a page nobody is looking at.

const STATE_LABELS = {
  running: 'running here',
  external: 'running elsewhere',
  stopped: 'stopped',
  failed: 'exited',
};

function renderServices(services) {
  const host = $('services');
  if (!host) return;
  host.textContent = '';

  for (const service of services) {
    const row = el('div', 'svc');
    if (service.up) row.classList.add('up');

    const name = el('div', 'svc-name');
    name.append(el('span', 'dot'));
    name.append(el('span', null, service.name));
    row.append(name);

    let key = 'stopped';
    if (!service.up && service.log) key = 'failed';
    else if (service.up) key = service.ours ? 'running' : 'external';

    row.append(el('div', 'svc-note', service.note));
    row.append(el('div', 'svc-state is-' + key, STATE_LABELS[key]));
    // A `bat` service prints into its own window, so naming the port here would
    // send the user looking for output that is not on this page.
    row.append(
      el(
        'div',
        'svc-meta',
        service.url ?? (service.opened ? 'opens its own window' : 'port ' + service.port)
      )
    );

    if (service.log) row.append(el('pre', 'svc-log', service.log));

    const actions = el('div', 'svc-actions');

    if (service.url) {
      const open = el('a', 'open', 'Open');
      open.href = service.url;
      open.target = '_blank';
      open.rel = 'noreferrer';
      open.title = service.up ? '' : 'Nothing is listening on this port yet';
      actions.append(open);
    }

    if (service.ours) {
      const stopBtn = el('button', 'stop', 'Stop');
      stopBtn.addEventListener('click', () => serviceAct('/api/service/stop', service.id, stopBtn));
      actions.append(stopBtn);
    } else if (service.up) {
      // Up, but this dashboard did not start it. Offered because a half-dead
      // tree can leave a process holding the port with nothing left to trace it
      // back to, and hunting for that pid by hand is the chore this list exists
      // to remove.
      const stopBtn = el('button', 'stop', 'Stop it');
      stopBtn.title = service.opened
        ? 'Kill the process holding this port. Its console window stays open and will say the server stopped.'
        : 'Stop the process holding this port, whoever started it';
      stopBtn.addEventListener('click', () =>
        serviceAct('/api/service/force-stop', service.id, stopBtn)
      );
      actions.append(stopBtn);
    } else {
      const startBtn = el('button', 'go', key === 'failed' ? 'Retry' : 'Start');
      startBtn.addEventListener('click', () =>
        serviceAct('/api/service/start', service.id, startBtn)
      );
      actions.append(startBtn);
    }

    row.append(actions);
    host.append(row);
  }
}

async function serviceAct(endpoint, id, button) {
  const previous = button.textContent;
  button.disabled = true;
  button.textContent = 'working';

  try {
    const res = await fetch(endpoint + '?id=' + encodeURIComponent(id), { method: 'POST' });
    const data = await res.json();
    if (!data.ok && data.error) {
      button.textContent = previous;
      button.disabled = false;
      const row = button.closest('.svc');
      row.querySelector('.error')?.remove();
      row.append(el('div', 'error', data.error));
      return;
    }
  } catch {
    button.textContent = previous;
    button.disabled = false;
    return;
  }

  await refreshServices();
}

async function refreshServices() {
  const host = $('services');
  if (!host) return;
  try {
    renderServices(await (await fetch('/api/services')).json());
  } catch (err) {
    host.textContent = String(err.message ?? err);
  }
}

function watchServices(on) {
  clearInterval(serviceTimer);
  serviceTimer = null;
  if (!on) return;
  refreshServices();
  serviceTimer = setInterval(refreshServices, 3000);
}

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

  // Both, in this order: the Games tab, then the Builds sub-panel inside it. The
  // sub-panel remembers itself in localStorage, so an operator who left the page
  // on Metadata would otherwise land in a hidden panel and watch $('version').focus()
  // scroll nowhere - the form they were sent to fill would be invisible.
  selectTab('games');
  selectSubtab('builds');
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

  // The same comparison the metrics card uses. It used to be a second, private
  // copy of this loop, which is how the card came to call 0.4.9 the newest version
  // while this function correctly suggested 0.4.11.
  return newestVersion(versions);
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
    renderMetrics(data.inventory, data.drift);
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
  // A newly published game is invisible in the picker until the list is rebuilt,
  // and the picker is now the main way to select one rather than typing an id.
  renderGamePicker();
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
/**
 * POST a verb and write its output stream into the given log element.
 *
 * The server answers with server-sent events, not a raw stream of text, and only
 * the `output` frames used to be read. A script that failed to spawn, or exited
 * non-zero, therefore produced exactly the same page as one that succeeded: a log
 * that stopped mid-sentence with no verdict on it. Since every destructive verb
 * in this tool - publish, prune, release, news - funnels through here, "did it
 * work" was unanswerable at the only moment the operator was looking for it.
 *
 * `done` carries the child's exit code as JSON, so it is what actually decides
 * success. Returns that code (null when the connection died before a `done`,
 * which is itself a failure worth reporting rather than a silent no-op).
 */
async function stream(url, body, logId) {
  const log = $(logId);
  log.hidden = false;
  log.textContent = '';

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // A refused connection is not a publishing result. Without this the handler
    // would throw inside an async listener and the log would sit empty.
    log.textContent += `Could not reach the dashboard server: ${err.message ?? err}\n`;
    log.textContent += 'FAILED - the request never started.\n';
    return null;
  }

  if (!res.ok && !res.body) {
    log.textContent += `HTTP ${res.status} ${res.statusText}\n`;
    log.textContent += 'FAILED - the server refused the request.\n';
    return null;
  }

  // Not an event stream: a validation error. These endpoints answer operator
  // mistakes (a missing file, an unknown op) with a plain string on purpose, and
  // reading it as SSE would swallow the only useful line in the response.
  if (!String(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const text = (await res.text()).trim();
    log.textContent += text ? `${text}\n` : `HTTP ${res.status}\n`;
    log.textContent += res.ok ? '' : 'FAILED - the server refused the request.\n';
    return res.ok ? 0 : null;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let exitCode = null;
  let spawnError = '';

  const frameData = (frame) => /^data: ([\s\S]*)$/m.exec(frame)?.[1] ?? '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      if (/^event: output$/m.test(frame)) log.textContent += frameData(frame);
      // A spawn failure means the script never ran. Recorded rather than printed
      // inline so the done frame can still say something accurate about the run.
      else if (/^event: error$/m.test(frame)) spawnError = frameData(frame);
      else if (/^event: done$/m.test(frame)) {
        const payload = frameData(frame);
        try {
          const parsed = JSON.parse(payload);
          exitCode = Number.isFinite(Number(parsed?.code)) ? Number(parsed.code) : 0;
        } catch {
          exitCode = 0;
        }
      }
    }
  }

  // Always end on an explicit verdict line. The script's own output is written by
  // the script and may end in a progress line or nothing at all; a reader has to
  // be able to trust that the last line is the answer.
  if (spawnError) {
    log.textContent += `\nThe script could not be started: ${spawnError}\n`;
    log.textContent += 'FAILED - nothing was published.\n';
    return exitCode;
  }
  if (exitCode === null) {
    log.textContent +=
      '\nFAILED - the connection closed before the script reported an exit code.\n';
    return null;
  }
  if (exitCode === 0) {
    log.textContent += '\nFinished with exit code 0.\n';
    return 0;
  }
  // A non-zero code is a signal kill rather than a script failure, and saying
  // "failed" for an interrupt would be wrong.
  if (exitCode < 0 || exitCode === 130) {
    log.textContent += `\nStopped before it finished (exit code ${exitCode}). Nothing was published.\n`;
    return exitCode;
  }
  log.textContent += `\nFAILED - the script exited with code ${exitCode}. Nothing was published.\n`;
  return exitCode;
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

// --- Game metadata -----------------------------------------------------
//
// Edit a published game's presentation without touching the build or
// re-uploading a single game file. The contract implemented here is not
// invented: the field list, the catalog-beats-manifest precedence and the
// absent/empty distinction all come from the server. See
// scripts/lib/metadata-fields.mjs (FIELDS, IMAGE_FIELDS) and
// scripts/lib/game-metadata.mjs (readGameMetadata), which backs /api/meta.
//
// FIELD_ORDER mirrors the order of FIELDS in metadata-fields.mjs. The API
// returns fields as an object keyed by flag and carries no order, but a form
// whose fields reshuffle between loads is unusable, so the sequence is pinned
// here deliberately. Labels are NOT hardcoded - each field's own `label` from
// the response is used, so a rename in the contract shows up without touching
// this file.
const FIELD_ORDER = [
  'name',
  'description',
  'developer',
  'genre',
  'icon-url',
  'banner-url',
  'screenshots',
  'supported-platforms',
  'available-channels',
];

// The two fields that also accept an artwork upload, and the payload key the
// server reads each from. Mirrors IMAGE_FIELDS in metadata-fields.mjs.
const IMAGE_INPUTS = {
  'icon-url': 'iconFile',
  'banner-url': 'bannerFile',
};

/**
 * The published artwork objects for the loaded game, newest first.
 *
 * Held separately from metaState because it is not part of the form: nothing here
 * is editable, and it is refetched after a publish rather than recomputed, since
 * the bucket is the only thing that knows what a content-addressed upload is
 * actually called.
 */
const artState = { objects: [] };

const SOURCE_TEXT = {
  catalog: 'from catalog',
  manifest: 'inherited from manifest',
  empty: 'not set',
};

/**
 * The loaded game plus the values as they were when loaded.
 *
 * `original` is the comparison baseline, not just the rendered starting point:
 * publish sends only what changed, because the server treats an absent key as
 * "leave whatever is published". Sending the whole form would silently
 * overwrite fields the operator never touched.
 */
const metaState = { gameId: '', channel: '', exists: false, original: {}, inputValues: {} };

/** Split a comma list the way the publisher does, so "a, b" == "a,b". */
function normaliseList(value) {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The typed local artwork path for an image field, or '' when there is none. */
function metaImagePath(flag) {
  return String(metaState.inputValues[IMAGE_INPUTS[flag]] ?? '').trim();
}

/** A field is changed when its trimmed text differs from what was loaded. */
function metaIsDirty(flag) {
  if (!(flag in metaState.original)) return false;
  const field = metaState.original[flag];
  const now = metaState.inputValues[flag] ?? '';
  if (field.list) {
    const next = normaliseList(now);
    const previous = normaliseList(field.value);
    // An emptied list is not reportable as a change. The server skips an emptied
    // list field - a comma list cannot express "no genres" - so counting it would
    // promise an edit that then publishes nothing at all.
    if (!next.length && previous.length) return false;
    return next.join(' ') !== previous.join(' ');
  }
  return now.trim() !== String(field.value ?? '').trim();
}

/**
 * Whether an image field counts as changed.
 *
 * A typed local path is a real edit even though the URL box beside it is
 * untouched, because the server uploads the file and rewrites the URL itself.
 * Without this the path is silently dropped on publish, because metaIsDirty
 * only ever reads the URL text.
 */
function metaImageIsDirty(flag) {
  if (!IMAGE_INPUTS[flag]) return metaIsDirty(flag);
  return metaImagePath(flag) !== '' || metaIsDirty(flag);
}

function metaDirtyFlags() {
  return FIELD_ORDER.filter(metaImageIsDirty);
}

// --- Unsaved work ----------------------------------------------------------
//
// Two things the page has to get right about half-finished edits: it must not lose
// them, and it must not let them look published. The dirty bar is the in-page
// statement of the second - a persistent strip saying an edit is uncommitted -
// and the beforeunload guard is the browser's. The bar is not redundant with the
// prompt: a prompt only appears when you try to leave, by which point the edit is
// already at risk.

/** The key this editor's draft lives under right now, or '' when nothing is loaded. */
function metaDraftKey() {
  return metaState.gameId ? DRAFT_KEYS.meta(metaState.gameId, metaState.channel) : '';
}

/** Remember the in-progress values for the loaded game. */
function saveMetaDraft() {
  const key = metaDraftKey();
  if (!key || !metaState.exists) return;
  // Nothing changed, so there is nothing to remember. Writing anyway would keep
  // resurrecting a draft that says "unsaved changes" over a form with none.
  if (!metaDirtyFlags().length) {
    clearMetaDraft();
    return;
  }
  storeWrite(
    key,
    JSON.stringify({
      savedAt: Date.now(),
      // Carried in the envelope as well as implied by the key: the resume banner
      // has to name what the draft is for without parsing an id that may itself
      // contain dots.
      target: `${metaState.gameId} / ${metaState.channel}`,
      gameId: metaState.gameId,
      channel: metaState.channel,
      values: metaState.inputValues,
    })
  );
}

function clearMetaDraft() {
  const key = metaDraftKey();
  if (key) storeRemove(key);
  showDraftNote($('metaDraftNote'), null);
}

/**
 * Tell the operator their draft came back, and offer to throw it away.
 *
 * Restoring is invisible by nature - the form simply holds the values it would
 * have held anyway - so without this the draft is indistinguishable from data
 * that was always there, and an operator comparing "before" against "after" in
 * the diff would be comparing the wrong before. The button removes the stored copy
 * and reverts the form to what is actually published.
 */
function showDraftNote(box, draft) {
  if (!box) return;
  // Defaulted, not destructured in the signature: clearing a draft passes null,
  // and a destructured parameter would throw on exactly the path that hides the
  // banner again.
  const { target, at, onDiscard } = draft ?? {};
  if (!target) {
    box.hidden = true;
    box.textContent = '';
    return;
  }

  box.textContent = '';
  const when = at ? new Date(at).toLocaleString() : 'an earlier session';
  box.append(
    el(
      'span',
      null,
      `Unsaved draft restored for ${target}, saved ${when}. It is not published - review the diff before you publish.`
    )
  );

  const discard = el('button', 'draft-clear', 'Discard draft');
  discard.type = 'button';
  discard.addEventListener('click', onDiscard);
  box.append(discard);
  box.hidden = false;
}

/** Whether either editor currently holds an uncommitted edit. */
function anyDirty() {
  return metaDirtyFlags().length > 0 || newsDirtyFields().length > 0 || newsImagePath() !== '';
}

/**
 * The persistent in-page dirty indicator.
 *
 * Both editors contribute to one answer, because the operator only sees one page:
 * a form on a hidden sub-panel is still an edit that would be lost, and a bar that
 * only watched the visible panel would say "clean" while an edit sat waiting.
 */
function updateDirtyBar() {
  const metaCount = metaDirtyFlags().length;
  const newsCount = newsDirtyFields().length + (newsImagePath() ? 1 : 0);

  for (const [id, label, count] of [
    ['metaDirtyBar', 'game metadata', metaCount],
    ['newsDirtyBar', 'news', newsCount],
  ]) {
    const bar = $(id);
    if (!bar) continue;
    bar.hidden = count === 0;
    if (!count) {
      bar.textContent = '';
      continue;
    }
    bar.textContent = `${count} unsaved change${count > 1 ? 's' : ''} in ${label}, not published yet.`;
  }
}

/**
 * Offer to resume the edit that was in progress.
 *
 * A draft is only restored when its own game or item is opened, which is correct
 * but leaves the operator with no way back to an edit they have not re-selected -
 * and the case this exists for is precisely the reload where they remember having
 * been mid-way through something. So the newest draft is named up front, with its
 * target and when it was saved, and one click loads it. The draft is left in
 * storage either way: declining a resume is not a decision to delete.
 */
function resumeDraft({ noteId, prefix, label, onResume }) {
  const box = $(noteId);
  if (!box) return;

  const draft = newestDraft(prefix);
  if (!draft?.target) {
    box.hidden = true;
    box.textContent = '';
    return;
  }

  box.textContent = '';
  box.append(
    el(
      'span',
      null,
      `Unsaved ${label} draft for ${draft.target}, saved ${new Date(draft.savedAt).toLocaleString()}. It has not been published.`
    )
  );

  const resume = el('button', 'draft-clear', 'Resume draft');
  resume.type = 'button';
  resume.addEventListener('click', onResume);
  box.append(resume);
  box.hidden = false;
}

window.addEventListener('beforeunload', (event) => {
  // Persist first: the guard must not be the thing that loses the edit it is
  // warning about, and this is the last chance to save it.
  saveMetaDraft();
  saveNewsDraft();
  if (!anyDirty()) return;
  event.preventDefault();
  // The browser ignores this text and shows its own wording, but returning a
  // non-empty value is what makes it show one at all.
  event.returnValue = 'You have unsaved changes that have not been published.';
});

// --- Diff review -----------------------------------------------------------
//
// The form said "changed" but never said what it was about to become, so the only
// way to find out was to publish and read the script's output. This renders the
// same numbers, from the same dirty predicates, so the review cannot disagree with
// what would be sent: metaDirtyFlags() is the single source of truth for "what
// changed" and the publish payload is built from the very list passed here.

/** What a field is about to become, for display in a diff. */
function metaAfterValue(flag) {
  const field = metaState.original[flag];
  const value = metaState.inputValues[flag] ?? '';
  // An image field changed only by a staged file has no new URL yet - the upload
  // rewrites it - so showing the unchanged URL as the "after" would be a lie.
  if (IMAGE_INPUTS[flag] && !metaIsDirty(flag)) return `will upload from ${metaImagePath(flag)}`;
  return field?.list ? normaliseList(value).join(', ') : value.trim();
}

/**
 * One before -> after row, or null when the field would not actually be sent.
 *
 * Returning null rather than rendering an empty row keeps the panel honest about
 * the two rules the publish path also applies: an emptied list is skipped by the
 * server, and an image changed only by a staged file does not resend its URL.
 */
function metaDiffRow(flag) {
  const field = metaState.original[flag];
  if (!field) return null;
  const before = field.list
    ? normaliseList(field.value).join(', ')
    : String(field.value ?? '').trim();
  const after = metaAfterValue(flag);
  // The only case where metaImageIsDirty is true but there is nothing to say here.
  if (before === after) return null;

  const row = el('div', 'diff-row');
  // Cleared is called out in its own class rather than only by an empty "after",
  // because "no description" and "unchanged description" both render as blank
  // columns otherwise.
  if (!after && !IMAGE_INPUTS[flag]) row.classList.add('is-cleared');
  row.append(el('div', 'diff-label', field.label));
  row.append(el('div', 'diff-before', before || '(empty)'));
  row.append(el('div', 'diff-after', after || '(cleared)'));
  return row;
}

/** Render the review panel for the metadata editor. */
function renderMetaDiff() {
  const panel = $('metaDiff');
  const rows = $('metaDiffRows');
  if (!panel || !rows) return;

  const flags = metaDirtyFlags();
  rows.textContent = '';
  panel.hidden = !flags.length;

  const summary = $('metaDiffSummary');
  if (!flags.length) {
    summary.textContent = '';
    return;
  }

  const noun = flags.length === 1 ? 'field' : 'fields';
  const dryRun = $('metaDryRun').checked;
  summary.textContent = dryRun
    ? `${flags.length} ${noun} would be sent in preview only. Nothing is published until you untick Preview only.`
    : `${flags.length} ${noun} will be published to ${metaState.gameId} / ${metaState.channel}. Unticking Preview only and publishing writes to the bucket.`;

  for (const flag of flags) {
    const row = metaDiffRow(flag);
    if (row) rows.append(row);
  }

  // An image staged but not yet uploaded is a real pending change with no text
  // to show, so it is named in the summary rather than dropped from the review.
  const files = Object.values(IMAGE_INPUTS).filter((key) => metaState.inputValues[key]);
  if (files.length) {
    summary.textContent += ` ${files.length} artwork file${files.length > 1 ? 's' : ''} will upload on publish.`;
  }
}

function renderMetaDirtyCount() {
  const count = metaDirtyFlags().length;
  $('metaDirtyCount').textContent = count ? `${count} field${count > 1 ? 's' : ''} changed` : '';
  renderMetaDiff();
  updateDirtyBar();
}

/**
 * Show an image, falling back to text when it cannot be displayed.
 *
 * `onSettled` runs once the browser is finished with the URL — on load or on
 * error, never both. It is what releases a blob: URL handed in from the file
 * picker, which would otherwise stay alive for as long as the form is open.
 */
function metaPreviewInto(box, url, onSettled) {
  box.textContent = '';
  if (!url) {
    box.append(el('span', 'meta-preview-empty', 'no artwork'));
    return;
  }
  const img = document.createElement('img');
  // Guarded rather than called twice: the revoke is not idempotent across every
  // browser, and a load after an error would try it a second time.
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    onSettled?.();
  };
  img.addEventListener('load', settle);
  // The URL is typed by an operator and may well be broken, so a failed load falls
  // back to the placeholder rather than leaving a torn-image icon.
  img.addEventListener('error', () => {
    box.textContent = '';
    box.append(el('span', 'meta-preview-empty', 'cannot load'));
    settle();
  });
  img.src = url;
  img.alt = '';
  box.append(img);
}

/**
 * Send a chosen file to the server and hand back the path it was staged at.
 *
 * A browser cannot hand over an absolute path, so the bytes travel over the same
 * loopback connection the rest of the panel uses and come back as a real path the
 * publisher can upload. Both panels write that path into the same input the typed
 * box uses, which is deliberate: everything downstream - the dirty count, the revert
 * button, the publish payload - then behaves identically whether the file was picked
 * or typed, and neither route is left half-wired.
 *
 * `onStaged` exists because the two forms keep their pending file in different
 * places, but the request, the validation and the "a chosen file supersedes the URL,
 * because the upload rewrites it" rule are identical and are implemented once here.
 *
 * Returns '' when the file was refused; the reason is already in `status`.
 */
async function stageArtwork(file, status, onStaged) {
  // Awaited here, so a read failure surfaces as the same status line the server's
  // own rejections use rather than as a silent no-op that leaves the field clean.
  const read = await fileToBase64(file);
  if (!read) {
    status.textContent = 'that file could not be read';
    return '';
  }

  try {
    const res = await fetch('/api/art/stage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, data: read }),
    });
    // The server answers a validation failure with a plain string on purpose: this is
    // operator error to be read in the form, not a stack trace.
    if (!res.ok) {
      status.textContent = (await res.text()) || `HTTP ${res.status}`;
      return '';
    }
    const staged = await res.json();
    status.textContent = `ready - ${staged.name} will be uploaded on publish`;
    onStaged?.(staged.localPath);
    return staged.localPath;
  } catch (err) {
    status.textContent = String(err.message ?? err);
    return '';
  }
}

/** Read a File as base64, without assuming FileReader or a promise-typed Buffer. */
function fileToBase64(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve('');
    reader.onload = () => {
      // ReadAsDataURL gives "data:image/png;base64,...."; the server wants the
      // payload alone, and trusting a client-supplied MIME type would defeat the
      // extension check it performs.
      resolve(String(reader.result ?? '').split(',')[1] ?? '');
    };
    reader.readAsDataURL(file);
  });
}

/**
 * List the artwork published for the loaded game.
 *
 * Fetched rather than derived from the form, because the field URL is only ever
 * one of these objects: content-addressed names mean a replaced banner leaves the
 * old one in place forever, and the operator needs to see that when cleaning up.
 */
async function loadArtwork() {
  const gameId = metaState.gameId;
  if (!gameId) {
    artState.objects = [];
    return;
  }
  const channel = $('metaChannel').value;
  // The current URLs travel with the request so the server can mark which object
  // each field actually points at.
  const query = new URLSearchParams({ gameId, channel });
  for (const flag of Object.keys(IMAGE_INPUTS)) {
    query.set(flag, metaState.inputValues[flag] ?? '');
  }

  try {
    const res = await fetch(`/api/art?${query}`);
    if (!res.ok) {
      artState.objects = [];
      renderArtworkList();
      return;
    }
    const data = await res.json();
    // A slow response for a game the operator has since switched away from must
    // not overwrite the list for the game now on screen.
    if (metaState.gameId !== gameId) return;
    artState.objects = data.objects ?? [];
  } catch {
    artState.objects = [];
  }
  renderArtworkList();
}

/** Show every published image, labelled with the field using it. */
function renderArtworkList() {
  const box = $('metaArt');
  if (!box) return;
  box.textContent = '';

  const objects = artState.objects;
  if (!objects.length) {
    box.append(el('p', 'meta', 'No artwork is published for this game and channel yet.'));
    return;
  }

  for (const object of objects) {
    const item = el('div', 'meta-art-item');
    if (!object.inUse) item.classList.add('is-unused');

    const thumb = el('div', 'meta-art-thumb');
    const img = document.createElement('img');
    // A 404 here means the object is listed but unreadable, which is worth seeing
    // as a broken thumbnail rather than an empty slot.
    img.addEventListener('error', () => {
      thumb.textContent = '';
      thumb.append(el('span', 'meta-preview-empty', 'cannot load'));
    });
    img.src = object.url;
    img.alt = '';
    thumb.append(img);
    item.append(thumb);

    const info = el('div', 'meta-art-info');
    info.append(el('div', 'meta-art-name', object.name));
    const meta = [object.size, object.lastModified].filter(Boolean).join(' - ');
    if (meta) info.append(el('div', 'meta-art-meta', meta));
    // The bucket records no mapping from object to field, so saying which one is
    // live is the whole point of listing them at all.
    info.append(
      el(
        'div',
        'meta-art-field',
        object.inUse ? `used by ${object.field}` : 'not referenced by any field'
      )
    );
    item.append(info);
    box.append(item);
  }
}

function renderMetaFields(data) {
  const box = $('metaFields');
  box.textContent = '';

  for (const flag of FIELD_ORDER) {
    const field = data.fields[flag];
    // The server merges whatever the contract declares; a flag it does not
    // know about is skipped rather than rendered as a nameless input.
    if (!field) continue;

    const wrap = el('div', 'meta-field');
    const row = el('div', 'meta-field-row');

    const label = el('div', 'meta-label');
    label.append(el('span', null, field.label));
    if (metaImageIsDirty(flag)) label.append(el('span', 'meta-dirty', 'changed'));
    row.append(label);

    row.append(el('span', 'meta-source', SOURCE_TEXT[field.source] ?? field.source));

    const revert = el('button', 'meta-revert', 'Undo');
    revert.type = 'button';
    revert.hidden = !metaImageIsDirty(flag);
    revert.addEventListener('click', () => {
      metaState.inputValues[flag] = String(field.value ?? '');
      if (IMAGE_INPUTS[flag]) metaState.inputValues[IMAGE_INPUTS[flag]] = '';
      renderMetaFields(data);
    });
    row.append(revert);

    wrap.append(row);

    const control = el('div', 'meta-control');
    const input = document.createElement('input');
    input.type = 'text';
    input.id = `meta-${flag}`;
    input.value = metaState.inputValues[flag] ?? '';
    if (field.list) input.placeholder = 'comma separated';
    // Live marking: the operator must see what they just changed before
    // committing, not only after the whole form re-renders.
    input.addEventListener('input', () => {
      metaState.inputValues[flag] = input.value;
      const dirty = metaImageIsDirty(flag);
      wrap.classList.toggle('is-dirty', dirty);
      const badge = label.querySelector('.meta-dirty');
      if (dirty && !badge) label.append(el('span', 'meta-dirty', 'changed'));
      if (!dirty && badge) badge.remove();
      revert.hidden = !dirty;
      renderMetaDirtyCount();
      saveMetaDraft();
    });
    control.append(input);

    if (IMAGE_INPUTS[flag]) {
      const art = el('div', 'meta-image');
      const preview = el('div', 'meta-preview');
      metaPreviewInto(preview, input.value.trim());
      art.append(preview);

      const actions = el('div', 'meta-image-actions');
      const path = document.createElement('input');
      path.type = 'text';
      path.className = 'meta-file';
      path.placeholder = 'path to a local image';
      // A browser cannot report an absolute path from a file input, so this is
      // a typed path rather than a picker. The server resolves and verifies it.
      path.value = metaState.inputValues[IMAGE_INPUTS[flag]] ?? '';
      const name = el('span', 'meta-file-name', path.value.trim() || 'no file');
      path.addEventListener('input', () => {
        metaState.inputValues[IMAGE_INPUTS[flag]] = path.value;
        name.textContent = path.value.trim() || 'no file';
        // A typed path is an edit to this field, so the row has to say so. Without
        // this the count moves but the field still reads as untouched.
        const dirty = metaImageIsDirty(flag);
        wrap.classList.toggle('is-dirty', dirty);
        const badge = label.querySelector('.meta-dirty');
        if (dirty && !badge) label.append(el('span', 'meta-dirty', 'changed'));
        if (!dirty && badge) badge.remove();
        revert.hidden = !dirty;
        renderMetaDirtyCount();
        saveMetaDraft();
      });
      actions.append(path);
      actions.append(name);
      art.append(actions);

      // A browser file input cannot report an absolute path, which is what the
      // publisher needs in order to upload. Choosing a file therefore posts the
      // bytes to the server, which stages them and hands back a real path; the
      // typed box above is kept for a file that is not on this machine (a shared
      // drive, a path from another tool), where the same --icon-file flow applies
      // unchanged.
      actions.append(el('span', 'meta-file-or', 'or'));

      const pick = document.createElement('input');
      pick.type = 'file';
      pick.className = 'meta-picker';
      pick.accept = 'image/png,image/jpeg,image/webp,image/gif';
      const stageStatus = el('span', 'meta-stage-status', '');
      // The staged file has no URL yet, so the preview beside the URL box cannot
      // show it. It is previewed from the picked File instead, which is the point
      // of choosing it here: see the replacement before publishing it.
      const local = el('div', 'meta-preview meta-preview-local');
      pick.addEventListener('change', async () => {
        const file = pick.files?.[0];
        local.textContent = '';
        if (!file) return;
        // Revoked once the image has decoded: the blob is the picked file, which the
        // browser already holds, so keeping the handle alive for the life of the
        // form leaks memory for nothing.
        const blobUrl = URL.createObjectURL(file);
        metaPreviewInto(local, blobUrl, () => URL.revokeObjectURL(blobUrl));

        stageStatus.textContent = 'staging...';
        await stageArtwork(file, stageStatus, (localPath) => {
          metaState.inputValues[IMAGE_INPUTS[flag]] = localPath;
          name.textContent = localPath;

          const dirty = metaImageIsDirty(flag);
          wrap.classList.toggle('is-dirty', dirty);
          const badge = label.querySelector('.meta-dirty');
          if (dirty && !badge) label.append(el('span', 'meta-dirty', 'changed'));
          revert.hidden = !dirty;
          renderMetaDirtyCount();
          saveMetaDraft();
        });
      });
      actions.append(pick);
      actions.append(stageStatus);
      art.append(local);

      // A pasted URL updates its own preview, which is the only way to confirm
      // the URL points at the intended image.
      input.addEventListener('input', () => metaPreviewInto(preview, input.value.trim()));
      control.append(art);
    }

    wrap.append(control);
    box.append(wrap);
  }

  renderMetaDirtyCount();
}

/** Show what would confuse the operator, before they publish rather than after. */
function renderMetaWarnings(data) {
  const box = $('metaWarnings');
  box.textContent = '';

  const warn = (text) => box.append(el('p', 'meta-warning', text));

  if (!data.hasManifest) {
    warn(
      'No manifest for this channel. The launcher will only see what the catalog says, so a value that exists only in a manifest cannot be recovered here.'
    );
  }
  if (data.channelMismatch) {
    warn(
      `The catalog entry is on "${data.publishedChannel}", not "${data.channel}". The launcher reads the entry's own channel, so this edit will not appear until that channel is resolved.`
    );
  }

  const inherited = FIELD_ORDER.filter((flag) => data.fields[flag]?.inherited);
  if (inherited.length) {
    const names = inherited.map((flag) => data.fields[flag].label).join(', ');
    warn(
      data.hasCatalogEntry
        ? `Inherited from the manifest, so the catalog does not own them yet: ${names}.`
        : `No catalog entry, so every value below is inherited from the manifest: ${names}.`
    );
  }
}

/**
 * Load one game's live metadata and rebuild the form around it.
 *
 * The original values are re-read into the inputs on every load, because Load
 * current is also how an operator abandons a half-finished edit.
 */
async function loadMeta() {
  const gameId = $('metaGameId').value.trim();
  const channel = $('metaChannel').value;
  const log = $('metaLog');
  const state = $('metaState');
  log.hidden = true;

  if (!gameId) {
    state.textContent = 'Enter a game id first.';
    $('metaBody').hidden = true;
    return;
  }

  state.textContent = 'Loading...';
  try {
    const query = `gameId=${encodeURIComponent(gameId)}&channel=${encodeURIComponent(channel)}`;
    const res = await fetch(`/api/meta?${query}`);
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error ?? `HTTP ${res.status}`);
    }
    const data = await res.json();

    metaState.gameId = data.gameId;
    metaState.channel = data.channel;
    metaState.exists = Boolean(data.exists);
    metaState.original = data.fields ?? {};
    metaState.inputValues = {};
    // Reset to exactly what the server reported, never merged with the previous
    // load: a stale value left over from another game would look like a pending
    // edit and then get published.
    for (const [flag, field] of Object.entries(metaState.original)) {
      metaState.inputValues[flag] = String(field.value ?? '');
    }
    for (const key of Object.values(IMAGE_INPUTS)) metaState.inputValues[key] = '';

    if (!data.exists) {
      $('metaBody').hidden = true;
      showDraftNote($('metaDraftNote'), null);
      renderMetaDiff();
      updateDirtyBar();
      state.textContent = `${data.gameId} / ${data.channel} is not published yet, so there is nothing to edit.`;
      return;
    }

    $('metaBody').hidden = false;
    renderMetaWarnings(data);
    renderMetaFields(data);

    // A draft from an earlier session is put back on top of the loaded values, so
    // an edit interrupted by a reload resumes instead of starting over. The
    // baseline is still the loaded value, not the draft: the diff's "before" must
    // be what is actually published or the review would describe the wrong
    // replacement. The note is what stops the restored form reading as live data.
    const draft = readDraft(DRAFT_KEYS.meta(data.gameId, data.channel));
    if (draft?.values && typeof draft.values === 'object') {
      const restored = {};
      for (const [key, value] of Object.entries(draft.values)) {
        if (key in metaState.inputValues || Object.values(IMAGE_INPUTS).includes(key)) {
          restored[key] = String(value ?? '');
        }
      }
      metaState.inputValues = { ...metaState.inputValues, ...restored };
      // Re-rendered rather than patched in place, so the badges, the undo buttons
      // and the diff all reflect the restored values from the same pass.
      renderMetaFields(data);
      showDraftNote($('metaDraftNote'), {
        target: `${data.gameId} / ${data.channel}`,
        at: draft.savedAt,
        // The stored copy goes first. loadMeta() restores from storage, so
        // reloading while the draft is still there would put it straight back
        // and the button would do nothing visible.
        onDiscard: () => {
          clearMetaDraft();
          loadMeta();
        },
      });
    } else {
      showDraftNote($('metaDraftNote'), null);
    }

    // Fetched after the form is rendered so the URLs that label the list are the
    // values just loaded, not whatever the previous game left behind.
    await loadArtwork();

    const parts = [`${data.gameId} / ${data.channel}`];
    parts.push(data.hasCatalogEntry ? 'catalog entry found' : 'no catalog entry');
    state.textContent = parts.join(' - ');
  } catch (err) {
    $('metaBody').hidden = true;
    state.textContent = String(err.message ?? err);
  }
}

/**
 * Build the list of games the operator can pick from.
 *
 * Sourced from the inventory, which is one recursive bucket listing, rather than
 * from a catalog fetch: the inventory already knows every game and channel, and it
 * distinguishes a game that exists on the bucket from one that is merely mentioned
 * in the catalog. That distinction is the point - an id that resolves to nothing is
 * the failure this list removes.
 */
async function renderGamePicker() {
  const box = $('metaGameList');
  const filter = $('metaGameFilter').value.trim().toLowerCase();

  try {
    const res = await fetch('/api/inventory');
    const data = await res.json();
    const entries = data.inventory ?? [];

    // One row per game, listing every channel it is published on, because a game
    // is the thing being edited and its channel is a property of that row rather
    // than a separate lookup the operator has to know about.
    const rows = [];
    for (const entry of entries) {
      if (!entry?.id) continue;
      for (const channel of entry.channels ?? []) {
        const channelName = typeof channel === 'string' ? channel : channel.channel;
        if (!channelName) continue;
        rows.push({ id: entry.id, channel: channelName });
      }
    }

    const shown = rows.filter((row) => !filter || row.id.toLowerCase().includes(filter));

    box.textContent = '';
    if (!shown.length) {
      box.append(
        el('p', 'meta', filter ? `No game matches "${filter}".` : 'No games are published yet.')
      );
      return;
    }

    const currentId = $('metaGameId').value.trim();
    const currentChannel = $('metaChannel').value;
    for (const row of shown) {
      const item = el('button', 'pick');
      item.type = 'button';
      if (row.id === currentId && row.channel === currentChannel) {
        item.classList.add('is-active');
      }

      const main = el('span', 'pick-main');
      main.append(el('span', 'pick-title', row.id));
      main.append(el('span', 'pick-sub', row.channel));
      item.append(main);
      item.addEventListener('click', () => {
        $('metaGameId').value = row.id;
        $('metaChannel').value = row.channel;
        loadMeta();
      });
      box.append(item);
    }
  } catch {
    // A failed listing must not take the form with it: the id box still works,
    // and the inventory panel reports the underlying failure in its own place.
    box.textContent = '';
    box.append(el('p', 'meta', 'Could not list games.'));
  }
}

// The id box is no longer inside a form, so Load is a plain button. Enter in the
// box does the same thing, because the id box plus a channel select is still a
// natural two-keyboard gesture for someone who knows exactly which game they mean.
$('metaLoad')?.addEventListener('click', loadMeta);
$('metaGameId')?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') loadMeta();
});
$('metaGameFilter')?.addEventListener('input', renderGamePicker);

// Offered before anything is loaded, so the edit is reachable after a reload
// without the operator having to remember which game it was for.
resumeDraft({
  noteId: 'metaResume',
  prefix: DRAFT_SCAN.meta,
  label: 'game metadata',
  onResume: () => {
    const draft = newestDraft(DRAFT_SCAN.meta);
    if (!draft) return;
    $('metaGameId').value = draft.gameId ?? '';
    if (draft.channel) $('metaChannel').value = draft.channel;
    loadMeta();
  },
});

// Discarding is the same as reloading from the bucket, except it must also drop
// the stored draft: loadMeta() restores from storage, so a revert that left the
// draft behind would restore the edit on the very next load and make the button
// look broken.
$('metaRevertAll')?.addEventListener('click', () => {
  clearMetaDraft();
  loadMeta();
});

// The review button only reveals the panel; it never publishes. It exists so the
// step between "I edited something" and "I clicked publish" has something in it,
// because the form shows the new value but never the one it is replacing.
$('metaReview')?.addEventListener('click', () => {
  renderMetaDirtyCount();
  $('metaDiff')?.scrollIntoView({ block: 'nearest' });
});

$('metaPublish')?.addEventListener('click', async () => {
  const changed = metaDirtyFlags();
  if (!changed.length) return;

  const dryRun = $('metaDryRun').checked;
  // An image field is counted as dirty when only a file path was typed, even
  // though no text changed, so the prompt has to cover both kinds of edit.
  const noun = changed.length === 1 ? 'change' : 'changes';
  if (
    !dryRun &&
    !window.confirm(
      `Publish ${changed.length} metadata ${noun}? Players will see them immediately.`
    )
  ) {
    return;
  }

  const payload = { gameId: metaState.gameId, channel: metaState.channel, dryRun };
  for (const flag of changed) {
    const field = metaState.original[flag];
    const value = metaState.inputValues[flag] ?? '';
    // Absent vs empty is load-bearing on the server: an absent key leaves the
    // published value alone, an emptied text field clears it. An emptied list
    // field is never sent, because a comma list cannot express "no genres" and
    // writing [] would erase the field instead. metaIsDirty already refuses to
    // report an emptied list as changed, so that guard cannot be reached.
    if (value.trim() === '' && field.list) continue;
    // An image field that changed only because a file was typed must not also
    // resend its unchanged URL: the server would diff the two and report a
    // change that the operator never made, and the upload rewrites the URL.
    if (IMAGE_INPUTS[flag] && !metaIsDirty(flag)) continue;
    payload[flag] = field.list ? normaliseList(value).join(', ') : value.trim();
  }
  for (const key of Object.values(IMAGE_INPUTS)) {
    const path = (metaState.inputValues[key] ?? '').trim();
    if (path) payload[key] = path;
  }

  const code = await stream('/api/meta/publish', payload, 'metaLog');
  if (dryRun || code !== 0) {
    // A failed or previewed run leaves the edit alone on purpose: the operator's
    // typing is still the only copy of what they meant, and reloading over it
    // would discard the work on exactly the failure they need to read.
    if (code !== 0)
      showDraftNote($('metaDraftNote'), {
        target: `${metaState.gameId} / ${metaState.channel}`,
        at: Date.now(),
        onDiscard: () => {
          clearMetaDraft();
          loadMeta();
        },
      });
    return;
  }

  // A real publish starts from the bucket again, so the draft it leaves behind
  // would resurrect values that are now live and would show as a phantom edit.
  clearMetaDraft();
  await loadMeta();
  refresh();
});

// The channel select changes which prefix is published to, so a list left over
// from the previous channel would describe objects the operator is not editing.
$('metaChannel')?.addEventListener('change', () => loadMeta());

renderGamePicker();

// --- News ------------------------------------------------------------------
//
// One document, one operation at a time. The shape mirrors the metadata panel
// deliberately - a selection list, a form, a published-artwork list, a preview-only
// default - so the two pages behave identically and an operator who learns one has
// learned the other.

const NEWS_IMAGE_INPUT = 'imageFile';

/**
 * The loaded feed plus the values as they were when loaded.
 *
 * `original` is the comparison baseline for the same reason it is on the game
 * panel: only what changed is sent, because the publisher treats an absent field
 * as "leave it alone". Sending the whole form would blank every optional field the
 * operator did not touch.
 */
const newsState = {
  items: [],
  categories: [],
  fields: [],
  selected: null,
  original: {},
  values: {},
};

/**
 * The news field contract, as the server sent it.
 *
 * The dashboard client is plain browser JavaScript served as-is, with no bundler, so
 * it cannot import news-fields.mjs the way the publisher does. Rather than keep a
 * hand-typed copy of the list here - which would offer a field the publisher silently
 * drops the first time one is renamed - the contract travels in the /api/news
 * response. Empty only before the first load, at which point nothing renders a form
 * from it.
 */
function newsFields() {
  return newsState.fields;
}

/** The item currently open, or null when the form is showing a new one. */
function newsCurrent() {
  if (newsState.selected) return newsState.items.find((i) => i.id === newsState.selected);
  return null;
}

/** A field changed when its trimmed text differs from what was loaded. */
function newsIsDirty(flag) {
  if (newsState.original[flag] === undefined) return false;
  return (newsState.values[flag] ?? '').trim() !== String(newsState.original[flag] ?? '').trim();
}

/**
 * Whether anything is worth publishing.
 *
 * A chosen image counts on its own, for the same reason it does on the game panel:
 * the server uploads the file and rewrites the URL, so the URL box is untouched
 * even though the item will change.
 */
function newsImagePath() {
  return String(newsState.values[NEWS_IMAGE_INPUT] ?? '').trim();
}

/**
 * The changed fields, as a list rather than a count.
 *
 * Same role as metaDirtyFlags(): the one place that answers "what would this
 * publish change", so the dirty count, the diff and the payload cannot disagree.
 * newsIsDirty is left as the per-field predicate.
 */
function newsDirtyFields() {
  return newsFields()
    .filter((field) => newsIsDirty(field.flag))
    .map((field) => field.flag);
}

/** The draft key for the item on screen: its id, or "new" for an unsaved one. */
function newsDraftKey() {
  return DRAFT_KEYS.news(newsState.selected);
}

function saveNewsDraft() {
  const key = newsDraftKey();
  if (!newsState.fields.length) return;
  if (!newsDirtyFields().length && !newsImagePath()) {
    clearNewsDraft();
    return;
  }
  storeWrite(
    key,
    JSON.stringify({
      savedAt: Date.now(),
      target: newsState.selected ?? 'a new item',
      itemId: newsState.selected ?? 'new',
      values: newsState.values,
    })
  );
}

function clearNewsDraft() {
  const key = newsDraftKey();
  if (key) storeRemove(key);
  showDraftNote($('newsDraftNote'), null);
}

function renderNewsDirtyCount() {
  const count = newsDirtyFields().length;
  const parts = [];
  if (count) parts.push(`${count} field${count > 1 ? 's' : ''} changed`);
  if (newsImagePath()) parts.push('1 image ready to upload');
  $('newsDirtyCount').textContent = parts.join(' - ');
  renderNewsDiff();
  updateDirtyBar();
}

// --- Diff review -----------------------------------------------------------
//
// The same review the game panel gets, built from newsDirtyFields() so it lists
// exactly the fields an update would send. A create has nothing to compare against
// - the item does not exist yet - so it is described as new rather than diffed
// against blanks, which would render every optional field as a deletion.

function newsDiffRow(flag) {
  const field = newsFields().find((one) => one.flag === flag);
  if (!field) return null;

  const item = newsCurrent();
  const row = el('div', 'diff-row');
  const before = item ? String(newsState.original[flag] ?? '').trim() : '';
  const after = (newsState.values[flag] ?? '').trim();

  // A cleared field is called out in its own class: "no excerpt" and "excerpt
  // unchanged" both render as an empty column otherwise.
  if (item && !after) row.classList.add('is-cleared');
  row.append(el('div', 'diff-label', field.label));
  row.append(el('div', 'diff-before', item ? before || '(empty)' : '(new item)'));
  row.append(el('div', 'diff-after', after || '(cleared)'));
  return row;
}

function renderNewsDiff() {
  const panel = $('newsDiff');
  const rows = $('newsDiffRows');
  if (!panel || !rows) return;

  const changed = newsDirtyFields();
  const image = newsImagePath();
  const isNew = !newsCurrent();
  rows.textContent = '';
  panel.hidden = !changed.length && !image;

  const summary = $('newsDiffSummary');
  if (panel.hidden) {
    summary.textContent = '';
    return;
  }

  const dryRun = $('newsDryRun').checked;
  const noun = changed.length === 1 ? 'field' : 'fields';
  const what = isNew ? 'would be created with' : `would change on ${newsState.selected}`;
  summary.textContent = dryRun
    ? `${changed.length} ${noun} ${what}. Preview only is on, so nothing is published.`
    : `${changed.length} ${noun} ${what}. Unticking Preview only and publishing writes to the feed.`;
  if (image) summary.textContent += ' One artwork file will upload on publish.';

  for (const flag of changed) {
    const row = newsDiffRow(flag);
    if (row) rows.append(row);
  }
}

/** Load the live feed and redraw both the list and the form. */
async function loadNews() {
  const state = $('newsState');
  $('newsLog').hidden = true;

  try {
    const res = await fetch('/api/news');
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.error ?? `HTTP ${res.status}`);
    }
    const data = await res.json();
    newsState.items = data.items ?? [];
    newsState.categories = data.categories ?? [];
    newsState.fields = data.fields ?? [];

    // A selection that no longer exists must not be left selected: after a delete it
    // would render an empty form for an item the list no longer offers, and
    // publishing that would re-create it.
    if (newsState.selected && !newsState.items.some((item) => item.id === newsState.selected)) {
      newsState.selected = null;
    }

    state.textContent = newsState.items.length
      ? `${newsState.items.length} item${newsState.items.length > 1 ? 's' : ''} published`
      : 'No news is published yet.';
    renderNewsList();
    renderNewsForm();
    await loadNewsArt();
  } catch (err) {
    state.textContent = String(err.message ?? err);
    $('newsList').textContent = '';
    $('newsBody').hidden = true;
  }
}
function renderNewsList() {
  const box = $('newsList');
  const filter = $('newsFilter').value.trim().toLowerCase();
  box.textContent = '';

  const shown = newsState.items.filter(
    (item) => !filter || item.label.toLowerCase().includes(filter) || item.id.includes(filter)
  );

  if (!shown.length) {
    box.append(
      el('p', 'meta', newsState.items.length ? 'No item matches that filter.' : 'Nothing here yet.')
    );
    return;
  }

  for (const item of shown) {
    const row = el('button', 'pick');
    row.type = 'button';
    if (item.id === newsState.selected) row.classList.add('is-active');

    const thumb = el('span', 'pick-thumb');
    const img = document.createElement('img');
    img.src = item.imageUrl || '/placeholder-news.svg';
    img.alt = '';
    // The launcher substitutes the game's banner, then its icon, then a bundled
    // placeholder. This list shows the same fallback so an item relying on it does
    // not look broken here and then render differently in the app.
    img.addEventListener('error', () => {
      thumb.textContent = '';
      thumb.append(el('span', 'pick-glyph', '▦'));
    });
    thumb.append(img);
    row.append(thumb);

    const main = el('span', 'pick-main');
    main.append(el('span', 'pick-title', item.label));
    const sub = [item.fields.category, item.fields.date].filter(Boolean).join(' - ');
    main.append(el('span', 'pick-sub', sub || item.id));
    row.append(main);

    row.addEventListener('click', () => {
      newsState.selected = item.id;
      renderNewsList();
      renderNewsForm();
      loadNewsArt();
    });
    box.append(row);
  }
}

/** Reset the form to the selected item's published values. */
function renderNewsForm() {
  const item = newsCurrent();
  newsState.original = item ? { ...item.fields } : {};
  newsState.values = item ? { ...item.fields } : {};
  newsState.values[NEWS_IMAGE_INPUT] = '';

  // A stored draft for this exact item is laid over the published values, so an
  // edit interrupted by a reload resumes. `original` deliberately keeps the
  // published values: the diff's "before" has to be what players see now, not
  // what the operator typed last time.
  const draft = readDraft(newsDraftKey());
  if (draft?.values && typeof draft.values === 'object') {
    for (const field of newsFields()) {
      if (draft.values[field.flag] === undefined) continue;
      newsState.values[field.flag] = String(draft.values[field.flag] ?? '');
    }
    if (draft.values[NEWS_IMAGE_INPUT] !== undefined) {
      newsState.values[NEWS_IMAGE_INPUT] = String(draft.values[NEWS_IMAGE_INPUT] ?? '');
    }
  }

  $('newsBody').hidden = false;
  $('newsPublish').textContent = item ? 'Publish' : 'Create item';
  // Move and delete act on an existing item; on a new one they are meaningless, and a
  // disabled button is clearer than one that silently does nothing.
  $('newsDelete').disabled = !item;
  $('newsMoveUp').disabled = !item || newsState.items[0]?.id === item.id;
  $('newsMoveDown').disabled = !item || newsState.items.at(-1)?.id === item.id;

  const box = $('newsFields');
  box.textContent = '';

  // Categories are suggestions, not a closed set: news-service validates an item on
  // id and title alone, so a category the operator invents is legitimate and must be
  // typeable as well as pickable.
  const options = document.createElement('datalist');
  options.id = 'news-category-options';
  for (const category of newsState.categories) {
    const option = document.createElement('option');
    option.value = category;
    options.append(option);
  }

  for (const field of newsFields()) {
    const wrap = el('div', 'meta-field');
    const row = el('div', 'meta-field-row');
    row.append(el('div', 'meta-label', field.label));

    const badge = el('span', 'meta-dirty', 'changed');
    badge.hidden = !newsIsDirty(field.flag);
    row.append(badge);

    const revert = el('button', 'meta-revert', 'Undo');
    revert.type = 'button';
    revert.hidden = !newsIsDirty(field.flag);
    revert.addEventListener('click', () => {
      newsState.values[field.flag] = String(newsState.original[field.flag] ?? '');
      renderNewsForm();
      loadNewsArt();
    });
    row.append(revert);
    wrap.append(row);

    const control = el('div', 'meta-control');
    const input = document.createElement(field.long ? 'textarea' : 'input');
    if (!field.long) input.type = 'text';
    input.id = `news-${field.flag}`;
    input.value = newsState.values[field.flag] ?? '';
    if (field.flag === 'category') input.setAttribute('list', options.id);

    input.addEventListener('input', () => {
      newsState.values[field.flag] = input.value;
      const dirty = newsIsDirty(field.flag);
      wrap.classList.toggle('is-dirty', dirty);
      badge.hidden = !dirty;
      revert.hidden = !dirty;
      renderNewsDirtyCount();
      // The image URL and the artwork list below it are the same fact shown twice,
      // so a URL edited by hand has to move the list with it.
      if (field.flag === 'image-url') loadNewsArt();
      saveNewsDraft();
    });
    control.append(input);
    wrap.append(control);
    box.append(wrap);

    if (field.flag === 'image-url') renderNewsImageControl(wrap, input);
  }

  box.append(options);
  // No second pass is needed to mark the restored values: the loop above reads
  // newsState.values, which the draft was merged into before rendering started, so
  // every badge, undo button and is-dirty class is already correct.
  showNewsDraftNote(draft);
  renderNewsDirtyCount();
}

/** The restored-draft banner for the news editor, mirroring the game's. */
function showNewsDraftNote(draft) {
  // Null when there is no draft, so the banner is hidden rather than announcing a
  // restored edit that does not exist.
  if (!draft) {
    showDraftNote($('newsDraftNote'), null);
    return;
  }
  const item = newsCurrent();
  showDraftNote($('newsDraftNote'), {
    target: item ? item.label : 'a new item',
    at: draft.savedAt,
    onDiscard: () => {
      clearNewsDraft();
      renderNewsForm();
      loadNewsArt();
    },
  });
}

/**
 * The image control under the image URL box: preview, typed path, and picker.
 *
 * Structurally the same three pieces as the game panel, and for the same reason -
 * see the comment on stageArtwork below. What differs is only the scope the
 * artwork list is fetched for, which is why this is a separate function rather than
 * a parameter on the shared one.
 */
function renderNewsImageControl(wrap, input) {
  const art = el('div', 'meta-image');
  const preview = el('div', 'meta-preview');
  metaPreviewInto(preview, input.value.trim());
  art.append(preview);

  const actions = el('div', 'meta-image-actions');

  const path = document.createElement('input');
  path.type = 'text';
  path.className = 'meta-file';
  path.placeholder = 'path to a local image';
  path.value = newsState.values[NEWS_IMAGE_INPUT] ?? '';
  const name = el('span', 'meta-file-name', path.value.trim() || 'no file');

  const markDirty = () => {
    wrap.classList.toggle('is-dirty', newsImagePath() !== '' || newsIsDirty('image-url'));
    renderNewsDirtyCount();
  };

  path.addEventListener('input', () => {
    newsState.values[NEWS_IMAGE_INPUT] = path.value;
    name.textContent = path.value.trim() || 'no file';
    markDirty();
    saveNewsDraft();
  });
  actions.append(path);
  actions.append(name);

  actions.append(el('span', 'meta-file-or', 'or'));

  const pick = document.createElement('input');
  pick.type = 'file';
  pick.className = 'meta-picker';
  pick.accept = 'image/png,image/jpeg,image/webp,image/gif';
  const status = el('span', 'meta-stage-status', '');
  const local = el('div', 'meta-preview meta-preview-local');

  pick.addEventListener('change', async () => {
    const file = pick.files?.[0];
    local.textContent = '';
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    metaPreviewInto(local, blobUrl, () => URL.revokeObjectURL(blobUrl));

    status.textContent = 'staging...';
    await stageArtwork(file, status, (localPath) => {
      newsState.values[NEWS_IMAGE_INPUT] = localPath;
      name.textContent = localPath;
      markDirty();
      saveNewsDraft();
    });
  });
  actions.append(pick);
  actions.append(status);
  art.append(actions);
  art.append(local);
  wrap.append(art);
}

/** List the images published under launcher/news/, labelled with the one in use. */
async function loadNewsArt() {
  const query = new URLSearchParams({
    scope: 'news',
    'image-url': newsState.values['image-url'] ?? '',
  });
  try {
    const res = await fetch(`/api/art?${query}`);
    if (!res.ok) {
      renderNewsArt([]);
      return;
    }
    const data = await res.json();
    renderNewsArt(data.objects ?? []);
  } catch {
    renderNewsArt([]);
  }
}

function renderNewsArt(objects) {
  const box = $('newsArt');
  if (!box) return;
  box.textContent = '';

  if (!objects.length) {
    box.append(el('p', 'meta', 'No news artwork is published yet.'));
    return;
  }

  for (const object of objects) {
    const item = el('div', 'meta-art-item');
    if (!object.inUse) item.classList.add('is-unused');

    const thumb = el('div', 'meta-art-thumb');
    const img = document.createElement('img');
    img.addEventListener('error', () => {
      thumb.textContent = '';
      thumb.append(el('span', 'meta-preview-empty', 'cannot load'));
    });
    img.src = object.url;
    img.alt = '';
    thumb.append(img);
    item.append(thumb);

    const info = el('div', 'meta-art-info');
    info.append(el('div', 'meta-art-name', object.name));
    const meta = [object.size, object.lastModified].filter(Boolean).join(' - ');
    if (meta) info.append(el('div', 'meta-art-meta', meta));
    // An object name carries the item id, so which item owns a picture is readable
    // from the name; whether any item still points at it is not, and that is the
    // question worth answering.
    info.append(el('div', 'meta-art-field', object.inUse ? 'used by this item' : 'not referenced'));
    item.append(info);
    box.append(item);
  }
}

/** Switch the form to a blank item that does not exist in the feed yet. */
function startNewNews() {
  newsState.selected = null;
  newsState.original = {};
  newsState.values = {};
  for (const field of newsFields()) newsState.values[field.flag] = '';
  newsState.values[NEWS_IMAGE_INPUT] = '';
  renderNewsList();
  renderNewsForm();
  $('newsLog').hidden = true;
  $('news-title')?.focus();
}

/** Send one operation to the publisher, then re-read the feed it produced. */
async function publishNews(payload, confirmText) {
  const dryRun = $('newsDryRun').checked;
  if (!dryRun && !window.confirm(confirmText)) return;

  const code = await stream('/api/news/publish', { ...payload, dryRun }, 'newsLog');
  if (dryRun || code !== 0) {
    // Kept on failure and on preview, for the metadata panel's reason: the typing
    // is the only copy of what the operator meant, and reloading over it would
    // discard the work on exactly the run they need to read.
    return;
  }

  // What is now published is what the form should show, so the draft that
  // described a pending edit has to go, or it would be restored on the next
  // visit as a phantom difference against the live feed.
  clearNewsDraft();
  // Reloaded rather than patched locally: the publisher is what decides the final
  // order and the final image URL, so a local guess would drift from what players
  // actually get.
  await loadNews();
}

$('newsFilter')?.addEventListener('input', renderNewsList);

// Discards the typed values by rebuilding the form from the published item, which
// only shows anything different if the stored draft is dropped first.
$('newsRevertAll')?.addEventListener('click', () => {
  clearNewsDraft();
  renderNewsForm();
  loadNewsArt();
  $('newsLog').hidden = true;
});

// Reveals the review. It never publishes, for the same reason the game's does not.
$('newsReview')?.addEventListener('click', () => {
  renderNewsDirtyCount();
  $('newsDiff')?.scrollIntoView({ block: 'nearest' });
});

$('newsNew')?.addEventListener('click', startNewNews);

$('newsDelete')?.addEventListener('click', async () => {
  const item = newsCurrent();
  if (!item) return;
  await publishNews(
    { op: 'delete', id: item.id },
    `Delete "${item.label}" from the news feed? Players will stop seeing it.`
  );
});

for (const [id, delta] of [
  ['newsMoveUp', -1],
  ['newsMoveDown', 1],
]) {
  $(id)?.addEventListener('click', async () => {
    const item = newsCurrent();
    if (!item) return;
    await publishNews({ op: 'move', id: item.id, delta }, null);
  });
}

$('newsPublish')?.addEventListener('click', async () => {
  const item = newsCurrent();

  // An update sends only what changed, because the publisher reads an absent field
  // as "leave it alone" and sending the whole form would blank every optional field
  // nobody touched. A create has to send everything, since nothing exists yet.
  // The id is left empty for a create on purpose: the server derives it from the
  // title against the ids actually published, which is the only place that knows
  // what is taken. An id is never edited afterwards either, because the item's
  // artwork object is named after it.
  const payload = { op: item ? 'update' : 'create', id: item ? item.id : '' };
  for (const field of newsFields()) {
    if (item && !newsIsDirty(field.flag) && field.flag !== 'image-url') continue;
    payload[field.flag] = (newsState.values[field.flag] ?? '').trim();
  }
  // An image chosen in the browser supersedes the URL: the publisher uploads the file
  // and rewrites the URL itself, so sending the unchanged one would report a change
  // the operator never made.
  if (!item || newsIsDirty('image-url')) {
    if (newsImagePath()) payload.imageFile = newsImagePath();
  }

  if (!String(payload.title ?? '').trim()) {
    $('newsLog').hidden = false;
    $('newsLog').textContent = 'A news item needs a title. The launcher drops it without one.';
    return;
  }
  const verb = item ? 'Publish' : 'Create';
  await publishNews(payload, `${verb} "${payload.title}"? Players will see it immediately.`);
});

$('newsRefresh')?.addEventListener('click', loadNews);

// The feed is only fetched when the tab is opened, so the resume banner is
// refreshed there too - otherwise a draft saved after the last visit would not
// show until the feed was reloaded by hand.
resumeDraft({
  noteId: 'newsResume',
  prefix: DRAFT_SCAN.news,
  label: 'news',
  onResume: async () => {
    const draft = newestDraft(DRAFT_SCAN.news);
    if (!draft) return;
    if (!newsState.items.length) await loadNews();
    const item = newsState.items.find((one) => one.id === draft.itemId);
    if (item) {
      newsState.selected = item.id;
      renderNewsList();
      renderNewsForm();
      loadNewsArt();
      return;
    }
    // The draft is for an item that no longer exists, or for one never published.
    // startNewNews() keeps the "new" key, which is the one that draft is under.
    startNewNews();
  },
});

// Loaded on first visit to the tab rather than at page load: the feed is a network
// round trip to the bucket, and most visits to this dashboard are about games or
// launcher releases. The state line is empty until then, which is what the check
// below keys on.
document.querySelector('[data-tab="news"]')?.addEventListener('click', () => {
  if (!$('newsState').textContent) loadNews();
});
