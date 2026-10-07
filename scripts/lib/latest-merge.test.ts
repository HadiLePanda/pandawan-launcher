import { describe, expect, it } from 'vitest';

import { mergeLatest } from './latest-merge.mjs';

const entry = (url: string) => ({ signature: `${url}.sig`, url });

describe('mergeLatest', () => {
  it('returns the incoming manifest when nothing is published', () => {
    const incoming = { version: '0.3.0', platforms: { 'windows-x86_64': entry('w') } };
    expect(mergeLatest(null, incoming)).toBe(incoming);
  });

  it('unions the platforms when the versions match', () => {
    const existing = {
      version: '0.3.0',
      platforms: { 'windows-x86_64': entry('w'), 'linux-x86_64': entry('l') },
    };
    const incoming = { version: '0.3.0', platforms: { 'darwin-aarch64': entry('m') } };
    const merged = mergeLatest(existing, incoming);
    expect(Object.keys(merged.platforms).sort()).toEqual([
      'darwin-aarch64',
      'linux-x86_64',
      'windows-x86_64',
    ]);
  });

  it('lets the incoming entry win for a platform in both', () => {
    const existing = { version: '0.3.0', platforms: { 'windows-x86_64': entry('old') } };
    const incoming = { version: '0.3.0', platforms: { 'windows-x86_64': entry('new') } };
    expect(mergeLatest(existing, incoming).platforms['windows-x86_64'].url).toBe('new');
  });

  it('does not merge across versions', () => {
    const existing = { version: '0.2.1', platforms: { 'windows-x86_64': entry('w') } };
    const incoming = { version: '0.3.0', platforms: { 'linux-x86_64': entry('l') } };
    expect(mergeLatest(existing, incoming)).toBe(incoming);
  });

  it('throws on an incoming manifest with no platforms object', () => {
    expect(() => mergeLatest(null, { version: '0.3.0' })).toThrow();
  });
});
