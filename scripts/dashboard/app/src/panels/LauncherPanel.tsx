/**
 * The Launcher's own version ladder and its release verbs.
 *
 * The header IS the ladder. repo, live, the waiting tags and the two tallies sit
 * on one row beside Refresh, because the one question this page answers is
 * whether those two versions differ - and an answer split across two stacked
 * cards is an answer the reader has to assemble. Waiting tags are CHIPS and
 * clickable: one click picks that specific tag and reveals the manual field.
 *
 * PUBLISHING IS ONE CLICK. The common case - publish the newest waiting tag - is
 * the primary button, with the tag it will send printed on the button face. The
 * manual tag field is hidden behind "or a specific tag": a visible field, even
 * pre-filled, reads as a form to fill in. Nothing about the safety changes - dry
 * run is still the default and is never auto-unticked, publishing without "Upload
 * for real" is still a dry run, and a real publish still fires a confirm first.
 *
 * The actions are one panel of three hairline-separated rows: publish, bump the
 * release, check the signing key. Each row names its own verb, so the form needs
 * no section headings inside it.
 *
 * Global, not game-scoped: the launcher is the app itself, not a game, and
 * nothing here acts on the selection in the rail.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, KeyRound, Loader2, RefreshCw, Rocket, Tag } from 'lucide-react';

import { apiGet, messageOf } from '@/lib/api';
import { compareVersions } from '@lib/version';
import { DataAge } from '@components/ui';
import { cx } from './cx';
import { usePublisherStream, verdictLine, type StreamVerdict } from './usePublisherStream';

/** `GET /api/launcher/status`. */
interface LauncherStatus {
  published?: {
    version: string | null;
    targets: string[];
    artifactCount: number;
  } | null;
  releases?: Array<{ tagName: string; isDraft?: boolean }>;
  packageVersion?: string;
  cdnOrigin?: string;
  error?: string;
}

const TAG_PATTERN = /^v\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/;

/**
 * `v` stripped, so a tag compares as numbers.
 *
 * Numeric-per-component on purpose: a string sort puts v0.1.10 before v0.1.9,
 * which would name the OLDER tag as the newest one waiting to publish.
 */
function bare(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

/** The newest release that is not live, by numeric version rather than order. */
function newestWaiting(releases: LauncherStatus['releases'], live: string | null): string | null {
  return (releases ?? []).reduce<string | null>((best, release) => {
    if (live && release.tagName === `v${live}`) return best;
    if (!best) return release.tagName;
    return compareVersions(bare(release.tagName), bare(best)) > 0 ? release.tagName : best;
  }, null);
}

export default function LauncherPanel() {
  const [load, setLoad] = useState<
    | { state: 'loading' }
    | { state: 'ready'; data: LauncherStatus; ageMs: number | null }
    | { state: 'error'; message: string }
  >({ state: 'loading' });
  const [tag, setTag] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  // Whether the manual tag field is shown. FALSE by default, and that is the
  // whole point: a pre-filled field sitting on screen reads as a form to fill in,
  // which is what made this read as manual work. The common case - publish the
  // newest waiting tag - is one button with nothing to type.
  const [manualTag, setManualTag] = useState(false);
  const [releaseLevel, setReleaseLevel] = useState<'patch' | 'minor' | 'major'>('patch');
  const [releaseDryRun, setReleaseDryRun] = useState(true);

  // Display only - the release script computes the version it writes. It is here so
  // the level's effect is on screen: "minor" with nothing saying 0.2.0 reads the
  // same as "patch", which would quietly produce 0.1.1.
  function nextVersion(version: string, level: 'patch' | 'minor' | 'major') {
    const parts = version.split('.').map((part) => parseInt(part, 10) || 0);
    const major = parts[0] ?? 0;
    const minor = parts[1] ?? 0;
    const patch = parts[2] ?? 0;
    if (level === 'major') return `${major + 1}.0.0`;
    if (level === 'minor') return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
  }

  const publish = usePublisherStream();
  const release = usePublisherStream();
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
    // Keep whatever is already on the ladder and mark it refreshing rather than
    // blanking it to a spinner: a refresh is not a reason to lose the values
    // being read. Only the first load has nothing to keep.
    setLoad((current) => (current.state === 'ready' ? current : { state: 'loading' }));
    setRefreshing(true);
    try {
      const result = await request();
      setLoad({ state: 'ready', data: result.data, ageMs: result.ageMs });
      // Only when the operator has not typed anything: a tag they chose is never
      // overwritten.
      setTag((current) => {
        if (current) return current;
        const live = result.data.published?.version ?? null;
        return newestWaiting(result.data.releases, live) ?? '';
      });
    } catch (err) {
      setLoad({ state: 'error', message: messageOf(err) });
    } finally {
      setRefreshing(false);
    }
  }, [request]);

  // Started through a resolved promise rather than called directly, so the state
  // updates land in a callback after the effect body instead of synchronously
  // inside it. Same fetch, same tag defaulting, same error path - only the render
  // it lands on differs.
  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const data = load.state === 'ready' ? load.data : null;
  const liveVersion = data?.published?.version ?? null;
  const repoVersion = data?.packageVersion ?? null;
  // The releases that exist and are NOT live: exactly the things waiting for a
  // publish, which is also what the tag datalist offers.
  const waiting = (data?.releases ?? []).filter(
    (r) => !liveVersion || r.tagName !== `v${liveVersion}`
  );
  // What Publish next sends. Recomputed from the releases rather than read from
  // `tag`, so it is always the newest waiting tag even after the operator has
  // typed something else into the manual field. Numeric-per-component, via
  // newestWaiting - a string sort would name the OLDER tag as the newest.
  const nextTag = newestWaiting(data?.releases, liveVersion);

  async function doPublish(tagToPublish: string) {
    const trimmed = tagToPublish.trim();
    // The server validates the tag against the release pattern and refuses
    // anything else, so this is a friendlier copy of a rule it enforces anyway.
    if (!TAG_PATTERN.test(trimmed)) {
      await publish.start('/api/launcher/publish', { tag: trimmed, confirm: false });
      return;
    }
    if (
      confirmPublish &&
      !window.confirm('Upload this launcher to R2? Players will see it immediately.')
    ) {
      return;
    }
    await publish.start('/api/launcher/publish', { tag: trimmed, confirm: confirmPublish });
    // Never left armed: a real publish is a one-off, and a box that stays ticked
    // would make the next click upload a different tag without asking.
    setConfirmPublish(false);
    await refresh();
  }

  async function doRelease() {
    if (
      !releaseDryRun &&
      !window.confirm('Bump the version, commit and push a tag? This triggers CI.')
    ) {
      return;
    }
    // `confirm` is what makes it real. The server treats a payload without it as a
    // preview, so a click that loses the flag cannot commit, tag and push.
    await release.start('/api/launcher/release', {
      level: releaseLevel,
      confirm: !releaseDryRun,
    });
    await refresh();
  }

  // The panel owns three streams, so no two of them may run at once: two
  // publishers writing to the same bucket with interleaved logs is worse than a
  // disabled button.
  const busy = publish.busy || release.busy || keys.busy;

  return (
    <div className="flex flex-col">
      {/* The header IS the ladder: repo, live, waiting, the verdict word, the two
          tallies and Refresh on one row, in the Games header's arrangement. */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-edge pb-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1">
          <Rung
            label="repo"
            value={repoVersion ? `v${bare(repoVersion)}` : 'unknown'}
            dot="bg-ink-faint"
            tone="text-ink"
          />
          <Rung
            label="live"
            value={liveVersion ? `v${bare(liveVersion)}` : 'none'}
            dot="bg-accent"
            tone={liveVersion ? 'text-accent' : 'text-ink-subtle'}
          />
          <WaitingChips
            tags={waiting.map((r) => r.tagName)}
            selected={tag}
            onPick={(picked) => {
              setTag(picked);
              // A chip IS the specific-tag case, so picking one reveals the field
              // and the choice lands in it.
              setManualTag(true);
            }}
          />

          {liveVersion === null ? (
            <StatusWord tone="text-warn">not published</StatusWord>
          ) : !repoVersion ? null : compareVersions(repoVersion, liveVersion) === 0 ? (
            <StatusWord tone="text-accent">in sync</StatusWord>
          ) : compareVersions(repoVersion, liveVersion) > 0 ? (
            <StatusWord tone="text-warn">unshipped</StatusWord>
          ) : (
            <StatusWord tone="text-warn">repo behind</StatusWord>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-4">
          <Tally value={data?.published?.targets.length ?? 0} label="targets" />
          <Tally value={data?.published?.artifactCount ?? 0} label="installers" />
          {load.state === 'ready' ? (
            <DataAge ageMs={load.ageMs} cache={null} refreshing={refreshing} />
          ) : null}
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={load.state === 'loading' || refreshing || busy}
            aria-label="Re-read the launcher status, the live release and the GitHub releases"
            title="Re-read the launcher status. Nothing here refreshes on its own."
            className="dw-button"
          >
            <RefreshCw
              className={cx('size-3.5', (refreshing || load.state === 'loading') && 'animate-spin')}
              aria-hidden="true"
            />
            Refresh
          </button>
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
          <p
            role="alert"
            className="m-0 flex items-start gap-2 rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>Could not read the launcher status: {load.message}</span>
          </p>
        ) : null}

        {data && !data.releases?.length ? (
          <p className="m-0 text-[12px] text-ink-subtle">
            no releases &mdash; <span className="font-mono">gh</span> not logged in
          </p>
        ) : null}

        <div className="mt-4 rounded-lg border border-edge bg-surface">
          {/* Row 1: publish. The COMMON CASE IS ONE CLICK: Publish next sends the
              newest waiting tag with nothing typed, and it is the primary
              button. The manual tag field is hidden behind a small toggle, so the
              field that made this feel like manual work is not on screen at all.

              Every gate below is unchanged and still load-bearing: dry run is the
              DEFAULT (the server's own default, never auto-unticked here),
              publishing without "Upload for real" is a dry run, and a real publish
              fires window.confirm before anything is sent. */}
          <div className="flex flex-wrap items-center gap-3 px-6 py-4">
            <button
              type="button"
              onClick={() => void doPublish(nextTag ?? '')}
              disabled={busy || !nextTag}
              title={
                nextTag
                  ? `Publish ${nextTag}`
                  : 'No waiting tags. Bump and tag to make a release first.'
              }
              className="dw-button dw-button-primary"
            >
              {publish.busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Rocket className="size-3.5" aria-hidden="true" />
              )}
              Publish next
              {/* The tag the button will publish, named on the button itself, so
                  the operator can see what one click will do without opening
                  anything. */}
              {nextTag ? <span className="font-mono text-[12px]">{nextTag}</span> : null}
            </button>

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

            {/* The rare case, revealed rather than shown. */}
            <button
              type="button"
              onClick={() => setManualTag((on) => !on)}
              aria-expanded={manualTag}
              className="border-none bg-none p-0 text-[12px] text-ink-subtle underline underline-offset-2 hover:text-ink"
            >
              {manualTag ? 'hide specific tag' : 'or a specific tag'}
            </button>
          </div>

          {manualTag ? (
            <div className="flex flex-wrap items-end gap-3 border-t border-edge px-6 py-4">
              <label className="flex min-w-52 flex-1 flex-col gap-1.5 text-[12px] text-ink-muted">
                Tag
                <input
                  id="launcher-tag"
                  type="text"
                  list="launcher-tag-options"
                  value={tag}
                  onChange={(event) => setTag(event.target.value)}
                  placeholder="v0.1.0"
                  autoComplete="off"
                  className="dw-input font-mono"
                />
                <datalist id="launcher-tag-options">
                  {waiting.map((one) => (
                    <option key={one.tagName} value={one.tagName} />
                  ))}
                </datalist>
              </label>

              <button
                type="button"
                onClick={() => void doPublish(tag)}
                disabled={busy || !tag.trim()}
                className="dw-button"
              >
                {publish.busy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Rocket className="size-3.5" aria-hidden="true" />
                )}
                {confirmPublish ? 'Upload to R2' : 'Dry run'}
              </button>
            </div>
          ) : null}

          {/* The one line on this page that stops a mistake: a real upload has no
              other warning except a checkbox and a native confirm. */}
          {confirmPublish ? (
            <p className="m-0 border-t border-edge px-6 py-2 text-[12px] text-warn">
              Writes to the bucket &mdash; players on an older version get this immediately.
            </p>
          ) : null}
          <Stream stream={publish} label="Launcher publish output" />

          {/* Row 2: bump. Preview only starts ticked and is never unticked by the
              panel; only the operator's own hand does that. */}
          <div className="flex flex-wrap items-center gap-3 border-t border-edge px-6 py-4">
            <span className="text-[12px] text-ink-muted">Bump</span>
            {(['patch', 'minor', 'major'] as const).map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={releaseLevel === level}
                onClick={() => setReleaseLevel(level)}
                className={cx('dw-button', releaseLevel === level && 'dw-button-primary')}
              >
                {level}
              </button>
            ))}

            {liveVersion ? (
              <span className="text-[12px] text-ink-muted">
                {liveVersion} &rarr; {nextVersion(liveVersion, releaseLevel)}
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

            <button
              type="button"
              onClick={() => void doRelease()}
              disabled={busy}
              className="dw-button dw-button-primary"
            >
              {release.busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Tag className="size-3.5" aria-hidden="true" />
              )}
              Bump and tag
            </button>
          </div>
          <Stream stream={release} label="Release output" />

          {/* Row 3: the signing key. Always safe: it signs a throwaway file. */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-6 py-4">
            <span className="text-[12.5px] text-ink">Signing key</span>
            <button
              type="button"
              onClick={() => void keys.start('/api/launcher/keys', {})}
              disabled={busy}
              className="dw-button"
            >
              {keys.busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="size-3.5" aria-hidden="true" />
              )}
              Check keys
            </button>
          </div>
          <Stream stream={keys} label="Signing key check output" />
        </div>
      </div>
    </div>
  );
}

/** One rung of the ladder: a dot for the role, the role's name, the value. */
function Rung({
  label,
  value,
  dot,
  tone,
}: {
  label: string;
  value: string;
  dot: string;
  tone: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={cx('size-1.5 shrink-0 self-center rounded-[1px]', dot)} aria-hidden="true" />
      <span className="text-[11px] text-ink-subtle">{label}</span>
      <span className={cx('font-mono text-[15px] tracking-[-0.01em] whitespace-nowrap', tone)}>
        {value}
      </span>
    </span>
  );
}

/**
 * Releases built and not yet published, as amber chips.
 *
 * Amber plus the word "waiting", so the state survives being read without the
 * colour. Each chip is a button: it fills the manual tag field and reveals it,
 * which is how a chip becomes the rare specific-tag case without that case
 * costing a visible field on every load.
 */
function WaitingChips({
  tags,
  selected,
  onPick,
}: {
  tags: string[];
  selected: string;
  onPick: (tag: string) => void;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-ink-subtle">waiting</span>
      {tags.length === 0 ? (
        <span className="text-[11px] text-ink-faint">none</span>
      ) : (
        tags.map((tagName) => {
          const active = tagName === selected;
          return (
            <button
              key={tagName}
              type="button"
              onClick={() => onPick(tagName)}
              aria-pressed={active}
              title={`Publish ${tagName}`}
              className={cx(
                'rounded-sm border px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap',
                active
                  ? 'border-warn bg-warn/25 text-warn'
                  : 'border-warn/40 bg-warn/10 text-warn hover:bg-warn/20'
              )}
            >
              {tagName}
            </button>
          );
        })
      )}
    </span>
  );
}

/** A number with its unit beside it, so the magnitude reads before the word. */
function Tally({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-[15px] text-ink">{value}</span>
      <span className="text-[11px] text-ink-subtle">{label}</span>
    </span>
  );
}

/** The ladder's verdict, as a word. Never a sentence comparing two versions. */
function StatusWord({ tone, children }: { tone: string; children: string }) {
  return (
    <span className={cx('text-[11px] font-semibold uppercase tracking-[0.06em]', tone)}>
      {children}
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
