import { describe, it, expect } from 'vitest';

import { parseArgs, first, listValue } from './args.mjs';

// `--dry-run=1` used to be stored under the literal key "dry-run=1", so every
// publisher's `args['dry-run']` read false and a mistyped dry run ran live.
describe('parseArgs', () => {
  it('treats --key=value as the same flag as --key value', () => {
    expect(parseArgs(['--dry-run=1'])).toEqual({ 'dry-run': '1' });
    expect(parseArgs(['--channel=beta'])).toEqual({ channel: 'beta' });
  });

  it('keeps an explicit empty value distinct from an absent one', () => {
    expect(parseArgs(['--title', ''])).toEqual({ title: '' });
    expect(parseArgs(['--title='])).toEqual({ title: '' });
  });

  it('reads a bare --flag as "true"', () => {
    expect(parseArgs(['--force'])).toEqual({ force: 'true' });
  });

  it('collects repeated flags into an array, in either form', () => {
    expect(parseArgs(['--platform', 'windows', '--platform', 'macos'])).toEqual({
      platform: ['windows', 'macos'],
    });
    expect(parseArgs(['--platform=windows', '--platform=macos'])).toEqual({
      platform: ['windows', 'macos'],
    });
  });

  it('does not swallow the next flag as a value', () => {
    expect(parseArgs(['--force', '--dry-run'])).toEqual({ force: 'true', 'dry-run': 'true' });
  });

  it('ignores positional arguments', () => {
    expect(parseArgs(['publish', '--force'])).toEqual({ force: 'true' });
  });
});

describe('first', () => {
  it('unwraps a repeated flag', () => {
    expect(first(['a', 'b'])).toBe('a');
    expect(first('a')).toBe('a');
  });
});

describe('listValue', () => {
  it('splits on commas and drops empty parts', () => {
    expect(listValue('a, b ,, c')).toEqual(['a', 'b', 'c']);
    expect(listValue('')).toEqual([]);
  });
});
