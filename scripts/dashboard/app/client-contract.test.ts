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
