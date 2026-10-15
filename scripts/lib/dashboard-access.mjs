/**
 * The rules that decide whether a dashboard request may be served.
 *
 * Pure functions in their own module, for the same reason as ci-status.mjs:
 * dashboard.mjs holds the R2 credentials and boots a server, so what a request is
 * *allowed* to be cannot be checked there.
 */

import { timingSafeEqual } from 'node:crypto';

/**
 * The header a /api/ request must carry.
 *
 * The app shell is served with this name in a meta tag and the client sends it
 * back under the same name, so the two can never drift.
 */
export const TOKEN_HEADER = 'x-dashboard-token';

/**
 * Whether a path needs the token.
 *
 * Only `/api/...`. A static file cannot carry a custom header - the browser loads
 * `<script>` and `<link>` itself - so requiring one for the shell would serve a
 * blank page, and the shell is what carries the token in the first place. Every
 * expensive read and every write is under /api/, which is the surface a foreign
 * page could otherwise drive.
 */
export function requiresToken(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Whether a supplied token is the expected one.
 *
 * The compare is constant-time, so a caller cannot learn the token one byte at a
 * time from how long the answer took. Length is checked first because
 * timingSafeEqual throws on a length mismatch.
 */
export function tokenMatches(expected, provided) {
  if (typeof expected !== 'string' || expected === '') return false;
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Put the token in the app shell as a meta tag, which the client reads back.
 *
 * A page on another origin can fetch this document but cannot read it: the
 * response carries no CORS header, so the browser never hands the body to its
 * script. That is what makes the value a secret such a page cannot attach.
 *
 * Injected on the way out rather than written into the app's own index.html, so
 * the gate also covers a build that predates it: an old build then fails with a
 * 403 that names the rebuild command, rather than with a missing tag.
 */
export function injectToken(html, token) {
  const tag = `<meta name="${TOKEN_HEADER}" content="${escapeAttribute(token)}" />`;
  const head = html.indexOf('</head>');
  if (head === -1) return `${tag}\n${html}`;
  return `${html.slice(0, head)}${tag}\n${html.slice(head)}`;
}

/** Escape a value for a double-quoted attribute, so a token cannot break out. */
function escapeAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
