import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * app.js is plain browser JS served straight to disk, so nothing - no bundler,
 * no type checker, no linter - checks it against dashboard.mjs. Both sides
 * change independently, and every drift between them fails silently at runtime:
 *
 *   - a server that emits an SSE event the client ignores makes a failed publish
 *     look like a clean one,
 *   - an element id renamed in index.html turns `$(id).textContent` into a
 *     TypeError on load, after the panel has already rendered,
 *   - a panel added to the tab strip with no PAGES entry renders with the
 *     previous panel's title still in the header.
 *
 * These are textual checks on purpose: cheap, no DOM, no server. They assert the
 * contract, not the implementation, so refactoring either file does not break
 * them.
 */

const serverPath = fileURLToPath(new URL('../dashboard.mjs', import.meta.url));
const htmlPath = fileURLToPath(new URL('./index.html', import.meta.url));
const appPath = fileURLToPath(new URL('./app.js', import.meta.url));

const server = readFileSync(serverPath, 'utf8');
const html = readFileSync(htmlPath, 'utf8');
const app = readFileSync(appPath, 'utf8');

describe('the server/client SSE contract', () => {
  it('emits an event for every server event the client understands', () => {
    const serverEvents = sendEventNames(server);
    expect(serverEvents.length).toBeGreaterThan(0);

    const handled = handledEventNames(app);
    const unhandled = serverEvents.filter((event) => !handled.has(event));

    expect(
      unhandled,
      `The server sends these events but app.js never matches them, so the stream ` +
        `is read and thrown away:\n  ${unhandled.join('\n  ')}\n\n` +
        `Handle each one in stream(). An ignored 'error' or 'done' means a failed ` +
        `publish looks identical to a successful one.`
    ).toEqual([]);
  });

  it('finds at least one event name on the server', () => {
    // Guards the assertion above from silently passing on an empty extraction.
    expect(sendEventNames(server)).toContain('output');
  });
});

/**
 * Event names passed to the `send(event, data)` helper that writes SSE frames.
 *
 * Deliberately *not* matched against every `send(` in the file: dashboard.mjs
 * also has unrelated send() calls. Quoted first arguments only, which is the
 * shape the helper is always called with.
 */
function sendEventNames(source: string): string[] {
  const names = source.matchAll(/\bsend\(\s*(['"`])([A-Za-z_][\w-]*)\1/g);
  return [...new Set([...names].map((match) => match[2]))].sort();
}

/**
 * Event names app.js acts on when it splits an SSE stream into frames.
 *
 * Only two shapes count as handling:
 *
 *   - `event: <name>` compared against a frame, and
 *   - `case '<name>':` in a switch over an event name.
 *
 * `addEventListener('error', ...)` is excluded on purpose: those are DOM image
 * and stream error listeners, which have nothing to do with SSE and would make
 * this test pass while 'error' is still dropped from the publish stream.
 */
function handledEventNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/\bevent:\s*([A-Za-z_][\w-]*)/g)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/\bcase\s+(['"])([A-Za-z_][\w-]*)\1\s*:/g)) {
    names.add(match[2]);
  }
  return names;
}

describe('the client/markup element-id contract', () => {
  it('only looks up ids that index.html actually defines', () => {
    const defined = new Set(definedIds(html));
    expect(defined.size).toBeGreaterThan(0);

    const missing = referencedIds(app).filter((id) => !defined.has(id) && !isBuiltAtRuntime(id));

    expect(
      missing,
      `app.js looks these up but index.html has no matching id, so the lookup ` +
        `returns null and the line that follows throws:\n  ${missing.join('\n  ')}\n\n` +
        `The ` +
        '`?`' +
        ` on the lookup hides this until the panel is opened. Rename ` +
        `the element, or the lookup.`
    ).toEqual([]);
  });

  it('never *requires* an id that only exists at runtime', () => {
    // The inverse mistake. `$(id)?.x` tolerates an absent element by design, but
    // `$(id).x` throws when it is null. Runtime-built ids (the news and metadata
    // forms, which are generated from what /api/news and /api/meta return) are
    // legitimately absent from static markup, so an unguarded lookup on one of
    // them is a TypeError waiting for the first item that renders no fields.
    //
    // Deliberately not asserted in the other direction: optional-chaining an id
    // that the markup *does* define is the house style throughout app.js, and
    // pinning that down would fail the build on every defensive line already
    // written. Pinning it would be asserting an accident of the current file, not
    // a contract.
    const guarded = new Set([
      ...app.matchAll(/\$\(\s*['"]([A-Za-z][\w-]*)['"]\s*\)\s*\?\./g),
      ...app.matchAll(/\bgetElementById\(\s*['"]([A-Za-z][\w-]*)['"]\s*\)\s*\?\./g),
    ]);
    const guardedIds = new Set([...guarded].map((match) => match[1]));

    const defined = new Set(definedIds(html));

    const unguarded = referencedIds(app).filter(
      (id) => isBuiltAtRuntime(id) && !defined.has(id) && !guardedIds.has(id)
    );

    expect(
      unguarded,
      `app.js dereferences these ids without optional chaining, but they are ` +
        `built at runtime and so may be absent:\n  ${unguarded.join('\n  ')}`
    ).toEqual([]);
  });
});

/**
 * Ids the dashboard creates at runtime. The news form is built from whatever
 * /api/news returns (`news-${field.flag}`), so its field ids cannot exist in the
 * static markup by design - see newsFields() in app.js, which takes the field
 * list from the server precisely so the two cannot drift apart.
 */
function isBuiltAtRuntime(id: string): boolean {
  return /^(news|meta)-[a-z]/.test(id);
}

function definedIds(markup: string): string[] {
  return [...new Set([...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]))];
}

/**
 * Every id app.js asks the document for: `$('x')` and
 * `document.getElementById('x')` are the same lookup here, because `$` is defined
 * as exactly that at the top of app.js.
 */
function referencedIds(source: string): string[] {
  const viaDollar = [...source.matchAll(/\$\(\s*(['"])([A-Za-z][\w-]*)\1\s*\)/g)].map(
    (match) => match[2]
  );
  const viaGetById = [
    ...source.matchAll(/\bgetElementById\(\s*(['"])([A-Za-z][\w-]*)\1\s*\)/g),
  ].map((match) => match[2]);

  return [...new Set([...viaDollar, ...viaGetById])].sort();
}

describe('the panel/PAGES contract', () => {
  it('describes every panel the markup declares', () => {
    const panels = panelNames(html);
    expect(panels.size).toBeGreaterThan(0);

    const pages = pagesIn(app);

    const undocumented = [...panels].filter((panel) => !pages.has(panel));

    expect(
      undocumented,
      `index.html declares these panels but app.js's PAGES map has no entry, so ` +
        `selectTab() falls back to PAGES.overview and shows the wrong title and ` +
        `description:\n  ${[...undocumented].sort().join('\n  ')}`
    ).toEqual([]);
  });

  it('has no PAGES entry for a panel that no longer exists', () => {
    // The other direction: a leftover key renders a panel nobody can reach.
    const panels = new Set(panelNames(html));
    const orphaned = [...pagesIn(app)].filter((page) => !panels.has(page));

    expect(
      orphaned,
      `app.js's PAGES map has these entries but index.html declares no matching ` +
        `panel, so they can never be shown:\n  ${orphaned.sort().join('\n  ')}`
    ).toEqual([]);
  });
});

function panelNames(markup: string): Set<string> {
  return new Set([...markup.matchAll(/\sdata-panel="([^"]+)"/g)].map((match) => match[1]));
}

function pagesIn(source: string): Set<string> {
  const block = source.match(/const PAGES\s*=\s*\{([\s\S]*?)\n\};/);
  if (!block) return new Set();
  return new Set([...block[1].matchAll(/^\s{2}([A-Za-z_][\w]*)\s*:/gm)].map((m) => m[1]));
}
