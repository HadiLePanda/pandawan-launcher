/**
 * The Catalog panel: a real CRUD table over the catalog the launcher reads.
 *
 * The first job is display: every game on the CDN, with its real artwork, in a
 * table. The second is safety: `scripts/lib/catalog-merge.mjs` merges additively
 * in one direction only, and that reason is stated in the UI next to the publish
 * button rather than in a README:
 *
 *   - a game the CDN already lists is left byte-identical,
 *   - a game the CDN has never seen is added,
 *   - a game the local file omits is NOT removed.
 *
 * So the diff below the table is the payload of this panel: it answers "what will
 * pressing publish actually do", which a bare button cannot.
 *
 * GLOBAL, not game-scoped: it edits the catalog document, not the game selected
 * in the rail, and says so in its own header.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileWarning,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiGet, messageOf } from '@/lib/api';
import {
  KNOWN_CHANNELS as CHANNELS,
  type CatalogDiff,
  type CatalogEntry as CatalogGame,
  type CatalogPlan,
  type CatalogResponse,
  type MetaFieldSpec,
} from '@/types/api';
import { splitList } from '@lib/format';
import { platformTone } from '@lib/platform-hue';
import { useSession } from '@store/session';
import { Thumb } from './Thumb';
import { cx } from './cx';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  GlobalPanel,
  Spinner,
  TextInput,
} from './ui';
import { channelTone } from './channel-tone';
import { usePublisherStream, verdictLine } from './usePublisherStream';

/**
 * The catalog response plus the publish plan, which is what makes the merge
 * decision visible before the button is pressed. `plan` stays optional so a
 * server that does not send one still renders - the same degrade-gracefully
 * rule the rest of /api/catalog follows.
 */
type CatalogResponseWithPlan = CatalogResponse & { plan?: CatalogPlan };

type Load =
  | { state: 'loading' }
  | { state: 'ready'; data: CatalogResponseWithPlan }
  | { state: 'error'; message: string };

export default function CatalogPanel() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [registering, setRegistering] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CatalogGame | null>(null);
  const [publishDryRun, setPublishDryRun] = useState(true);
  const publish = usePublisherStream();

  // The one link out of registration: pick the game in the rail and open its
  // Metadata tab, where its display fields live. The catalog never edits them.
  const select = useSession((state) => state.select);
  const setSection = useSession((state) => state.setSection);
  const setTab = useSession((state) => state.setTab);

  function openMetadata(game: CatalogGame) {
    const channel = String(game.channel ?? '').trim();
    // A channel is required by validateCatalog; an entry without one cannot be
    // resolved into a scope, so the link is disabled rather than misleading.
    if (!channel) return;
    select(game.id, channel);
    setSection('games');
    setTab('metadata');
  }

  // The request, with no setState in it. A loader that reaches into component
  // state makes the effect below a synchronous setState, which the react-hooks
  // set-state-in-effect rule rejects for the cascading second render it causes.
  const request = useCallback(async () => {
    // A refresh after an edit must not be served from the panel's own cache,
    // or the table would redraw showing the value it was just corrected for.
    // `refresh: true` becomes ?refresh=1, which the server honours.
    const { data } = await apiGet<CatalogResponseWithPlan>('/api/catalog', { refresh: true });
    return data;
  }, []);

  const refresh = useCallback(async () => {
    setLoad({ state: 'loading' });
    try {
      setLoad({ state: 'ready', data: await request() });
    } catch (err) {
      setLoad({ state: 'error', message: messageOf(err) });
    }
  }, [request]);

  // Started through a resolved promise rather than called directly, so the state
  // update lands in a callback after the effect body instead of synchronously
  // inside it. Same fetch, same error path - only the render it lands on differs.
  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const liveGames = useMemo(
    () => (load.state === 'ready' ? (load.data.live?.games ?? []) : []),
    [load]
  );

  // The server reports a per-side status and detail, not a single error string:
  // "absent" is normal on a fresh bucket while "unreadable" needs explaining, and
  // the banner is only true when the side could not be read at all.
  const liveProblem = load.state === 'ready' ? problemDetail(load.data) : undefined;
  const localProblem = load.state === 'ready' ? localProblemDetail(load.data) : undefined;
  const diff: CatalogDiff =
    load.state === 'ready' ? load.data.diff : { onlyLive: [], onlyLocal: [], changed: [] };
  // The served field contract, so the editor and the diff labels both render from
  // the server's list rather than a hand-typed copy that could drift.
  const fields = load.state === 'ready' ? (load.data.fieldSpec ?? []) : [];

  async function handlePublish() {
    // Dry run is the default, as for every other publish verb: the diff above is
    // the preview and this only uploads once the checkbox is cleared.
    const code = await publish.start('/api/catalog', { dryRun: publishDryRun });
    // Reloaded even on failure: a publish that added nothing still leaves the
    // local file the source for the next diff, and the operator needs to see the
    // state as it is now rather than as it was believed to be.
    if (code === 0 && !publishDryRun) await refresh();
  }

  async function handleDelete(game: CatalogGame) {
    const code = await publish.start('/api/catalog/delete', { id: game.id, confirm: true });
    setConfirmDelete(null);
    if (code === 0) await refresh();
  }

  return (
    <GlobalPanel
      title="Catalog"
      subtitle="Not scoped to the game in the rail: this publishes the catalog document as a whole."
      actions={
        <>
          <Button onClick={() => void refresh()} aria-label="Reload the catalog">
            <RefreshCw aria-hidden size={14} />
            Reload
          </Button>
          <Button
            onClick={() => setRegistering(true)}
            disabled={publish.busy}
            aria-label="Register a game in the catalog"
          >
            <Plus aria-hidden size={14} />
            Register a game
          </Button>
        </>
      }
    >
      {liveProblem ? (
        <ErrorNote>
          The live catalog could not be read: {liveProblem} Publishing is refused until the CDN is
          reachable again.
        </ErrorNote>
      ) : null}
      {localProblem ? (
        <ErrorNote>
          The local file could not be read: {localProblem} Nothing can be added until that is fixed.
        </ErrorNote>
      ) : null}

      {registering ? (
        <RegisterGame
          existingIds={liveGames.map((game) => game.id)}
          onCancel={() => setRegistering(false)}
          onDone={async () => {
            setRegistering(false);
            await refresh();
          }}
        />
      ) : null}

      {confirmDelete ? (
        <DeleteConfirmation
          game={confirmDelete}
          busy={publish.busy}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => void handleDelete(confirmDelete)}
        />
      ) : null}

      {load.state === 'loading' ? (
        <Card>
          <Spinner label="Reading the live catalog from the CDN…" />
        </Card>
      ) : null}

      {load.state === 'error' ? (
        <ErrorNote>Could not read the catalog: {load.message}</ErrorNote>
      ) : null}

      {load.state === 'ready' ? (
        <>
          <CatalogTable
            games={liveGames}
            busy={publish.busy}
            onOpen={openMetadata}
            onDelete={(game) => setConfirmDelete(game)}
          />

          <DiffReport
            diff={diff}
            liveCount={liveGames.length}
            localCount={load.data.local?.games?.length ?? 0}
            fields={fields}
          />

          {registering ? null : (
            <PublishCard
              diff={diff}
              plan={load.data.plan}
              busy={publish.busy}
              dryRun={publishDryRun}
              onDryRunChange={setPublishDryRun}
              onPublish={() => void handlePublish()}
              fields={fields}
            />
          )}
        </>
      ) : null}

      {publish.log && publish.verdict.state !== 'idle' && !registering ? (
        <PublishLog log={publish.log} verdict={publish.verdict} />
      ) : null}
    </GlobalPanel>
  );
}

/**
 * A side's read failure, or undefined when there is nothing to report.
 *
 * `absent` is not a problem: an unpublished catalog or an empty local file is a
 * normal first-run state, and the diff below explains it without a banner. Only a
 * side that exists but could not be read or parsed blocks a publish.
 */
function sideProblem(status: string | undefined, detail: string | undefined): string | undefined {
  return status === 'unreadable' || status === 'invalid' ? detail || status : undefined;
}

function problemDetail(data: CatalogResponse): string | undefined {
  return sideProblem(data.liveStatus, data.liveDetail);
}

function localProblemDetail(data: CatalogResponse): string | undefined {
  return sideProblem(data.localStatus, data.localDetail);
}

// --- The table ------------------------------------------------------------

function CatalogTable({
  games,
  busy,
  onOpen,
  onDelete,
}: {
  games: CatalogGame[];
  busy: boolean;
  /** Select the game in the rail and open its Metadata tab. */
  onOpen: (game: CatalogGame) => void;
  onDelete: (game: CatalogGame) => void;
}) {
  if (!games.length) {
    return (
      <EmptyState
        title="The live catalog has no games"
        children="Nothing is published for the launcher to list yet. Register a game, or publish the local catalog.json."
      />
    );
  }

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Every game in the catalog the CDN currently serves</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-ink-muted">
            <th scope="col" className="px-3 py-2 font-medium">
              Artwork
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Name
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Id
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Channel
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Platforms
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Developer
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {games.map((game) => (
            <tr
              key={game.id}
              className="border-b border-border/60 last:border-0 hover:bg-surface-light/40"
            >
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <Thumb url={game.iconUrl} alt={`${label(game)} icon`} />
                  <Thumb url={game.bannerUrl} alt={`${label(game)} banner`} shape="wide" />
                </div>
              </td>
              <td className="px-3 py-2 align-middle">
                <div className="font-medium text-ink">{label(game)}</div>
                {game.description ? (
                  <div className="mt-0.5 max-w-xs text-xs text-ink-dim">{game.description}</div>
                ) : null}
              </td>
              <td className="px-3 py-2 align-middle">
                <code className="font-mono text-xs text-ink-muted">{game.id}</code>
              </td>
              <td className="px-3 py-2 align-middle">
                {game.channel ? (
                  // The NAME stays in the badge and the colour is the fast path,
                  // not the other way round - see channelTone.
                  <Badge tone={channelTone(game.channel)}>{game.channel}</Badge>
                ) : (
                  // A channel is required by validateCatalog, so its absence means
                  // this entry cannot be published as it stands.
                  <Badge tone="bad">none</Badge>
                )}
              </td>
              <td className="px-3 py-2 align-middle">
                <PlatformList platforms={splitList(game.supportedPlatforms)} />
              </td>
              <td className="px-3 py-2 align-middle text-xs text-ink-muted">
                {game.developer || <span className="text-ink-subtle">not set</span>}
              </td>
              <td className="px-3 py-2 align-middle">
                {/* The display values above are READ-ONLY here: one editable home
                    per field, on the game's own page. This column is the link to
                    it, with the icon-only rule kept (the aria-label is the name,
                    `title` the tooltip). Disabled until the entry has a channel,
                    since there is no scope to select without one. */}
                <div className="flex items-center justify-end gap-1">
                  <Button
                    size="sm"
                    iconOnly
                    onClick={() => onOpen(game)}
                    disabled={busy || !String(game.channel ?? '').trim()}
                    title={`Open ${label(game)} in Metadata`}
                    aria-label={`Open ${label(game)} in Games, Metadata`}
                  >
                    <ExternalLink aria-hidden size={13} />
                  </Button>
                  <Button
                    size="sm"
                    iconOnly
                    variant="danger"
                    onClick={() => onDelete(game)}
                    disabled={busy}
                    title={`Delete ${label(game)}`}
                    aria-label={`Delete ${label(game)} from the catalog`}
                  >
                    <Trash2 aria-hidden size={13} />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function PlatformList({ platforms }: { platforms: string[] }) {
  if (!platforms.length) return <span className="text-xs text-ink-subtle">none declared</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {platforms.map((platform) => (
        <Badge key={platform} tone={platformTone(platform)}>
          {platform}
        </Badge>
      ))}
    </div>
  );
}

function label(game: CatalogGame): string {
  const name = String(game.name ?? '').trim();
  return name || game.id;
}

// --- The diff -------------------------------------------------------------

/**
 * What publishing would do, before it is pressed.
 *
 * This is the payoff of the panel: catalog-merge.mjs merges additively, so the
 * only interesting question is which side has which game and which fields
 * disagree. A wall of prose would make it unreadable, so it is three scannable
 * columns - and each differing field is named, because "something differs" is not
 * actionable while "iconUrl and supportedPlatforms differ" is.
 */
function DiffReport({
  diff,
  liveCount,
  localCount,
  fields,
}: {
  diff: CatalogDiff;
  liveCount: number;
  localCount: number;
  fields: MetaFieldSpec[];
}) {
  const nothing = !diff.onlyLive.length && !diff.onlyLocal.length && !diff.changed.length;

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Local versus live</h3>
        <p className="text-xs text-ink-muted">
          {liveCount} live {liveCount === 1 ? 'game' : 'games'}, {localCount} in the local file.
        </p>
      </div>

      {nothing ? (
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <CheckCircle2 aria-hidden size={15} className="text-action" />
          The two agree. Publishing would change nothing.
        </p>
      ) : null}

      {nothing ? null : (
        <div className="grid gap-3 md:grid-cols-3">
          <DiffColumn
            title="Only on the CDN"
            tone="info"
            help="A publish never removes a game."
            ids={diff.onlyLive}
          />
          <DiffColumn
            title="Only in the local file"
            tone="good"
            help="What publishing adds."
            ids={diff.onlyLocal}
          />
          <DiffColumn
            title="Present in both, differing"
            tone="warn"
            help="A publish does not overwrite these."
            changed={diff.changed}
            fields={fields}
          />
        </div>
      )}
    </Card>
  );
}

function DiffColumn({
  title,
  tone,
  help,
  ids,
  changed,
  fields,
}: {
  title: string;
  tone: 'good' | 'warn' | 'info';
  help: string;
  ids?: string[];
  changed?: CatalogDiff['changed'];
  fields?: MetaFieldSpec[];
}) {
  const entries = ids ?? [];
  const entriesChanged = changed ?? [];
  const empty = !entries.length && !entriesChanged.length;

  return (
    <div className="rounded-md border border-border bg-canvas/40 p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold text-ink">{title}</h4>
        <Badge tone={tone}>{entries.length + entriesChanged.length}</Badge>
      </div>
      <p className="mt-1 text-xs text-ink-dim">{help}</p>

      {empty ? (
        <p className="mt-2 text-xs text-ink-subtle">Nothing in this category.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {entries.map((id) => (
            <li key={id} className="flex items-center gap-1.5 text-xs">
              <Plus aria-hidden size={12} className="shrink-0 text-action" />
              <code className="font-mono text-ink-muted">{id}</code>
            </li>
          ))}
          {entriesChanged.map((entry) => (
            <li key={entry.id} className="text-xs">
              <div className="flex items-center gap-1.5">
                <FileWarning aria-hidden size={12} className="shrink-0 text-ember" />
                <code className="font-mono text-ink-muted">{entry.id}</code>
              </div>
              {/* Named fields, not "differs": the operator has to know which
                  values the CDN is holding before deciding to leave them. */}
              <ul className="mt-1 ml-5 flex flex-wrap gap-1">
                {entry.fields.map((field) => (
                  <li key={field}>
                    <Badge tone="warn">{labelForField(fields ?? [], field)}</Badge>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Publish --------------------------------------------------------------

/** "1 game" / "2 games" - plain counts, read the way the sentence reads. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * The merge decision, above the publish control.
 *
 * Summarised from the publisher's own `publishPlan`, so what this says and what
 * the script does cannot disagree. `cdnWins` is the load-bearing list: it is the
 * edit that will NOT reach the launcher, because a live catalog entry is
 * authoritative and only --force lets the local copy win. Everything is phrased
 * prospectively - the plan is what pressing the button would do, and a dry run
 * has changed nothing yet.
 */
function PublishPlanSummary({ plan, fields }: { plan: CatalogPlan; fields: MetaFieldSpec[] }) {
  const { added, preserved, cdnWins, changed } = plan;

  return (
    <div className="mt-1 max-w-xl">
      <p className="text-[12px] text-ink-subtle">
        {changed
          ? `Publish would add ${count(added.length, 'game')}, keep ${count(preserved.length, 'game')}, and ignore ${count(cdnWins.length, 'local edit')}.`
          : cdnWins.length
            ? `Publishing would change nothing; ${count(cdnWins.length, 'local edit')} would still be ignored.`
            : 'Publishing would change nothing.'}
      </p>

      {cdnWins.length ? (
        <div className="mt-2 rounded-md border border-border bg-canvas/40 p-2">
          <p className="text-[12px] text-warn">
            The live catalog wins for these games, so the local edits below will not reach the
            launcher. Only <code className="font-mono">--force</code> would apply them, and that
            overwrites the live values.
          </p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {cdnWins.map((entry) => (
              <li key={entry.id} className="text-[12px]">
                <div className="flex items-center gap-1.5">
                  <FileWarning aria-hidden size={12} className="shrink-0 text-ember" />
                  <code className="font-mono text-ink-muted">{entry.id}</code>
                </div>
                <ul className="mt-1 ml-5 flex flex-wrap gap-1">
                  {entry.differs.map((field) => (
                    <li key={field.field}>
                      <Badge tone="warn">{labelForField(fields, field.field)}</Badge>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function PublishCard({
  diff,
  plan,
  busy,
  dryRun,
  onDryRunChange,
  onPublish,
  fields,
}: {
  diff: CatalogDiff;
  plan?: CatalogPlan;
  busy: boolean;
  dryRun: boolean;
  onDryRunChange: (value: boolean) => void;
  onPublish: () => void;
  fields: MetaFieldSpec[];
}) {
  const willAdd = diff.onlyLocal.length;
  const willKeep = diff.onlyLive.length;
  const willHold = diff.changed.length;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Publish the catalog</h3>
          {/* The plan is the publisher's own merge, so it is the trustworthy
              summary; the diff-derived line is only the fallback for a server
              that does not send one. A dry run changes nothing server-side, and
              the plan is phrased prospectively ("would add"), so it cannot read
              as applied - the checkbox below still owns that distinction. */}
          {plan ? (
            <PublishPlanSummary plan={plan} fields={fields} />
          ) : (
            <p className="mt-1 max-w-xl text-xs text-ink-muted">
              Adds {willAdd}, keeps {willKeep}, leaves {willHold} as the CDN has them. Never removes
              a game.
            </p>
          )}
          <label className="mt-3 inline-flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(event) => onDryRunChange(event.target.checked)}
              className="h-4 w-4 accent-[var(--color-action)]"
            />
            Preview only (dry run) - recommended
          </label>
          <p className="mt-1 text-xs text-ink-dim">
            {dryRun
              ? 'Prints what it would upload and writes nothing to the bucket.'
              : 'The CDN catalog will be rewritten for every player.'}
          </p>
        </div>
        <Button variant="primary" size="lg" onClick={onPublish} busy={busy} disabled={busy}>
          <Upload aria-hidden size={14} />
          {dryRun ? 'Preview publish' : 'Publish to CDN'}
        </Button>
      </div>
    </Card>
  );
}

function PublishLog({ log, verdict }: { log: string; verdict: Parameters<typeof verdictLine>[0] }) {
  const line = verdictLine(verdict);
  return (
    <Card>
      <h3 className="mb-2 text-sm font-semibold text-ink">Publisher output</h3>
      <pre
        className="max-h-96 overflow-auto rounded border border-border bg-canvas p-3 font-mono text-xs whitespace-pre-wrap text-ink-muted"
        tabIndex={0}
        aria-label="Publisher output log"
      >
        {log}
      </pre>
      {line ? <p className={cx('mt-2 text-xs font-medium', line.tone)}>{line.text}</p> : null}
    </Card>
  );
}

// --- Registration --------------------------------------------------------

/** The label for a diff field name, from the served contract; falls back to the key. */
function labelForField(fields: MetaFieldSpec[], key: string): string {
  return fields.find((field) => field.catalog === key)?.label ?? key;
}

/**
 * Registering a game - the catalog's only write that is about a game at all.
 *
 * Registration is id and channel: which games exist, and how the launcher resolves
 * each one's manifest. The display fields (name, description, developer, genres,
 * icon, banner, screenshots) are deliberately absent - they have exactly one
 * editable home, on the game's own Metadata page, and a second copy here is how
 * the two drift. A register writes the entry into the local catalog.json and
 * publishes the same additive merge the Publish button runs; existing entries are
 * never touched.
 */
function RegisterGame({
  existingIds,
  onCancel,
  onDone,
}: {
  existingIds: string[];
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const [id, setId] = useState('');
  const [channel, setChannel] = useState<string>(CHANNELS[0]);
  const [problem, setProblem] = useState<string | null>(null);
  const stream = usePublisherStream();
  const [done, setDone] = useState(false);
  const firstField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  const trimmedId = id.trim();
  const taken = existingIds.includes(trimmedId);
  // The server owns the format rule (catalog-edit.mjs); this only stops an
  // obviously unusable id from being sent at all.
  const constraint = !trimmedId
    ? 'An id is needed. It is the key every manifest URL is built from.'
    : !/^[a-z0-9][a-z0-9._-]*$/i.test(trimmedId)
      ? 'Use letters, digits, dots, dashes and underscores only, starting with a letter or digit.'
      : null;
  const blocking =
    constraint ?? (taken ? `The id "${trimmedId}" is already in the catalog.` : null);

  async function submit() {
    setProblem(null);
    if (blocking) {
      setProblem(blocking);
      return;
    }
    const code = await stream.start('/api/catalog/create', { id: trimmedId, channel });
    setDone(code === 0);
  }

  return (
    <Card className="border border-action/40">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Register a game</h3>
        <Button size="sm" variant="quiet" onClick={onCancel} aria-label="Close registration">
          Close
        </Button>
      </div>

      <p className="mb-3 max-w-prose text-xs text-ink-muted">
        Registers an entry in the catalog the launcher reads: which game exists, and the channel its
        manifest resolves to. The game's display fields are edited on its own Metadata page.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Id"
          required
          htmlFor="catalog-id"
          error={taken ? (blocking ?? null) : null}
          hint="The key every manifest URL is built from. Letters, digits, dots, dashes, underscores."
        >
          <TextInput
            id="catalog-id"
            ref={firstField}
            value={id}
            onChange={(event) => setId(event.target.value)}
            placeholder="pandawan-rising"
            className="font-mono"
          />
        </Field>

        <Field
          label="Channel"
          required
          htmlFor="catalog-channel"
          hint="The launcher builds its manifest URL from it."
        >
          <div className="flex gap-1.5" id="catalog-channel">
            {CHANNELS.map((one) => (
              <Button
                key={one}
                size="sm"
                variant={channel === one ? 'primary' : 'secondary'}
                onClick={() => setChannel(one)}
                aria-pressed={channel === one}
              >
                {one}
              </Button>
            ))}
          </div>
        </Field>
      </div>

      {problem ? <ErrorNote>{problem}</ErrorNote> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => void submit()}
          busy={stream.busy}
          disabled={stream.busy || Boolean(constraint)}
        >
          Register
        </Button>
        <Button onClick={onCancel} disabled={stream.busy}>
          Cancel
        </Button>
        <span className="text-xs text-ink-dim">
          Creates the entry in the local catalog.json and publishes the merge. Existing entries are
          never touched.
        </span>
      </div>

      {stream.log ? (
        <>
          <pre
            className="mt-3 max-h-64 overflow-auto rounded border border-border bg-canvas p-3 font-mono text-xs whitespace-pre-wrap text-ink-muted"
            tabIndex={0}
            aria-label="Catalog publisher output"
          >
            {stream.log}
          </pre>
          {(() => {
            const line = verdictLine(stream.verdict);
            return line ? (
              <p className={cx('mt-1 text-xs font-medium', line.tone)}>{line.text}</p>
            ) : null;
          })()}
          {done ? (
            <Button className="mt-2" onClick={() => void onDone()}>
              Close and show the table
            </Button>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

// --- Delete ---------------------------------------------------------------

/**
 * A delete that names what it is about to remove.
 *
 * `POST /api/catalog/delete` requires `confirm: true` and the server refuses
 * without it, because catalog-merge.mjs guarantees a publish can never make a
 * live game vanish - which means removal has to be a separate, deliberate verb
 * rather than a side effect of editing the local file. A bare window.confirm
 * with no name in it would be the one place in this tool where a destructive act
 * could be taken against the wrong row.
 */
function DeleteConfirmation({
  game,
  busy,
  onCancel,
  onConfirm,
}: {
  game: CatalogGame;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Marked up as an alertdialog rather than a plain card: it is a destructive
  // confirmation that has to be announced and entered deliberately, so it carries
  // a name, a description, and takes focus onto the SAFE choice (keep it). The
  // focus lands via the action row because the shared Button is not ref-forwarding.
  const actionsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    actionsRef.current?.querySelector<HTMLButtonElement>('button:last-child')?.focus();
  }, []);

  return (
    <Card
      role="alertdialog"
      aria-labelledby="catalog-delete-title"
      aria-describedby="catalog-delete-body"
      className="border border-status-error/50 bg-status-error/5"
    >
      <div className="flex items-start gap-3">
        <Trash2 aria-hidden size={18} className="mt-0.5 shrink-0 text-status-error" />
        <div className="flex-1">
          <h3 id="catalog-delete-title" className="text-sm font-semibold text-ink">
            Delete {label(game)} from the live catalog?
          </h3>
          <p id="catalog-delete-body" className="mt-1 max-w-prose text-xs text-ink-muted">
            The entry <code className="font-mono text-ink">{game.id}</code> will be removed from the
            catalog the launcher reads. Players will stop seeing this game in their library, and any
            build already downloaded stays on their machine. This is the only action in this panel
            that can make a published game disappear - publishing never does.
          </p>
          <div ref={actionsRef} className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" onClick={onConfirm} busy={busy} disabled={busy}>
              Yes, delete {label(game)}
            </Button>
            <Button onClick={onCancel} disabled={busy}>
              Keep it
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
