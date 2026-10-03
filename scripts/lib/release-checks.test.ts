import { describe, expect, it } from 'vitest';

import { releaseChecks } from './release-checks.mjs';

const base = { version: '0.2.0', branch: 'main', dirty: false, tagExists: false };

describe('release checks', () => {
  it('allows a clean bump on main with a fresh tag', () => {
    expect(releaseChecks(base)).toEqual({ ok: true, errors: [] });
  });

  it('refuses a version that is not semver', () => {
    const { ok, errors } = releaseChecks({ ...base, version: '0.2' });
    expect(ok).toBe(false);
    expect(errors[0]).toMatch(/semver/);
  });

  it('refuses a missing version rather than tagging vundefined', () => {
    expect(releaseChecks({ ...base, version: undefined }).ok).toBe(false);
  });

  it('refuses to release from a feature branch', () => {
    expect(releaseChecks({ ...base, branch: 'feat/x' }).ok).toBe(false);
  });

  it('refuses a dirty tree, because the bump would not be alone in the commit', () => {
    const { errors } = releaseChecks({ ...base, dirty: true });
    expect(errors[0]).toMatch(/uncommitted/);
  });

  it('refuses a tag that already exists', () => {
    expect(releaseChecks({ ...base, tagExists: true }).ok).toBe(false);
  });

  it('reports every reason at once instead of the first one', () => {
    expect(
      releaseChecks({ version: 'x', branch: 'dev', dirty: true, tagExists: true }).errors
    ).toHaveLength(4);
  });
});
