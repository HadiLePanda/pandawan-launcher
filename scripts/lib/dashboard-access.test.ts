import { describe, it, expect } from 'vitest';

import { TOKEN_HEADER, injectToken, requiresToken, tokenMatches } from './dashboard-access.mjs';

// The gate exists because a page the operator visits can send a simple cross-origin GET to
// loopback: no preflight, no Origin this server trusts, and a Host of 127.0.0.1. Those GETs
// are not free, so a foreign page could hold the panel down and spend the quotas.
describe('requiresToken', () => {
  it('covers the API surface', () => {
    expect(requiresToken('/api')).toBe(true);
    expect(requiresToken('/api/inventory')).toBe(true);
    expect(requiresToken('/api/launcher/status')).toBe(true);
  });

  it('leaves the shell and its assets alone', () => {
    // The browser fetches these itself and cannot attach a custom header, so requiring one
    // here would serve a blank page, including the page that carries the token.
    expect(requiresToken('/')).toBe(false);
    expect(requiresToken('/index.html')).toBe(false);
    expect(requiresToken('/assets/index-abc123.js')).toBe(false);
    expect(requiresToken('/games/catalog')).toBe(false);
  });

  it('does not treat a path that merely starts with /api as API', () => {
    expect(requiresToken('/apiary')).toBe(false);
    expect(requiresToken('/api-docs')).toBe(false);
  });
});

describe('tokenMatches', () => {
  it('accepts only the exact token', () => {
    expect(tokenMatches('abc123', 'abc123')).toBe(true);
    expect(tokenMatches('abc123', 'abc124')).toBe(false);
    expect(tokenMatches('abc123', 'abc12')).toBe(false);
    expect(tokenMatches('abc123', 'abc1234')).toBe(false);
  });

  it('refuses a missing or non-string token', () => {
    expect(tokenMatches('abc123', undefined)).toBe(false);
    expect(tokenMatches('abc123', null)).toBe(false);
    expect(tokenMatches('abc123', 123)).toBe(false);
    expect(tokenMatches('abc123', ['abc123'])).toBe(false);
    expect(tokenMatches('abc123', '')).toBe(false);
  });

  it('refuses when no token is configured', () => {
    // An empty expected value must not accept an empty header, or the gate would
    // open for everyone the moment the token file went missing.
    expect(tokenMatches('', '')).toBe(false);
    expect(tokenMatches(undefined, 'abc123')).toBe(false);
  });
});

describe('injectToken', () => {
  it('puts the token in the head under the header name', () => {
    const html = injectToken('<html><head><title>x</title></head><body></body></html>', 'abc123');
    expect(html).toContain(`<meta name="${TOKEN_HEADER}" content="abc123" />`);
    expect(html.indexOf('abc123')).toBeLessThan(html.indexOf('</head>'));
  });

  it('escapes a token that would otherwise break the attribute', () => {
    expect(injectToken('<head></head>', 'a"b<c&d')).toContain('content="a&quot;b&lt;c&amp;d"');
  });

  it('still injects into a document with no head', () => {
    expect(injectToken('<html></html>', 'abc123')).toContain('abc123');
  });
});
