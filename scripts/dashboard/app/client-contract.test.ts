import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Nothing checks the wire contract between the server and this client: the
 * server is plain Node and the client is bundled separately. Both sides change
 * independently and every drift fails silently at runtime:
 *
 *   - a server that emits an SSE event the client never matches makes a FAILED
 *     publish look identical to a successful one,
 *   - a client that fetches an endpoint the server renamed gets the SPA shell
 *     back as HTML, which a JSON parser reports as an unexplained syntax error.
 *
 * These are textual checks on purpose: cheap, no DOM, no server, and they assert
 * the contract rather than the implementation, so refactoring either side does
 * not break them.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const server = readFileSync(path.join(here, '..', '..', 'dashboard.mjs'), 'utf8');
const clientDir = path.join(here, 'src');

/** Every .ts/.tsx under src/, concatenated. */
function clientSource(): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) parts.push(readFileSync(full, 'utf8'));
    }
  };
  walk(clientDir);
  return parts.join('\n');
}

const client = clientSource();

/** The request-gate rules, so the header the two sides share can be compared. */
const access = readFileSync(path.join(here, '..', '..', 'lib', 'dashboard-access.mjs'), 'utf8');

describe('the server/client SSE contract', () => {
  it('emits an event for every server event the client understands', () => {
    const emitted = [...new Set([...server.matchAll(/\bsend\('([a-z]+)'/g)].map((m) => m[1]))];
    expect(emitted.length).toBeGreaterThan(0);

    const handled = new Set([...client.matchAll(/event:\s*([a-z]+)/g)].map((m) => m[1]));
    const unhandled = emitted.filter((event) => !handled.has(event));

    expect(
      unhandled,
      `The server sends these events but the React client never matches them, so ` +
        `the stream is read and thrown away:\n  ${unhandled.join('\n  ')}\n\n` +
        `Handle each one in src/lib/api.ts. An ignored 'error' or 'done' means a ` +
        `failed publish looks identical to a successful one.`
    ).toEqual([]);
  });
});

describe('the server/client endpoint contract', () => {
  it('every endpoint the client calls exists on the server', () => {
    const called = [...new Set([...client.matchAll(/'(\/api\/[a-z/-]*)'/g)].map((m) => m[1]))];
    expect(called.length).toBeGreaterThan(0);

    const missing = called.filter((endpoint) => !server.includes(`'${endpoint}'`));

    expect(
      missing,
      `The client calls these endpoints but dashboard.mjs never matches them, so ` +
        `the request gets the app shell back and the JSON parse fails:\n  ` +
        `${missing.join('\n  ')}\n\n` +
        `Either the endpoint was renamed, or the caller was never updated.`
    ).toEqual([]);
  });
});

describe('the server/client catalog-diff contract', () => {
  /**
   * The diff is rendered from the served shape, and a mismatch is not a wrong
   * number - it is a blank page: the client declared onlyLive/onlyLocal as
   * string[] while catalogDiff sent summarised entries, and rendering one of those
   * objects as a React child unmounted the whole app.
   */
  const catalog = readFileSync(path.join(here, '..', '..', 'lib', 'catalog-edit.mjs'), 'utf8');

  /** The keys of the object a named function returns, as written. */
  function returnedKeys(source: string, fn: string): string[] {
    const body = new RegExp(`function ${fn}\\([^)]*\\)\\s*{[\\s\\S]*?return {([\\s\\S]*?)};`).exec(
      source
    );
    return [...(body?.[1] ?? '').matchAll(/(\w+):/g)].map((m) => m[1]).sort();
  }

  /** The keys of a TypeScript interface, as written. */
  function interfaceKeys(source: string, name: string): string[] {
    const body = new RegExp(`interface ${name}(?:\\s+extends[^{]*)?\\s*{([\\s\\S]*?)}`).exec(
      source
    );
    return [...(body?.[1] ?? '').matchAll(/(\w+)\??:/g)].map((m) => m[1]).sort();
  }

  it('declares the entry the server summarises', () => {
    const served = returnedKeys(catalog, 'summarise');
    expect(served.length).toBeGreaterThan(0);
    expect(interfaceKeys(client, 'CatalogDiffEntry')).toEqual(served);
  });

  it('names each diff list as a list of those entries, never of strings', () => {
    expect(interfaceKeys(client, 'CatalogDiff')).toEqual(['changed', 'onlyLive', 'onlyLocal']);
    expect(client).toMatch(/onlyLive:\s*CatalogDiffEntry\[\]/);
    expect(client).toMatch(/onlyLocal:\s*CatalogDiffEntry\[\]/);
    expect(client).toMatch(/changed:\s*CatalogChangedEntry\[\]/);
    expect(client).toMatch(/interface CatalogChangedEntry\s+extends\s+CatalogDiffEntry\s*{/);
  });
});

describe('the server/client request-token contract', () => {
  it('sends the token on every fetch the client makes', () => {
    const fetches = [...client.matchAll(/\bfetch\(/g)].length;
    // Uses, not call sites: the declaration is the one occurrence that is not a
    // request, and a call with no extra headers is still a request that needs it.
    const declared = [...client.matchAll(/function requestHeaders\(/g)].length;
    const uses = [...client.matchAll(/requestHeaders\(/g)].length - declared;
    expect(fetches).toBeGreaterThan(0);
    expect(declared).toBe(1);

    expect(
      uses,
      `dashboard.mjs refuses a /api/ request that carries no token, so a fetch ` +
        `built without requestHeaders() fails with a 403 that reads like a broken ` +
        `route. ${fetches} fetch call(s), ${uses} carrying the token.`
    ).toBe(fetches);
  });

  it('agrees with the server on the header name', () => {
    const serverHeader = /export const TOKEN_HEADER = '([^']+)'/.exec(access)?.[1];
    const clientHeader = /const TOKEN_HEADER = '([^']+)'/.exec(client)?.[1];
    expect(serverHeader).toBeTruthy();
    expect(clientHeader).toBe(serverHeader);
  });

  it('reads the token from the tag the server injects', () => {
    expect(access).toContain('meta name="${TOKEN_HEADER}"');
    expect(client).toContain('meta[name="${TOKEN_HEADER}"]');
  });

  it('keeps the gate wired into the request handler', () => {
    expect(server).toContain('rejectWithoutToken(req, res, url.pathname)');
  });
});
