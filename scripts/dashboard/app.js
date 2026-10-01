const PLATFORMS = ['windows', 'macos', 'linux'];
const $ = (id) => document.getElementById(id);

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

refresh();
