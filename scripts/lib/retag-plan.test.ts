import { describe, expect, it } from 'vitest';

import { retagPlan } from './retag-plan.mjs';

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

/** The happy shape: main, clean, a tag that points somewhere other than HEAD. */
const base = { version: '0.3.0', branch: 'main', dirty: false, headSha: HEAD, tagSha: OTHER };

describe('retagPlan', () => {
  it('allows moving a tag that points at another commit', () => {
    const plan = retagPlan(base);
    expect(plan.ok).toBe(true);
    expect(plan.tag).toBe('v0.3.0');
  });

  it('allows creating a tag that does not exist yet', () => {
    expect(retagPlan({ ...base, tagSha: null }).ok).toBe(true);
  });

  it('refuses a tag already at HEAD, because a push would fire no run', () => {
    const plan = retagPlan({ ...base, tagSha: HEAD });
    expect(plan.ok).toBe(false);
    expect(plan.errors.join(' ')).toMatch(/already points at HEAD/);
  });

  it('refuses an unclean tree so the tag is not moved onto uncommitted edits', () => {
    expect(retagPlan({ ...base, dirty: true }).ok).toBe(false);
  });

  it('refuses a branch that is not main', () => {
    expect(retagPlan({ ...base, branch: 'feature/x' }).ok).toBe(false);
  });

  it('refuses a version that is not semver', () => {
    expect(retagPlan({ ...base, version: 'nope' }).ok).toBe(false);
  });
});
