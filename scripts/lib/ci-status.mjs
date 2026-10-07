/**
 * What a release workflow run means, as pure decisions.
 *
 * The dashboard shells out to `gh`; this module never does. Keeping the reading
 * of a run and its jobs here means "running", "passed" and "failed" - the words
 * the Releases panel renders - can be checked on their own, without a network or
 * a logged-in gh.
 */

/**
 * The newest run whose headBranch is `tag`, or null.
 *
 * gh lists runs newest first, so the first match is the current one. A tag is
 * pushed once per release, so a second match only appears if the operator pushed
 * the same tag twice - the newer run is then the one that matters.
 */
export function runForTag(runs, tag) {
  if (!tag) return null;
  return (runs ?? []).find((run) => run?.headBranch === tag) ?? null;
}

// A conclusion that leaves the release unbuilt or unpublished. `skipped` and
// `neutral` are deliberately absent: a skipped matrix leg is still a green run.
const FAILED_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
]);

/**
 * A run and its jobs, as the panel needs them: the link, the lifecycle word, and
 * the names of the jobs that did not pass.
 *
 * `status` and `conclusion` are kept apart on purpose. gh sets `status` for the
 * whole life of a run and `conclusion` only once it is `completed`, so reading a
 * missing conclusion as success would call a build that never started a pass -
 * which is exactly how a red run would render as green.
 *
 * Returns null for a missing run, so "no run for this tag" stays distinct from a
 * run that has no failed jobs.
 */
export function summariseRun(run, jobs) {
  if (!run) return null;
  const jobList = (jobs ?? []).map((job) => ({
    name: job?.name ?? 'unnamed job',
    conclusion: job?.conclusion ?? null,
  }));
  return {
    runId: run.databaseId ?? null,
    status: run.status ?? null,
    conclusion: run.conclusion ?? null,
    url: run.url ?? null,
    createdAt: run.createdAt ?? null,
    jobCount: jobList.length,
    failedJobs: jobList
      .filter((job) => FAILED_CONCLUSIONS.has(job.conclusion))
      .map((job) => job.name),
  };
}
