import { describe, expect, it } from 'vitest';

import { parseGithubRepo } from './repo.mjs';

describe('parseGithubRepo', () => {
  it('parses an https remote, with and without .git or a trailing slash', () => {
    expect(parseGithubRepo('https://github.com/example-org/example-repo.git')).toBe(
      'example-org/example-repo'
    );
    expect(parseGithubRepo('https://github.com/example-org/example-repo')).toBe(
      'example-org/example-repo'
    );
    expect(parseGithubRepo('https://github.com/example-org/example-repo/')).toBe(
      'example-org/example-repo'
    );
  });

  it('parses an ssh remote', () => {
    expect(parseGithubRepo('git@github.com:example-org/example-repo.git')).toBe(
      'example-org/example-repo'
    );
  });

  it('returns null for anything that is not a GitHub remote', () => {
    expect(parseGithubRepo('')).toBeNull();
    expect(parseGithubRepo(null)).toBeNull();
    expect(parseGithubRepo('not a url')).toBeNull();
  });
});
