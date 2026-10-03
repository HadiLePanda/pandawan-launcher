/**
 * The News editor.
 *
 * Load-bearing behaviours, and why:
 *
 *   - Master-detail. The id is never typed; items are picked from the list. A
 *     client-chosen id can collide with a published item and merge two
 *     announcements, so ids for a create are derived server-side by
 *     `uniqueNewsId` against the ids actually published.
 *
 *   - The field contract travels in the response. `GET /api/news` returns
 *     `{ items, categories, fields }`; `fields` is an array of
 *     `{ flag, label, long? }` taken from scripts/lib/news-fields.mjs. The form
 *     renders from that array, so a field renamed server-side cannot leave a
 *     stale hand-typed input behind.
 *
 *   - Only changed fields are sent on an update. The publisher reads an absent
 *     field as "leave it alone", so sending the whole form would blank every
 *     optional field nobody touched. A create sends everything.
 *
 *   - The array order IS display order, so reordering is a property of the ITEM,
 *     not of the form: the up/down arrows sit on the list row and are disabled at
 *     the ends rather than no-opping.
 *
 *   - Category is a select over the categories the response supplies, with an
 *     explicit escape for an invented one: news-service.ts validates an item on
 *     `id` and `title` alone, so rejecting a category the operator made up would
 *     be the dashboard enforcing a rule the launcher does not have.
 *
 *   - Dry run is the default and is never auto-unticked. It lives on the PANEL,
 *     because a reorder from the list has to pass the same gate as a publish from
 *     a form.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ImagePlus,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
} from 'lucide-react';
import { apiGet, apiPost, messageOf } from '@/lib/api';
import { clearDraft, DRAFT_KEYS, readDraft, saveDraft, type DraftEnvelope } from '@lib/storage';
import { parseScopeKey } from '@lib/games';
import { savedPhrase } from '@lib/format';
import { fileToBase64 } from '@lib/artwork';
import { useSession } from '@store/session';
import type { StagedFile } from '@/types/api';
import { Thumb } from './Thumb';
import { cx } from './cx';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNote,
  GlobalPanel,
  Spinner,
  TextArea,
  TextInput,
} from './ui';
import { usePublisherStream, verdictLine, type StreamHandle } from './usePublisherStream';

// --- The response shape ---------------------------------------------------

/** A news field as the server sends it: `flag`, `label`, `long?`. */
export interface NewsField {
  flag: string;
  label: string;
  long?: boolean;
}

export interface NewsItem {
  id: string;
  label: string;
  fields: Record<string, string>;
  imageUrl?: string;
}

interface NewsResponse {
  items?: NewsItem[];
  categories?: string[];
  fields?: NewsField[];
}

const IMAGE_INPUT = 'imageFile';

// --- Panel ----------------------------------------------------------------

export default function NewsPanel() {
  const [load, setLoad] = useState<
    | { state: 'loading' }
    | { state: 'ready'; data: NewsResponse }
    | { state: 'error'; message: string }
  >({ state: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  /* Dry run is the default and is never auto-unticked. It lives on the panel, not
     in the form, because a reorder driven from a list row is the same write to the
     same feed and has to pass the same gate as a publish driven from a form. */
  const [dryRun, setDryRun] = useState(true);
  /* One stream for the panel: the arrows, the delete and the publish are the same
     publisher writing the same array, so a second one cannot be refused by a busy
     flag that only one of them can see. */
  const stream = usePublisherStream();
  /* The game selected in the rail, when there is one. News is a global feed - an
     item can be about any game or none - so this is only ever a DEFAULT for a new
     item, never a filter and never an override of what an item already carries. */
  const selectedScope = parseScopeKey(useSession((state) => state.selectedKey));

  const items = useMemo(() => (load.state === 'ready' ? (load.data.items ?? []) : []), [load]);
  const fields = useMemo(() => (load.state === 'ready' ? (load.data.fields ?? []) : []), [load]);
  const categories = useMemo(
    () => (load.state === 'ready' ? (load.data.categories ?? []) : []),
    [load]
  );

  const refresh = useCallback(async () => {
    setLoad({ state: 'loading' });
    try {
      const { data } = await apiGet<NewsResponse>('/api/news', { refresh: true });
      setLoad({ state: 'ready', data });
      // A selection that no longer exists must not be left selected: after a
      // delete it would render an empty form for an item the list no longer
      // offers, and publishing that would re-create it.
      setSelected((current) =>
        current && !(data.items ?? []).some((item) => item.id === current) ? null : current
      );
    } catch (err) {
      setLoad({ state: 'error', message: messageOf(err) });
    }
  }, []);

  // Started through a resolved promise rather than called directly, so the state
  // update lands in a callback after the effect body instead of synchronously
  // inside it. Same fetch, same error path - only the render it lands on differs.
  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const shown = items.filter((item) => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return true;
    return (
      item.label.toLowerCase().includes(needle) ||
      item.id.includes(needle) ||
      String(item.fields.category ?? '')
        .toLowerCase()
        .includes(needle)
    );
  });

  /**
   * One write to the feed, with the same confirm and reload the form uses.
   *
   * A dry run prints and changes nothing, so it keeps the form's draft; only a
   * real run consumes the draft, which happens here and not in the form - a
   * reorder cannot be made to know which item's draft it cleared.
   */
  const run = useCallback(
    async (payload: Record<string, unknown>, confirmText: string): Promise<boolean> => {
      if (!dryRun && confirmText && !window.confirm(confirmText)) return false;
      const code = await stream.start('/api/news/publish', { ...payload, dryRun });
      if (dryRun || code !== 0) return false;
      await refresh();
      return true;
    },
    [dryRun, refresh, stream]
  );

  return (
    <GlobalPanel
      title="News"
      subtitle="Not scoped to the game in the rail: an item can be about any game, or none."
      actions={
        <>
          <Button onClick={() => void refresh()} aria-label="Reload the news feed">
            <RefreshCw aria-hidden size={14} />
            Reload
          </Button>
          <Button onClick={() => setSelected('')}>
            <Plus aria-hidden size={14} />
            New item
          </Button>
        </>
      }
    >
      {/* One gate for every verb below, because they all write the same array. */}
      <DryRunToggle dryRun={dryRun} onChange={setDryRun} busy={stream.busy} />

      {load.state === 'loading' ? (
        <Card>
          <Spinner label="Reading the news feed from the CDN…" />
        </Card>
      ) : null}

      {load.state === 'error' ? (
        <ErrorNote>Could not read the news feed: {load.message}</ErrorNote>
      ) : null}

      {stream.log ? (
        <Card>
          <pre
            className="max-h-72 overflow-auto rounded border border-border bg-canvas p-3 font-mono text-xs whitespace-pre-wrap text-ink-muted"
            tabIndex={0}
            aria-label="News publisher output"
          >
            {stream.log}
          </pre>
          {(() => {
            const line = verdictLine(stream.verdict);
            return line ? (
              <p className={cx('mt-1 text-xs font-medium', line.tone)}>{line.text}</p>
            ) : null;
          })()}
        </Card>
      ) : null}

      {load.state === 'ready' ? (
        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <TextInput
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by title, id or category"
              aria-label="Filter news items"
            />
            <p className="text-xs text-ink-muted">
              {items.length
                ? `${items.length} item${items.length === 1 ? '' : 's'} published`
                : 'No news is published yet.'}
            </p>

            {!items.length ? (
              <EmptyState title="Nothing published yet" children="A new item starts here." />
            ) : !shown.length ? (
              <EmptyState title="No item matches that filter" />
            ) : (
              <ul className="flex flex-col gap-1">
                {shown.map((item) => {
                  // Position in the PUBLISHED array, not in the filtered view. An
                  // arrow has to move the item in the feed players read; the index
                  // it would land on is not the index it sits at on screen while a
                  // filter is on, and using the latter would move the wrong item.
                  const at = items.findIndex((one) => one.id === item.id);
                  return (
                    <li key={item.id}>
                      <div
                        className={cx(
                          'group flex items-stretch gap-1 rounded-md border transition-colors',
                          'focus-within:ring-2 focus-within:ring-action',
                          selected === item.id
                            ? 'border-action bg-action/10'
                            : 'border-border bg-surface hover:bg-surface-light'
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSelected(item.id)}
                          aria-current={selected === item.id}
                          className={cx(
                            'flex min-w-0 flex-1 items-center gap-2 rounded-l-md p-2 text-left',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action'
                          )}
                        >
                          <Thumb url={item.imageUrl} alt={`${item.label} artwork`} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-ink">
                              {item.label}
                            </span>
                            <span className="block truncate text-xs text-ink-dim">
                              {[item.fields.category, item.fields.date]
                                .filter(Boolean)
                                .join(' - ') || item.id}
                            </span>
                          </span>
                        </button>

                        {/* Reordering is a property of the item, not of whichever
                            form happens to be open, so it lives on the row. The
                            ends are DISABLED rather than a silent no-op: array order
                            is display order, so an off-the-end move reads as a
                            success that did nothing. Revealed on hover, and always
                            shown when something inside has focus, so a keyboard user
                            never meets an invisible control. */}
                        <div className="flex shrink-0 items-center">
                          <MoveArrow
                            direction="up"
                            label={item.label}
                            disabled={at <= 0 || stream.busy}
                            onClick={() => void run({ op: 'move', id: item.id, delta: -1 }, '')}
                          />
                          <MoveArrow
                            direction="down"
                            label={item.label}
                            disabled={at < 0 || at >= items.length - 1 || stream.busy}
                            onClick={() => void run({ op: 'move', id: item.id, delta: 1 }, '')}
                          />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <NewsForm
            key={selected ?? 'new'}
            item={items.find((one) => one.id === selected) ?? null}
            fields={fields}
            categories={categories}
            defaultGameId={selectedScope?.gameId ?? ''}
            stream={stream}
            onRun={run}
          />
        </div>
      ) : null}
    </GlobalPanel>
  );
}

/**
 * The preview gate, shown once for the panel.
 *
 * It is here rather than in the form because the arrows and the delete write the
 * same feed and must not be able to bypass the one that protects it. Ticking it
 * off says what it costs, because that is the one thing an operator cannot undo.
 */
function DryRunToggle({
  dryRun,
  onChange,
  busy,
}: {
  dryRun: boolean;
  onChange: (next: boolean) => void;
  busy: boolean;
}) {
  return (
    <div>
      <label className="inline-flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={dryRun}
          disabled={busy}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 accent-[var(--color-action)]"
        />
        Preview only (dry run) - recommended
      </label>
      {/* Only the unticked state needs a sentence: unticking is the one thing an
          operator cannot undo. Ticked, the label already says what it does. */}
      {dryRun ? null : (
        <p className="mt-1 text-xs text-ink-dim">
          Unticking preview writes to the live feed players read.
        </p>
      )}
    </div>
  );
}

/** One icon-only reorder control, named for the item it acts on. */
function MoveArrow({
  direction,
  label,
  disabled,
  onClick,
}: {
  direction: 'up' | 'down';
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`Move ${label} ${direction}`}
      title={disabled ? `${label} is already at the ${direction} of the feed` : undefined}
      className={cx(
        'flex h-full w-7 items-center justify-center rounded-r-md text-ink-subtle',
        'transition-colors hover:bg-surface-hover hover:text-ink',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action',
        'disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:bg-transparent',
        // Hidden from the pointer until the row is hovered, and never hidden from
        // a keyboard user: `opacity` alone would leave them visible-but-invisible,
        // and `visibility` would take them out of the tab order.
        'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
        'focus-visible:opacity-100'
      )}
    >
      {direction === 'up' ? (
        <ChevronUp aria-hidden size={14} />
      ) : (
        <ChevronDown aria-hidden size={14} />
      )}
    </button>
  );
}

// --- Form -----------------------------------------------------------------

function NewsForm({
  item,
  fields,
  categories,
  defaultGameId,
  stream,
  onRun,
}: {
  item: NewsItem | null;
  fields: NewsField[];
  categories: string[];
  /** The game selected in the rail, or ''. A DEFAULT for a new item only. */
  defaultGameId: string;
  stream: StreamHandle;
  onRun: (payload: Record<string, unknown>, confirmText: string) => Promise<boolean>;
}) {
  const isNew = item === null;
  const draftKey = DRAFT_KEYS.news(item?.id ?? null);

  // Restore a stored draft for exactly this item, read once during the first
  // render rather than set after the first paint: the restored values ARE the
  // initial values, so there is no second render undoing the first.
  //
  // This is only correct because there is one selection per MOUNT. `key` on the
  // parent is `selected`, so choosing a different item remounts this component and
  // the read happens again for the new item.
  const [draft, setDraft] = useState<DraftEnvelope | null>(() => {
    const stored = readDraft(draftKey);
    if (stored?.values && typeof stored.values === 'object') return stored;
    return null;
  });
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...(item?.fields ?? {}),
    ...(draft?.values ?? {}),
    // The game selected in the rail, when there is one, as the STARTING value for a
    // new item - not as something to type. A draft the operator already saved
    // wins over it, because they chose that deliberately; and an EXISTING item
    // never reaches this, since `item.fields['game-id']` is already in the spread
    // above. So an item that belongs to no game, or to a different game, keeps what
    // it has: this can only ever fill an empty field on a new item.
    ...(isNew && !draft && defaultGameId ? { 'game-id': defaultGameId } : {}),
  }));
  // The comparison baseline. Deliberately the PUBLISHED values even when a draft
  // is restored over them: the diff's "before" has to be what players see now, not
  // what the operator typed last time. So it is seeded from `item.fields` alone
  // and never from the draft above.
  const [original] = useState<Record<string, string>>(() => item?.fields ?? {});
  const [problem, setProblem] = useState<string | null>(null);
  const [imageStatus, setImageStatus] = useState('');

  // The catalog is where every game's banner lives, so an item can borrow art its
  // game already published rather than uploading a second copy of it.
  const [gameArt, setGameArt] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    apiGet<unknown>('/api/catalog')
      .then(({ data }) => {
        if (cancelled) return;
        const record = data as {
          games?: { id: string; bannerUrl?: string; iconUrl?: string }[];
          catalog?: { games?: { id: string; bannerUrl?: string; iconUrl?: string }[] };
        };
        const games = record?.games ?? record?.catalog?.games ?? [];
        const map: Record<string, string> = {};
        for (const game of games) {
          const art = game.bannerUrl?.trim() || game.iconUrl?.trim();
          if (art) map[game.id] = art;
        }
        setGameArt(map);
      })
      .catch(() => {
        // A convenience, not a requirement: without it the field is simply typed.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const titleRef = useRef<HTMLInputElement | null>(null);
  // A textarea cannot take the input's ref type, so the first long field has its
  // own ref purely so the focus call typechecks.
  const longRef = useRef<HTMLTextAreaElement | null>(null);

  // A new item focuses the title: there is nothing else to type into first. A DOM
  // effect, so it stays in an effect - focus is not something render can decide.
  useEffect(() => {
    if (isNew) titleRef.current?.focus();
  }, [isNew]);

  const isDirty = (flag: string): boolean => {
    if (!(flag in original)) return false;
    return (values[flag] ?? '').trim() !== String(original[flag] ?? '').trim();
  };

  /** A chosen file counts as a change on its own, because the upload rewrites the URL. */
  const imagePath = String(values[IMAGE_INPUT] ?? '').trim();
  // The art the item's own game published, or '' when it has none to borrow.
  const gameBanner = gameArt[String(values['game-id'] ?? '').trim()] ?? '';
  const changed = fields.filter((field) => isDirty(field.flag)).map((field) => field.flag);

  function persistDraft() {
    if (!fields.length) return;
    if (!changed.length && !imagePath) {
      clearDraft(draftKey);
      setDraft(null);
      return;
    }
    const envelope: DraftEnvelope = {
      savedAt: Date.now(),
      target: item?.label ?? 'a new item',
      itemId: item?.id ?? 'new',
      values,
    };
    saveDraft(draftKey, {
      target: envelope.target,
      itemId: envelope.itemId,
      values: envelope.values,
    });
    setDraft(envelope);
  }

  /**
   * The form's write, wrapped so it can clear its OWN draft.
   *
   * The panel owns `run` because a reorder from a list row has to go through the
   * same gate, and a list row cannot know which item's draft it just consumed. The
   * only extra work here is the draft clear, which is deliberately after a real
   * publish and never after a dry run: what is now published is what the form shows,
   * so a draft describing a pending edit would be restored on the next visit as a
   * phantom difference against the live feed.
   */
  async function run(payload: Record<string, unknown>, confirmText: string) {
    setProblem(null);
    const published = await onRun(payload, confirmText);
    if (!published) return;
    clearDraft(draftKey);
    setDraft(null);
  }

  async function publish() {
    const title = String(values.title ?? '').trim();
    if (!title) {
      setProblem('A news item needs a title. The launcher drops it without one.');
      return;
    }

    const payload: Record<string, unknown> = {
      op: isNew ? 'create' : 'update',
      // Empty for a create on purpose: the server derives the id from the title
      // against the ids actually published, which is the only place that knows
      // what is taken. An id is never edited afterwards either, because the
      // item's artwork object is named after it.
      id: isNew ? '' : (item?.id ?? ''),
    };

    for (const field of fields) {
      // An update sends only what changed. A create sends everything, because
      // nothing exists yet and an absent field would simply not be written.
      if (!isNew && !isDirty(field.flag) && field.flag !== 'image-url') continue;
      payload[field.flag] = String(values[field.flag] ?? '').trim();
    }
    // A chosen file supersedes the URL: the publisher uploads the file and
    // rewrites the URL itself, so sending the unchanged one would report a change
    // the operator never made.
    if (imagePath && (isNew || isDirty('image-url'))) payload.imageFile = imagePath;

    await run(
      payload,
      `${isNew ? 'Create' : 'Publish'} "${title}"? Players will see it immediately.`
    );
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {isNew ? 'New item' : `Editing ${item?.label}`}
        </h3>
        {isNew ? null : <code className="font-mono text-xs text-ink-dim">{item?.id}</code>}
      </div>

      {draft ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-ember/40 bg-ember/10 px-3 py-2 text-xs">
          <span className="text-ink">
            <strong className="font-semibold">Unpublished draft restored</strong> for {draft.target}
            , saved {savedPhrase(draft.savedAt)}. It is not live.
          </span>
          <Button
            size="sm"
            onClick={() => {
              clearDraft(draftKey);
              setDraft(null);
              setValues({ ...(item?.fields ?? {}) });
            }}
            aria-label="Discard the restored draft"
          >
            <Undo2 aria-hidden size={12} />
            Discard draft
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {fields.map((field) => {
          const inputId = `news-${field.flag}`;
          const value = values[field.flag] ?? '';
          const dirty = isDirty(field.flag);
          // `game-id` is derived, never typed - see the header note above. It is
          // still SENT: `values['game-id']` holds whatever the item already has,
          // or the derived default on a create, so the payload and the diff are
          // unchanged by the input going away.
          if (field.flag === 'game-id') return null;
          return (
            <div key={field.flag}>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={inputId} className="text-xs font-medium text-ink-muted">
                  {field.label}
                  {field.flag === 'title' ? <span className="text-status-error"> *</span> : null}
                </label>
                <div className="flex items-center gap-1.5">
                  {dirty ? <Badge tone="info">changed</Badge> : null}
                  {dirty ? (
                    <button
                      type="button"
                      onClick={() => {
                        setValues({ ...values, [field.flag]: String(original[field.flag] ?? '') });
                        persistDraft();
                      }}
                      className="text-xs text-ink-dim underline hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
                    >
                      Undo
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-1.5">
                {field.flag === 'category' ? (
                  <CategorySelect
                    id={inputId}
                    value={value}
                    categories={categories}
                    dirty={dirty}
                    onChange={(next) => {
                      setValues({ ...values, category: next });
                    }}
                    onBlur={persistDraft}
                  />
                ) : field.long ? (
                  <TextArea
                    id={inputId}
                    ref={longRef}
                    value={value}
                    onChange={(event) => {
                      setValues({ ...values, [field.flag]: event.target.value });
                    }}
                    onBlur={persistDraft}
                    className={dirty ? 'border-action' : undefined}
                  />
                ) : (
                  <TextInput
                    id={inputId}
                    ref={field.flag === 'title' ? titleRef : undefined}
                    value={value}
                    onChange={(event) => {
                      setValues({ ...values, [field.flag]: event.target.value });
                    }}
                    onBlur={persistDraft}
                    className={cx(
                      dirty && 'border-action',
                      field.flag === 'image-url' && 'font-mono text-xs'
                    )}
                  />
                )}
              </div>

              {field.flag === 'image-url' && gameBanner ? (
                // One click instead of re-uploading art the game already has. The
                // key is stored, never a copy, so the two cannot drift apart.
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setValues({ ...values, [field.flag]: gameBanner });
                    persistDraft();
                  }}
                >
                  Use the game banner
                </Button>
              ) : null}

              {field.flag === 'image-url' ? (
                <ImageControl
                  url={value.trim()}
                  path={imagePath}
                  status={imageStatus}
                  setStatus={setImageStatus}
                  onStaged={(localPath) => {
                    setValues({ ...values, [IMAGE_INPUT]: localPath });
                    setImageStatus('ready - the file uploads on publish');
                    persistDraft();
                  }}
                  onClearFile={() => {
                    const next = { ...values };
                    delete next[IMAGE_INPUT];
                    setValues(next);
                    setImageStatus('');
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {problem ? <ErrorNote>{problem}</ErrorNote> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          onClick={() => void publish()}
          busy={stream.busy}
          disabled={stream.busy}
        >
          {isNew ? 'Create item' : 'Publish changes'}
          <Save aria-hidden size={13} />
        </Button>

        {/* Delete is the only remaining verb here: order belongs to the item,
            not to the open form. */}
        <Button
          variant="danger"
          onClick={() =>
            void run(
              { op: 'delete', id: item?.id ?? '' },
              `Delete "${item?.label}" from the news feed? Players will stop seeing it.`
            )
          }
          disabled={isNew || stream.busy}
          aria-label={`Delete ${item?.label ?? 'item'}`}
        >
          <Trash2 aria-hidden size={13} />
          Delete
        </Button>
        <Button
          onClick={() => {
            clearDraft(draftKey);
            setDraft(null);
            setValues({ ...(item?.fields ?? {}) });
            stream.reset();
          }}
          disabled={stream.busy}
        >
          Revert all
        </Button>
      </div>

      {changed.length || imagePath ? (
        <p className="mt-2 text-xs text-ink-muted">
          {changed.length
            ? `${changed.length} field${changed.length === 1 ? '' : 's'} changed`
            : ''}
          {changed.length && imagePath ? ' - ' : ''}
          {imagePath ? '1 image ready to upload' : ''}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * Category as a real dropdown, with an explicit way to invent one.
 *
 * The list is what the server sends: NEWS_CATEGORY_SUGGESTIONS merged with every
 * category in use, so it is the whole set this feed already knows. That is a
 * suggestion list and not a closed set - news-service.ts validates an item on
 * `id` and `title` alone - so there is a real "Other…" choice that reveals a text
 * box. Without it, choosing a dropdown here would silently drop the ability to
 * publish a category the launcher happily accepts, which is a legitimate edit
 * being blocked by a control.
 *
 * A value already in use is offered as itself and never as "Other…", so picking
 * one and reopening the form reads back the same category either way. A value
 * that is NOT in the list - an older item, or a restored draft - keeps its own
 * box open rather than being rewritten to nothing behind the operator's back.
 *
 * The box is not a second source of truth: whatever it holds IS `values.category`,
 * so an update sends it through the same only-changed-fields path as any other
 * field and a create sends it like any other.
 */
function CategorySelect({
  id,
  value,
  categories,
  dirty,
  onChange,
  onBlur,
}: {
  id: string;
  value: string;
  categories: string[];
  dirty: boolean;
  onChange: (next: string) => void;
  onBlur: () => void;
}) {
  const trimmed = value.trim();
  const known = trimmed !== '' && categories.includes(trimmed);
  // Whether the escape was taken on. Seeded, not derived, because "Other…" chosen
  // on an item that already has a category is a state the value alone cannot
  // express - there is nothing in the box to infer it from.
  const [custom, setCustom] = useState(() => trimmed !== '' && !known);
  // `custom` is checked FIRST, deliberately. If the value decided on its own, an
  // item that already had a known category would snap the select straight back to
  // it and the free-text box would never appear, so choosing the escape on a field
  // that is already filled would look like a dead control.
  const escape = custom || (trimmed !== '' && !known);

  return (
    <div className="flex flex-col gap-1.5">
      <select
        id={id}
        value={escape ? OTHER : trimmed}
        onChange={(event) => {
          const next = event.target.value;
          // Choosing the escape does not write anything by itself: the box opens
          // beside it and the value follows what is typed, so abandoning the edit
          // leaves the category exactly as it was.
          if (next === OTHER) {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(next);
        }}
        onBlur={onBlur}
        className={cx(
          'w-full appearance-none rounded-md border border-border bg-canvas px-2.5 py-1.5 text-sm text-ink',
          'focus:border-action focus:outline-none focus:ring-1 focus:ring-action',
          dirty && 'border-action'
        )}
      >
        <option value="">No category</option>
        {categories.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
        <option value={OTHER}>Other&hellip;</option>
      </select>
      {escape ? (
        <TextInput
          id={`${id}-other`}
          value={trimmed}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder="A new category"
          className={cx('text-xs', dirty && 'border-action')}
        />
      ) : null}
    </div>
  );
}

/**
 * The sentinel that reveals the free-text box.
 *
 * A NUL-prefixed string so it cannot collide with a category a person typed. It
 * never reaches `values`: the change handler returns before writing it.
 */
const OTHER = `${String.fromCharCode(0)}other`;

// --- Artwork --------------------------------------------------------------

/**
 * Preview plus staged upload plus a typed path.
 *
 * A browser cannot hand over an absolute path, so the bytes travel over the same
 * loopback connection as everything else and `POST /api/art/stage` returns a real
 * path the publisher can upload. Both routes write into the same value the typed
 * box uses, deliberately: the dirty count, the diff and the publish payload then
 * behave identically whether the file was picked or typed.
 *
 * A chosen file supersedes the URL, because the upload rewrites it.
 */
function ImageControl({
  url,
  path,
  status,
  setStatus,
  onStaged,
  onClearFile,
}: {
  url: string;
  path: string;
  status: string;
  setStatus: (text: string) => void;
  onStaged: (localPath: string) => void;
  onClearFile: () => void;
}) {
  const localPreview = useRef<string | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  useEffect(
    () => () => {
      // Released on unmount: a blob URL handed to the picker would otherwise stay
      // alive for as long as the form is open.
      if (localPreview.current) URL.revokeObjectURL(localPreview.current);
    },
    []
  );

  async function onPick(file: File | undefined) {
    if (!file) return;
    setStatus('staging…');
    // A read failure surfaces as the same status line the server's own rejections
    // use, rather than leaving the field silently empty.
    const data = await fileToBase64(file);
    if (!data) {
      setStatus('that file could not be read');
      return;
    }
    try {
      // A validation failure is answered with a plain string on purpose: this is
      // operator error to read in the form, not a stack trace. apiPost raises that
      // text as the error message, which is exactly what the status line wants.
      const staged = await apiPost<StagedFile>('/api/art/stage', {
        fileName: file.name,
        sizeBytes: file.size,
        data,
      });
      if (localPreview.current) URL.revokeObjectURL(localPreview.current);
      localPreview.current = URL.createObjectURL(file);
      setLocalUrl(localPreview.current);
      onStaged(staged.localPath);
    } catch (err) {
      setStatus(messageOf(err));
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-md border border-border bg-canvas/40 p-2">
      <div className="flex items-start gap-3">
        <Thumb
          url={localUrl ?? url}
          alt="News artwork preview"
          shape="wide"
          className="h-16 w-28"
        />
        <div className="min-w-0 flex-1 text-xs text-ink-dim">
          {localUrl ? (
            <p className="mb-1 text-ink">
              Chosen file, not yet published. The upload rewrites the URL on publish.
            </p>
          ) : null}
          <label className="block">
            <span className="mb-1 block">Or a path to a file that is not on this machine</span>
            <TextInput
              value={path}
              onChange={(event) => {
                setStatus('');
                onStaged(event.target.value);
              }}
              placeholder="C:\\art\\news.png"
              className="font-mono text-xs"
            />
          </label>
          {path ? (
            <div className="mt-1 flex items-center gap-2">
              <span className="truncate font-mono text-ink-muted">{path}</span>
              <Button
                size="sm"
                variant="quiet"
                onClick={onClearFile}
                aria-label="Clear the chosen artwork file"
              >
                Clear
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface-light px-3 py-1.5 text-xs text-ink hover:bg-surface-hover focus-within:ring-2 focus-within:ring-action">
          <ImagePlus aria-hidden size={14} />
          Choose an image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            onChange={(event) => void onPick(event.target.files?.[0])}
          />
        </label>
        {status ? <span className="text-xs text-ink-dim">{status}</span> : null}
      </div>
    </div>
  );
}
