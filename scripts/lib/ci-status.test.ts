import { describe, expect, it } from 'vitest';

import { runForTag, summariseRun } from './ci-status.mjs';

describe('runForTag', () => {
  const runs = [
    { databaseId: 3, headBranch: 'v0.3.0' },
    { databaseId: 2, headBranch: 'main' },
    { databaseId: 1, headBranch: 'v0.2.1' },
  ];

  it('finds the run for a tag', () => {
    expect(runForTag(runs, 'v0.3.0')?.databaseId).toBe(3);
  });

  it('returns null when no run has the tag', () => {
    expect(runForTag(runs, 'v0.4.0')).toBeNull();
  });

  it('returns null for a missing tag rather than matching the first run', () => {
    expect(runForTag(runs, null)).toBeNull();
    expect(runForTag([], 'v0.1.0')).toBeNull();
  });
});

describe('summariseRun', () => {
  it('returns null when there is no run', () => {
    expect(summariseRun(null, [])).toBeNull();
  });

  it('keeps status and conclusion apart for a run still in progress', () => {
    const summary = summariseRun(
      { databaseId: 9, status: 'in_progress', conclusion: null, url: 'u' },
      [{ name: 'Build linux', status: 'in_progress', conclusion: null }]
    );
    // A missing conclusion must never read as a pass.
    expect(summary.conclusion).toBeNull();
    expect(summary.status).toBe('in_progress');
    expect(summary.failedJobs).toEqual([]);
  });

  it('names the jobs that did not pass', () => {
    const summary = summariseRun(
      { databaseId: 9, status: 'completed', conclusion: 'failure', url: 'u' },
      [
        { name: 'Check version consistency', conclusion: 'cancelled' },
        { name: 'Release macos', conclusion: 'success' },
        { name: 'Release linux', conclusion: 'failure' },
        { name: 'Release windows', conclusion: 'skipped' },
      ]
    );
    // Cancelled and failed count; success and skipped do not.
    expect(summary.failedJobs).toEqual(['Check version consistency', 'Release linux']);
    expect(summary.jobCount).toBe(4);
  });

  it('reports a clean pass with no failed jobs', () => {
    const summary = summariseRun(
      { databaseId: 9, status: 'completed', conclusion: 'success', url: 'u' },
      [{ name: 'everything', conclusion: 'success' }]
    );
    expect(summary.failedJobs).toEqual([]);
    expect(summary.conclusion).toBe('success');
  });
});
