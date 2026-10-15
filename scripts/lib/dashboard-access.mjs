/** The rules that decide whether a dashboard request may be served. Pure, so they are
 * testable without booting the server. */

import { timingSafeEqual } from 'node:crypto';

/** The header a `/api/` request must carry, and the meta tag it travels in. */
export const TOKEN_HEADER = 'x-dashboard-token';

/** Only `/api/...`. A `<script>` or `<link>` cannot carry a header, and the shell is what
 * carries the token, so gating the shell would serve a blank page. */
export function requiresToken(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/** Constant-time, so the token cannot be learned a byte at a time. Length is checked
 * first because `timingSafeEqual` throws on a mismatch. */
export function tokenMatches(expected, provided) {
  if (typeof expected !== 'string' || expected === '') return false;
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Put the token in the app shell as a meta tag the client reads back. A page on another
 * origin can fetch this document but cannot read it: no response here carries a CORS
 * header. Injected on the way out, so the gate also covers an older build. */
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
