import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The CSP is the one place the app's own configuration has to name the CDN host, and
 * a wrong host there breaks every image with nothing in the log to explain it - the
 * failure looks like the bucket being empty. So the host is checked against the other
 * two places that know it, and the policy is checked for the two directives that are
 * the whole reason it is narrower than `https:`.
 */

const config = JSON.parse(
  readFileSync(resolve(__dirname, '../../src-tauri/tauri.conf.json'), 'utf-8')
) as {
  app: { security: { csp: string; devCsp: string } };
  plugins: { updater: { endpoints: string[] } };
};
const cdnSource = readFileSync(resolve(__dirname, 'cdn.ts'), 'utf-8');
const csp = config.app.security.csp;

/** The origin `src/lib/cdn.ts` falls back to when VITE_CDN_ORIGIN is unset. */
function defaultOrigin(): string {
  const match = /const DEFAULT_ORIGIN = '([^']+)'/.exec(cdnSource);
  expect(match, 'DEFAULT_ORIGIN not found in cdn.ts').not.toBeNull();
  return (match as RegExpMatchArray)[1]!;
}

describe('the production content security policy', () => {
  it('allows the origin the app reads artwork from', () => {
    const origin = defaultOrigin();
    expect(csp).toContain(`img-src 'self' ${origin} data:`);
    expect(csp).toContain(`connect-src 'self' ${origin}`);
  });

  it('names the same host as the updater endpoint', () => {
    // Both point at the same bucket, so a mismatch means one of them has been
    // pointed somewhere else and the other was forgotten.
    expect(new URL(config.plugins.updater.endpoints[0]!).origin).toBe(defaultOrigin());
  });

  it('does not allow any https host for images or connections', () => {
    // A bare `https:` in either directive means a renderer that is somehow running
    // script can post to anywhere. The dev policy keeps it on purpose: pointing
    // VITE_CDN_ORIGIN at a scratch bucket or a local server is a supported workflow.
    for (const directive of ['img-src', 'connect-src']) {
      const value = new RegExp(`${directive} ([^;]+)`).exec(csp)?.[1] ?? '';
      expect(value.split(/\s+/), `${directive} must not allow every https host`).not.toContain(
        'https:'
      );
    }
  });

  it('keeps the directives that make it worth having', () => {
    for (const directive of [
      "script-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ]) {
      expect(csp, directive).toContain(directive);
    }
  });

  it('gives development a policy of its own', () => {
    expect(config.app.security.devCsp).toContain('http://127.0.0.1:*');
  });
});
