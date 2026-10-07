/**
 * The launcher's own release ladder and its release verbs.
 *
 * The header answers one question - do players have the same version the repo is
 * at - as value-then-label facts rather than a row of chips to decode. A live
 * version that could not be read says so, instead of rendering as an empty bucket.
 *
 * Only a tag NEWER than the live version is waiting to publish. Older tags are
 * history and are never listed under a waiting affordance; comparing as strings
 * would name v0.1.10 newer than v0.1.9, so every "which is newer" ask goes through
 * compareVersions.
 *
 * PUBLISHING IS ONE CLICK: the primary button sends the newest waiting tag, with
 * that tag named on its face. Nothing is typed - the tag is derived, never entered.
 *
 * BUMP is the only way a version moves: it proposes what release.mjs would write
 * (the server computes it with that script's rule) and derives the tag from it.
 * Dry run is the default, and a real run still confirms by tag name.
 *
 * Global, not game-scoped: the launcher is the app itself, and nothing here acts
 * on the selection in the rail.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Hammer,
  KeyRound,
  Loader2,
  RefreshCw,
  Rocket,
  Tag,
} from 'lucide-react';

import { apiGet, messageOf } from '@/lib/api';
import { compareVersions } from '@lib/version';
import { cx } from './cx';
import { Fact, StatusWord, Tally } from './ladder';
import { Button, ErrorNote } from './ui';
import { usePublisherStream, verdictLine, type StreamVerdict } from './usePublisherStream';

/** `GET /api/launcher/status`. */
interface LauncherStatus {
  published?: {
    version: string | null;
    targets: string[];
    artifactCount: number;
  } | null;
  /** Set when latest.json could not be read, distinct from an empty bucket. */
  publishedError?: string | null;
  releases?: Array<{ tagName: string; isDraft?: boolean }>;
  packageVersion?: string;
  /** What each bump level produces, computed with release.mjs's own rule. */
  nextVersions?: Record<'patch' | 'minor' | 'major', string>;
  /** The tag a release of the repo version carries, e.g. `v0.3.0`. */
  targetTag?: string | null;
  /** CI's release-workflow run for `targetTag`, or null when none exists. */
  ci?: {
    runId: number | null;
    status: string | null;
    conclusion: string | null;
    url: string | null;
    failedJobs: string[];
    jobCount: number;
    /** Why a failed run failed, when GitHub recorded a reason. */
    reason?: string | null;
  } | null;
  cdnOrigin?: string;
  error?: string;
}

const LEVELS = ['patch', 'minor', 'major'] as const;
type Level = (typeof LEVELS)[number];

// How often the panel re-reads while a build is in flight. There is no standing
// poll: this interval exists only while a CI run has not concluded, or for a
// short window after a verb was run, and it stops the moment the run settles.
const POLL_MS = 15_000;
// The window after a verb in which a run may not exist yet, so a poll still has
// something to wait for. A tag push to a run appearing is under a minute.
const SETTLE_MS = 90_000;

// The platforms a CI build can target, in the order they are shown. Windows is
// built locally by default, so it is the one a dispatch turns on by choice.
const PLATFORMS = ['macos', 'linux', 'windows'] as const;
type Platform = (typeof PLATFORMS)[number];

/**
 * `v` stripped, so a tag compares as numbers.
 *
 * Numeric-per-component on purpose: a string sort puts v0.1.10 before v0.1.9,
 * which would name the OLDER tag as the newest one waiting to publish.
 */
function bare(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

/**
 * The tags newer than the live version: the only things a publish can be waiting
 * on. A tag at or below the live version has been passed and is history.
 */
function waitingTags(releases: LauncherStatus['releases'], live: string | null): string[] {
  return (releases ?? [])
    .map((release) => release.tagName)
    .filter((tag) => !live || compareVersions(bare(tag), live) > 0);
}

/** The newest waiting tag by numeric version rather than list order. */
function newestWaiting(releases: LauncherStatus['releases'], live: string | null): string | null {
  return waitingTags(releases, live).reduce<string | null>(
    (best, tag) => (!best || compareVersions(bare(tag), bare(best)) > 0 ? tag : best),
    null
  );
}

export default function LauncherPanel() {
  const [load, setLoad] = useState<
    | { state: 'loading' }
    | { state: 'ready'; data: LauncherStatus; ageMs: number | null }
    | { state: 'error'; message: string }
  >({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [releaseLevel, setReleaseLevel] = useState<Level>('patch');
  const [releaseDryRun, setReleaseDryRun] = useState(true);
  // When a verb last ran. Drives the short post-action poll window so a run that
  // has not been created yet is still picked up.
  const [lastActionAt, setLastActionAt] = useState(0);
  // Guards against two reads at once - a poll tick landing on a manual Refresh -
  // so a slow `gh` call cannot stack a second.
  const inFlight = useRef(false);
  // Which platforms a dispatched CI build covers. macOS and Linux default on;
  // Windows defaults off because it is built locally, which is faster.
  const [platforms, setPlatforms] = useState<Record<Platform, boolean>>({
    macos: true,
    linux: true,
    windows: false,
  });

  const publish = usePublisherStream();
  const release = usePublisherStream();
  const build = usePublisherStream();
  const retag = usePublisherStream();
  const keys = usePublisherStream();

  // The request, with no setState in it. A loader that reaches into component
  // state makes the effect below a synchronous setState, which the react-hooks
  // set-state-in-effect rule rejects for the cascading second render it causes.
  const request = useCallback(async () => {
    const { data, ageMs } = await apiGet<LauncherStatus>('/api/launcher/status', {
      refresh: true,
    });
    // apiGet already raises a non-2xx as an Error, but this endpoint answers
    // `{ error }` with a 200 on some failure paths, so the field is checked too.
    if (data.error) throw new Error(data.error);
    return { data, ageMs };
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    // Keep whatever is already on the ladder and mark it refreshing rather than
    // blanking it to a spinner: a refresh is not a reason to lose the values
    // being read. Only the first load has nothing to keep.
    setLoad((current) => (current.state === 'ready' ? current : { state: 'loading' }));
    setRefreshing(true);
    try {
      const result = await request();
      setLoad({ state: 'ready', data: result.data, ageMs: result.ageMs });
    } catch (err) {
      setLoad({ state: 'error', message: messageOf(err) });
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [request]);

  // Started through a resolved promise rather than called directly, so the state
  // updates land in a callback after the effect body instead of synchronously
  // inside it. Same fetch, same error path - only the render it lands on differs.
  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const data = load.state === 'ready' ? load.data : null;
  const loaded = load.state === 'ready';
  const liveVersion = data?.published?.version ?? null;
  const liveError = data?.publishedError ?? null;
  const repoVersion = data?.packageVersion ?? null;
  // What Publish sends: the newest tag newer than live, or nothing.
  const nextTag = newestWaiting(data?.releases, liveVersion);
  // What a bump would produce, from the server's copy of release.mjs's rule.
  const proposedVersion = repoVersion ? (data?.nextVersions?.[releaseLevel] ?? null) : null;
  const proposedTag = proposedVersion ? `v${proposedVersion}` : null;
  // The comma list a build dispatch sends, in a stable order.
  const selectedPlatforms = PLATFORMS.filter((name) => platforms[name]).join(',');
  // The tag can be moved whenever the build it points at did not pass, or has not
  // run yet. A green or in-progress run has nothing a move could fix, and a move
  // is the one action that changes what the tag means.
  const ciSettled = data?.ci?.status === 'completed';
  const ciPassed = ciSettled && data?.ci?.conclusion === 'success';
  const canRetag = !!data?.targetTag && (!data?.ci || (ciSettled && !ciPassed));

  async function doPublish() {
    if (!nextTag) return;
    if (
      confirmPublish &&
      !window.confirm(`Upload ${nextTag} to R2? Players will see it immediately.`)
    ) {
      return;
    }
    await publish.start('/api/launcher/publish', { tag: nextTag, confirm: confirmPublish });
    setLastActionAt(Date.now());
    // Never left armed: a real publish is a one-off, and a box that stays ticked
    // would make the next click upload a different tag without asking.
    setConfirmPublish(false);
    await refresh();
  }

  async function doRelease() {
    if (!proposedTag) return;
    if (
      !releaseDryRun &&
      !window.confirm(`Bump to ${proposedVersion} and push ${proposedTag}? This triggers CI.`)
    ) {
      return;
    }
    // `confirm` is what makes it real. The server treats a payload without it as a
    // preview, so a click that loses the flag cannot commit, tag and push.
    await release.start('/api/launcher/release', {
      level: releaseLevel,
      confirm: !releaseDryRun,
    });
    // Only a real release pushes a tag for CI to build, so only it opens the poll
    // window; a preview changes nothing to wait for.
    if (!releaseDryRun) setLastActionAt(Date.now());
    await refresh();
  }

  async function doBuild() {
    if (!selectedPlatforms) return;
    await build.start('/api/launcher/build', { platforms: selectedPlatforms });
    setLastActionAt(Date.now());
    await refresh();
  }

  async function doRetag() {
    const tag = data?.targetTag;
    if (!tag) return;
    if (
      !window.confirm(
        `Move ${tag} onto the current commit and re-run CI? This force-pushes the tag.`
      )
    ) {
      return;
    }
    // `confirm` is what makes it real; without it the script only previews.
    await retag.start('/api/launcher/retag', { confirm: true });
    setLastActionAt(Date.now());
    await refresh();
  }

  // The panel owns five streams, so no two of them may run at once: two
  // publishers writing to the same bucket with interleaved logs is worse than a
  // disabled button.
  const busy = publish.busy || release.busy || build.busy || retag.busy || keys.busy;

  // Re-read only while there is something to watch: a CI run that has not
  // concluded, or a verb run within the settle window (its run may not exist
  // yet). Idle, no interval is created at all, and a hidden tab stops the reads -
  // so the cost is bounded by the length of a build, never a standing poll.
  const ciActive = !!data?.ci && data.ci.status !== 'completed';
  const settling = Date.now() - lastActionAt < SETTLE_MS;
  const shouldPoll = ciActive || settling;

  useEffect(() => {
    if (!shouldPoll) return;
    const tick = () => {
      if (!document.hidden) void refresh();
    };
    const id = window.setInterval(tick, POLL_MS);
    // Coming back to the tab reads at once rather than waiting up to POLL_MS for
    // the next tick, so the panel is current the moment it is looked at again.
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [shouldPoll, refresh]);

  return (
    <div className="flex flex-col">
      {/* The header, as facts rather than chips: what players have, what the repo
          is at, and whether they agree. The endpoint is uncached, so Refresh is
          always a real read of all three. */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-edge pb-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-6 gap-y-2">
          <Fact
            label="live"
            value={
              liveVersion
                ? `v${bare(liveVersion)}`
                : !loaded
                  ? '—'
                  : liveError
                    ? 'unreachable'
                    : 'none'
            }
            tone={
              liveVersion
                ? 'text-accent'
                : !loaded
                  ? 'text-ink-faint'
                  : liveError
                    ? 'text-warn'
                    : 'text-ink-subtle'
            }
          />
          <Fact
            label="repo"
            value={repoVersion ? `v${bare(repoVersion)}` : loaded ? 'unknown' : '—'}
            tone={repoVersion ? 'text-ink' : 'text-ink-faint'}
          />
          {loaded ? (
            <Verdict
              live={liveVersion}
              repo={repoVersion}
              unreachable={!liveVersion && !!liveError}
            />
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <Tally value={data?.published?.targets.length ?? 0} label="targets" />
          <Tally value={data?.published?.artifactCount ?? 0} label="installers" />
          <Button
            onClick={() => void refresh()}
            disabled={load.state === 'loading' || refreshing || busy}
            aria-label="Re-read the launcher status, the live release and the GitHub releases"
            title="Re-read the launcher status. Nothing here refreshes on its own."
          >
            <RefreshCw
              aria-hidden
              size={14}
              className={cx((refreshing || load.state === 'loading') && 'animate-spin')}
            />
            Refresh
          </Button>
        </div>
      </header>

      <div className="flex flex-col pt-4">
        {load.state === 'loading' ? (
          <p className="m-0 flex items-center gap-2 text-[12.5px] text-ink-subtle">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Reading the launcher status&hellip;
          </p>
        ) : null}

        {load.state === 'error' ? (
          <ErrorNote>Could not read the launcher status: {load.message}</ErrorNote>
        ) : null}

        {/* The bucket answered but latest.json could not be read. Without this the
            live version reads as "none", i.e. as safe, when it is unknown. */}
        {liveError ? <ErrorNote>The live release could not be read: {liveError}</ErrorNote> : null}

        {data && !data.releases?.length ? (
          <p className="m-0 text-[12px] text-ink-subtle">
            no releases &mdash; <span className="font-mono">gh</span> not logged in
          </p>
        ) : null}

        <div className="mt-4 rounded-lg border border-edge bg-surface">
          {/* Stage 1: bump. The level proposes the next version; the tag is
              derived from it and named on the button. Preview only starts ticked
              and is never unticked by the panel. */}
          <div className="flex flex-wrap items-center gap-3 px-6 py-4">
            <StageLabel n={1} title="Bump & tag" />
            {LEVELS.map((level) => (
              <Button
                key={level}
                size="sm"
                variant={releaseLevel === level ? 'primary' : 'secondary'}
                aria-pressed={releaseLevel === level}
                onClick={() => setReleaseLevel(level)}
                disabled={busy}
              >
                {level}
              </Button>
            ))}

            {repoVersion && proposedVersion ? (
              <span className="font-mono text-[12px] text-ink-muted">
                v{bare(repoVersion)} &rarr; v{proposedVersion}
              </span>
            ) : null}

            <label className="flex items-center gap-2 text-[12.5px] text-ink">
              <input
                type="checkbox"
                checked={releaseDryRun}
                disabled={busy}
                onChange={(event) => setReleaseDryRun(event.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Preview only
            </label>

            <Button
              variant="primary"
              onClick={() => void doRelease()}
              disabled={busy || !proposedTag}
              busy={release.busy}
              title={
                proposedTag
                  ? `Bump the version files to ${proposedVersion} and push ${proposedTag}`
                  : 'The repo version could not be read.'
              }
            >
              {!release.busy ? <Tag aria-hidden size={14} /> : null}
              Bump &amp; tag
              {proposedTag ? <span className="font-mono text-[12px]">{proposedTag}</span> : null}
            </Button>
          </div>
          <Stream stream={release} label="Release output" />

          {/* Stage 2: the build CI runs off the pushed tag. Re-running is the
              repair for a runner-side failure; a code failure is named here so
              the reason is on screen, not re-run blindly. */}
          <div className="flex flex-wrap items-center gap-3 border-t border-edge px-6 py-4">
            <StageLabel n={2} title="Build (CI)" />
            <CiStatus ci={data?.ci} tag={data?.targetTag} />
            <div className="ml-auto flex flex-wrap items-center gap-3">
              {/* Which platforms a dispatch should build. macOS and Linux by
                  default; Windows is normally built locally, so it is off until
                  asked for. */}
              <span
                role="group"
                aria-label="Platforms to build"
                className="flex items-center gap-2.5"
              >
                {PLATFORMS.map((name) => (
                  <label
                    key={name}
                    className="flex items-center gap-1 text-[12.5px] text-ink capitalize"
                  >
                    <input
                      type="checkbox"
                      checked={platforms[name]}
                      disabled={busy}
                      onChange={(event) =>
                        setPlatforms((current) => ({ ...current, [name]: event.target.checked }))
                      }
                      className="size-3.5 accent-[var(--color-accent)]"
                    />
                    {name}
                  </label>
                ))}
              </span>
              <Button
                variant="primary"
                onClick={() => void doBuild()}
                disabled={busy || !selectedPlatforms || !data?.targetTag}
                busy={build.busy}
                title={
                  data?.targetTag
                    ? `Dispatch a ${data.targetTag} build for ${selectedPlatforms || 'no platforms'}`
                    : 'The repo version could not be read.'
                }
              >
                {!build.busy ? <Hammer aria-hidden size={14} /> : null}
                Build
              </Button>
              {/* Move the version's tag onto the current commit and rebuild it
                  without a bump: the recovery when the tag's own commit is what
                  failed. Hidden once the build passes, where a move fixes nothing. */}
              {canRetag ? (
                <Button
                  onClick={() => void doRetag()}
                  disabled={busy}
                  busy={retag.busy}
                  title={`Move ${data?.targetTag} onto the current commit and rebuild it, keeping the version`}
                >
                  {!retag.busy ? <GitBranch aria-hidden size={14} /> : null}
                  Re-tag at HEAD
                </Button>
              ) : null}
            </div>
          </div>
          <Stream stream={build} label="Build rerun output" />
          <Stream stream={retag} label="Re-tag output" />

          {/* Stage 3: publish the built release to R2. Only a tag CI has built and
              released is waiting, so with nothing built the button names why. */}
          <div className="flex flex-wrap items-center gap-3 border-t border-edge px-6 py-4">
            <StageLabel n={3} title="Publish" />
            <Button
              variant="primary"
              size="lg"
              onClick={() => void doPublish()}
              disabled={busy || !nextTag}
              busy={publish.busy}
              title={
                nextTag ? `Publish ${nextTag}` : 'No built release is newer than the live version.'
              }
            >
              {!publish.busy ? <Rocket aria-hidden size={14} /> : null}
              Publish
              {nextTag ? <span className="font-mono text-[12px]">{nextTag}</span> : null}
            </Button>

            {!nextTag && !busy ? (
              // Said plainly rather than silently falling back to a disabled
              // button: with nothing waiting, the reason is not the button.
              <span className="text-[12.5px] text-ink-subtle">nothing waiting</span>
            ) : null}

            <label className="flex items-center gap-2 text-[12.5px] text-ink">
              <input
                type="checkbox"
                checked={confirmPublish}
                disabled={busy}
                onChange={(event) => setConfirmPublish(event.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Upload for real
            </label>
          </div>

          {/* The one line on this page that stops a mistake: a real upload has no
              other warning except a checkbox and a native confirm. */}
          {confirmPublish ? (
            <p className="m-0 border-t border-edge px-6 py-2 text-[12px] text-warn">
              Writes to the bucket &mdash; players on an older version get this immediately.
            </p>
          ) : null}
          <Stream stream={publish} label="Launcher publish output" />

          {/* Row 3: the signing key. Always safe: it signs a throwaway file. */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-6 py-4">
            <span className="text-[12.5px] text-ink">Signing key</span>
            <Button
              onClick={() => void keys.start('/api/launcher/keys', {})}
              disabled={busy}
              busy={keys.busy}
            >
              {!keys.busy ? <KeyRound aria-hidden size={14} /> : null}
              Check keys
            </Button>
          </div>
          <Stream stream={keys} label="Signing key check output" />
        </div>
      </div>
    </div>
  );
}

/** A stage's number and name, so the three verbs read as one ordered flow. */
function StageLabel({ n, title }: { n: number; title: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex size-5 items-center justify-center rounded-full border border-edge font-mono text-[11px] text-ink-subtle">
        {n}
      </span>
      <span className="text-[12px] text-ink-muted">{title}</span>
    </span>
  );
}

/**
 * CI's verdict for the current version's tag: a word, the run link, and the jobs
 * that did not pass.
 *
 * A version with no run yet says so rather than reading as a pass, and a failed
 * run names its jobs so the reason is on screen instead of implied by a disabled
 * Publish button.
 */
function CiStatus({ ci, tag }: { ci: LauncherStatus['ci']; tag: string | null | undefined }) {
  if (!tag) {
    return <span className="text-[12.5px] text-ink-subtle">repo version unknown</span>;
  }
  if (!ci) {
    return (
      <span className="text-[12.5px] text-ink-subtle">
        no run yet for <span className="font-mono">{tag}</span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 max-w-2xl flex-col gap-0.5 text-[12.5px]">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5">
          <CiGlyph ci={ci} />
          <span className={cx('font-medium', ciTone(ci))}>{ciWord(ci)}</span>
        </span>
        <span className="font-mono text-ink-subtle">{tag}</span>
        {ci.url ? (
          <a
            href={ci.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-ink-muted hover:text-ink"
          >
            Actions <ExternalLink aria-hidden size={12} />
          </a>
        ) : null}
        {ci.failedJobs.length ? (
          <span className="text-status-error">{ci.failedJobs.join(', ')}</span>
        ) : null}
      </span>
      {/* The reason a run is red, when GitHub recorded one: a runner billing
          block, a missing secret. Without it "failed" is the whole story and the
          operator has nothing to act on. */}
      {ci.reason ? <span className="text-ink-muted">{ci.reason}</span> : null}
    </span>
  );
}

function CiGlyph({ ci }: { ci: NonNullable<LauncherStatus['ci']> }) {
  if (ci.status && ci.status !== 'completed') {
    return <Loader2 aria-hidden size={13} className="animate-spin text-warn" />;
  }
  if (ci.conclusion === 'success') {
    return <CheckCircle2 aria-hidden size={13} className="text-accent" />;
  }
  return <AlertTriangle aria-hidden size={13} className="text-status-error" />;
}

/**
 * The run's word. `status` is read before `conclusion` because a run reports a
 * status for its whole life and a conclusion only once it is complete, so a run
 * that has not concluded never falls through to "passed".
 */
function ciWord(ci: NonNullable<LauncherStatus['ci']>): string {
  if (ci.status && ci.status !== 'completed') {
    return ci.status === 'in_progress' ? 'building' : ci.status;
  }
  switch (ci.conclusion) {
    case 'success':
      return 'passed';
    case 'failure':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'timed_out':
      return 'timed out';
    default:
      return ci.conclusion ?? 'unknown';
  }
}

function ciTone(ci: NonNullable<LauncherStatus['ci']>): string {
  if (ci.status && ci.status !== 'completed') return 'text-warn';
  return ci.conclusion === 'success' ? 'text-accent' : 'text-status-error';
}

/**
 * The header's verdict, as a word with a matching glyph.
 *
 * Never a sentence comparing two versions, and never colour alone - the word and
 * the icon both carry it. "live unread" wins over a comparison, because a version
 * that could not be read must not be compared as if it were a value.
 */
function Verdict({
  live,
  repo,
  unreachable,
}: {
  live: string | null;
  repo: string | null;
  unreachable: boolean;
}) {
  if (unreachable) {
    return (
      <span className="flex items-center gap-1.5">
        <AlertTriangle className="size-3.5 text-warn" aria-hidden="true" />
        <StatusWord tone="text-warn">live unread</StatusWord>
      </span>
    );
  }
  if (live === null) {
    return <StatusWord tone="text-warn">not published</StatusWord>;
  }
  if (!repo) return null;
  const comparison = compareVersions(repo, live);
  if (comparison === 0) {
    return (
      <span className="flex items-center gap-1.5">
        <CheckCircle2 className="size-3.5 text-accent" aria-hidden="true" />
        <StatusWord tone="text-accent">in sync</StatusWord>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      {comparison > 0 ? (
        <ArrowUp className="size-3.5 text-warn" aria-hidden="true" />
      ) : (
        <ArrowDown className="size-3.5 text-warn" aria-hidden="true" />
      )}
      <StatusWord tone="text-warn">{comparison > 0 ? 'repo ahead' : 'repo behind'}</StatusWord>
    </span>
  );
}

/**
 * One streamed run and its verdict.
 *
 * The verdict decides the outcome, and all three SSE events - output, error,
 * done - are surfaced by usePublisherStream, so a publisher that exited non-zero
 * can never render as a success. Nothing renders until a run starts.
 */
function Stream({
  stream,
  label,
}: {
  stream: ReturnType<typeof usePublisherStream>;
  label: string;
}) {
  if (stream.verdict.state === 'idle') return null;
  const line = verdictLine(stream.verdict);
  return (
    <div className="border-t border-edge px-6 pb-4">
      <pre className="dw-log" aria-label={label} aria-live="polite" tabIndex={0}>
        {stream.log}
      </pre>
      {line ? (
        <p className={cx('m-0 mt-1 text-[12px] font-medium', verdictTone(stream.verdict))}>
          {line.text}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Real @theme tokens for the verdict line.
 *
 * verdictLine names its tones against a different palette, so its colour would be
 * dropped; the words were always there, this is only the colour that pairs with
 * them.
 */
function verdictTone(verdict: StreamVerdict): string {
  switch (verdict.state) {
    case 'running':
      return 'text-ink-subtle';
    case 'ok':
      return 'text-accent';
    case 'stopped':
      return 'text-warn';
    default:
      return 'text-danger';
  }
}
