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
  ArrowLeft,
  CheckCircle2,
  FileWarning,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiGet, messageOf } from '@/lib/api';
import {
  CATALOG_FIELDS,
  CHANNELS,
  PLATFORMS,
  type CatalogDiff,
  type CatalogField,
  type CatalogGame,
  type CatalogResponse,
  gameToFields,
  labelForField,
  splitList,
  validateGame,
} from './catalog-contract';
import { FieldControl, type FieldControlProps } from './FieldControl';
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
import type { CatalogPlan } from '@/types/api';
import { useArtworkObjects } from '@components/tabs/ArtworkTab';
import { platformTone } from '@lib/platform-hue';
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
  const [editing, setEditing] = useState<CatalogGame | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CatalogGame | null>(null);
  const [publishDryRun, setPublishDryRun] = useState(true);
  const publish = usePublisherStream();

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

  const liveProblem = load.state === 'ready' ? load.data.liveError : undefined;
  const localProblem = load.state === 'ready' ? load.data.localError : undefined;
  const diff: CatalogDiff =
    load.state === 'ready' ? load.data.diff : { onlyLive: [], onlyLocal: [], changed: [] };

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
            onClick={() => setEditing('new')}
            disabled={publish.busy}
            aria-label="Add a catalog entry"
          >
            <Plus aria-hidden size={14} />
            Add entry
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

      {editing ? (
        <CatalogEditor
          game={editing === 'new' ? null : editing}
          existingIds={liveGames.map((game) => game.id)}
          onCancel={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
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
            onEdit={(game) => setEditing(game)}
            onDelete={(game) => setConfirmDelete(game)}
          />

          <DiffReport
            diff={diff}
            liveCount={liveGames.length}
            localCount={load.data.local?.games?.length ?? 0}
          />

          {editing ? null : (
            <PublishCard
              diff={diff}
              plan={load.data.plan}
              busy={publish.busy}
              dryRun={publishDryRun}
              onDryRunChange={setPublishDryRun}
              onPublish={() => void handlePublish()}
            />
          )}
        </>
      ) : null}

      {publish.log && publish.verdict.state !== 'idle' && !editing ? (
        <PublishLog log={publish.log} verdict={publish.verdict} />
      ) : null}
    </GlobalPanel>
  );
}

// --- The table ------------------------------------------------------------

function CatalogTable({
  games,
  busy,
  onEdit,
  onDelete,
}: {
  games: CatalogGame[];
  busy: boolean;
  onEdit: (game: CatalogGame) => void;
  onDelete: (game: CatalogGame) => void;
}) {
  if (!games.length) {
    return (
      <EmptyState
        title="The live catalog has no games"
        children="Nothing is published for the launcher to list yet. Add an entry, or publish the local catalog.json."
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
                {/* Icon-only. The word beside the icon would repeat once per game,
                    which is attention load worth cutting. What is NOT cut is the
                    name: the aria-label below is the accessible name, `title` is
                    the hover tooltip, and the trash icon plus the danger tint keep
                    the destructive one legible - colour never alone. */}
                <div className="flex items-center justify-end gap-1">
                  <Button
                    size="sm"
                    iconOnly
                    onClick={() => onEdit(game)}
                    disabled={busy}
                    title={`Edit ${label(game)}`}
                    aria-label={`Edit ${label(game)} in the catalog`}
                  >
                    <Pencil aria-hidden size={13} />
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
}: {
  diff: CatalogDiff;
  liveCount: number;
  localCount: number;
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
}: {
  title: string;
  tone: 'good' | 'warn' | 'info';
  help: string;
  ids?: string[];
  changed?: CatalogDiff['changed'];
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
                    <Badge tone="warn">{labelForField(field)}</Badge>
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
function PublishPlanSummary({ plan }: { plan: CatalogPlan }) {
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
                      <Badge tone="warn">{labelForField(field.field)}</Badge>
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
}: {
  diff: CatalogDiff;
  plan?: CatalogPlan;
  busy: boolean;
  dryRun: boolean;
  onDryRunChange: (value: boolean) => void;
  onPublish: () => void;
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
            <PublishPlanSummary plan={plan} />
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

// --- Create / edit --------------------------------------------------------

/**
 * The chips offered for a list field. Only platforms and channels have a closed
 * vocabulary in the contract, so genres and screenshots - free text - get none.
 */
function suggestionsFor(field: CatalogField): string[] | undefined {
  if (field.flag === 'supported-platforms') return [...PLATFORMS];
  if (field.flag === 'available-channels') return [...CHANNELS];
  return undefined;
}

/** The catalog entry's URL for one field, or '' when the entry has none. */
function catalogUrl(game: CatalogGame | null, catalogKey: string): string {
  const raw = (game as Record<string, unknown> | null)?.[catalogKey];
  return typeof raw === 'string' ? raw : '';
}

/**
 * An image field's control, which needs the bucket listing the plain
 * FieldControl cannot fetch for itself.
 *
 * The listing is marked against this field's CURRENT value rather than the
 * published one, so a pick the operator just made is highlighted - see
 * useArtworkObjects. On a new entry the game does not exist yet, so the listing
 * comes back empty and the paste-a-URL escape is what remains.
 */
function CatalogImageField({
  field,
  id,
  value,
  previewUrl,
  changed,
  onChange,
  gameId,
  channel,
}: FieldControlProps & { gameId: string; channel: string }) {
  const { objects } = useArtworkObjects({ gameId, channel, field: field.flag, value });
  return (
    <FieldControl
      field={field}
      id={id}
      value={value}
      previewUrl={previewUrl}
      artworks={objects}
      changed={changed}
      onChange={onChange}
    />
  );
}

/**
 * The create and edit form, on the same field contract the metadata tab uses.
 *
 * The field list comes from CATALOG_FIELDS, which mirrors FIELDS in
 * metadata-fields.mjs. Only the changed fields are sent, for the same reason the
 * news and metadata panels send only what changed: the publisher reads an absent
 * key as "leave whatever is published", so sending the whole form would blank
 * every field nobody touched. A create sends everything, because nothing is
 * published yet.
 */
function CatalogEditor({
  game,
  existingIds,
  onCancel,
  onDone,
}: {
  game: CatalogGame | null;
  existingIds: string[];
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const isNew = game === null;
  const [id, setId] = useState(game?.id ?? '');
  const [channel, setChannel] = useState(game?.channel ?? 'stable');
  const [values, setValues] = useState<Record<string, string>>(() => gameToFields(game));
  const [original] = useState<Record<string, string>>(() => gameToFields(game));
  const [problem, setProblem] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const stream = usePublisherStream();
  const [done, setDone] = useState(false);
  const firstField = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  const constraint = validateGame(id, channel, values);
  const takenElsewhere = !isNew && existingIds.includes(id.trim()) && id.trim() !== game?.id;
  const blocking =
    constraint ?? (takenElsewhere ? `The id "${id.trim()}" is already in the catalog.` : null);

  const changed = CATALOG_FIELDS.filter(
    (field) => (values[field.flag] ?? '').trim() !== (original[field.flag] ?? '').trim()
  ).map((field) => field.flag);

  async function submit() {
    setProblem(null);
    const reason = blocking;
    if (reason) {
      setProblem(reason);
      return;
    }

    if (isNew) {
      // A create publishes an entry for a game with no build yet. There is no
      // dry run on this verb: it writes the local catalog.json and then runs the
      // same additive merge the Publish button does, which adds what the CDN lacks
      // and touches nothing else. The button says so.
      const code = await stream.start('/api/catalog/create', {
        id: id.trim(),
        channel: channel.trim(),
        ...values,
      });
      setDone(code === 0);
      return;
    }

    // An edit is /api/meta/publish, the verb that writes catalog entry fields in
    // place rather than re-uploading the document - the same one the Metadata tab
    // uses, and the same FIELDS contract this form is built from. Only changed
    // fields are sent: the server treats an absent key as "leave whatever is
    // published", so sending the whole form would blank every field untouched.
    const payload: Record<string, unknown> = {
      gameId: id.trim(),
      channel: channel.trim(),
      dryRun,
    };
    for (const field of CATALOG_FIELDS) {
      if (!changed.includes(field.flag)) continue;
      const text = (values[field.flag] ?? '').trim();
      // An emptied text field is a real intent - it clears the value. An emptied
      // list field is not, because a comma list cannot express "none" and writing
      // [] would silently erase the field. Mirrors dashboard.mjs exactly.
      if (text === '' && field.list) continue;
      payload[field.flag] = text;
    }

    const code = await stream.start('/api/meta/publish', payload);
    // A dry run is a preview: the edit is not live, so nothing has been consumed
    // and the draft must survive for the real publish.
    setDone(code === 0 && !dryRun);
  }

  return (
    // Card supplies the fill, not a border, so a caller that wants a border has to
    // ask for both the width and the colour. This one earns it: the editor is
    // the panel currently demanding the operator's attention, and that is worth
    // an edge the eye can find without reading.
    <Card className="border border-action/40">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {isNew ? 'Add a catalog entry' : `Edit ${label(game ?? { id: '' })}`}
        </h3>
        <Button size="sm" variant="quiet" onClick={onCancel} aria-label="Close the catalog editor">
          <ArrowLeft aria-hidden size={14} />
          Close
        </Button>
      </div>

      {isNew ? null : (
        <p className="mb-3 text-xs text-ink-muted">
          The id is the join key every manifest URL is built from, so it cannot be renamed in place.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Id"
          required
          htmlFor="catalog-id"
          error={takenElsewhere ? (blocking ?? null) : null}
          hint={
            isNew
              ? 'The key every manifest URL is built from. Letters, digits, dots, dashes, underscores.'
              : 'Fixed: renaming in place orphans the manifest paths and the artwork object names.'
          }
        >
          <TextInput
            id="catalog-id"
            ref={firstField}
            value={id}
            readOnly={!isNew}
            onChange={(event) => setId(event.target.value)}
            placeholder="pandawan-rising"
            className="font-mono"
          />
        </Field>

        <Field
          label="Channel"
          required
          htmlFor="catalog-channel"
          hint="Required. The launcher builds its manifest URL from it."
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

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {CATALOG_FIELDS.map((field) => {
          const inputId = `catalog-${field.flag}`;
          const value = values[field.flag] ?? '';
          const isChanged = changed.includes(field.flag);
          const onChange = (next: string) => setValues({ ...values, [field.flag]: next });
          return field.image ? (
            <CatalogImageField
              key={field.flag}
              field={field}
              id={inputId}
              value={value}
              // The catalog holds the resolved URL this field renders; fall back
              // to the raw value (which may already be that URL, or a bare key).
              previewUrl={catalogUrl(game, field.catalog) || value}
              changed={isChanged}
              onChange={onChange}
              gameId={id.trim()}
              channel={channel.trim()}
            />
          ) : (
            <FieldControl
              key={field.flag}
              field={field}
              id={inputId}
              value={value}
              onChange={onChange}
              suggestions={suggestionsFor(field)}
              changed={isChanged}
            />
          );
        })}
      </div>

      {constraint ? <p className="mt-3 text-xs text-ember">{constraint}</p> : null}

      {problem ? <ErrorNote>{problem}</ErrorNote> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => void submit()}
          busy={stream.busy}
          disabled={stream.busy}
        >
          {isNew ? 'Create entry' : dryRun ? 'Preview save' : 'Save entry'}
        </Button>
        <Button onClick={onCancel} disabled={stream.busy}>
          Cancel
        </Button>
        {!isNew ? (
          <>
            <label className="inline-flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(event) => setDryRun(event.target.checked)}
                className="h-4 w-4 accent-[var(--color-action)]"
              />
              Preview only (dry run)
            </label>
            <span className="text-xs text-ink-dim">
              {changed.length
                ? `${changed.length} field${changed.length === 1 ? '' : 's'} will be sent. Untouched fields are left exactly as the CDN has them.`
                : 'Nothing changed. Saving sends no fields, so the CDN entry stays byte-identical.'}
            </span>
          </>
        ) : (
          <span className="text-xs text-ink-dim">
            Creates the entry in the local catalog.json and publishes the merge. Existing entries
            are never touched.
          </span>
        )}
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
