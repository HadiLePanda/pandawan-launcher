/**
 * The game list, as the Games page's own left column.
 *
 * It is a LIST, not a second navigation system: switching section is the rail's
 * job and picking a game is this list's, so there is exactly one place to do
 * each. Nothing is conditional - with no game selected the list still shows and
 * the detail beside it shows its empty state.
 *
 * The list takes a fixed width and scrolls on its own inside the page; the page
 * itself never scrolls as one document, so a long artwork list cannot drag the
 * games out of reach.
 */

import { Plus, Search, TriangleAlert } from 'lucide-react';

import { channelToneClasses } from '@/panels/channel-tone';
import { ago, STATUS_TEXT } from '@lib/format';
import type { GameScope } from '@lib/games';
import { useSession, useVisibleScopes } from '@store/session';
import { ErrorLine } from '@components/ui';

/**
 * The dot's colour per state. Never used without STATUS_TEXT beside it: colour
 * is never the only signal.
 */
const DOT_CLASS: Record<GameScope['status'], string> = {
  synced: 'bg-accent',
  drifted: 'bg-warn',
  empty: 'bg-ink-faint',
};

/** One game: id, channel, newest version and build, age, and status with its word. */
function GameRow({
  scope,
  active,
  onSelect,
}: {
  scope: GameScope;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={[
          'w-full rounded-sm border px-2 py-1.5 text-left transition-colors',
          active ? 'border-edge-strong bg-surface-3' : 'border-transparent hover:bg-surface-2',
        ].join(' ')}
      >
        {/* The id gives way first: it is the only field here that may truncate,
            because a clipped id is still recognisable while a clipped version is
            not. Everything after it is shrink-0, so the version cannot be lost
            to a long name. */}
        <span className="flex items-baseline gap-1.5">
          <span
            className={`truncate text-[13px] ${active ? 'font-semibold text-ink' : 'font-medium text-ink-muted'}`}
          >
            {scope.gameId}
          </span>
          <span
            className={`shrink-0 self-center rounded border px-1 text-[10px] leading-[1.6] ${channelToneClasses(scope.channel)}`}
          >
            {scope.channel}
          </span>
          {active && <span className="ml-auto h-3 w-[2px] shrink-0 bg-accent" aria-hidden="true" />}
        </span>

        <span className="mt-0.5 flex items-baseline gap-1.5">
          <span className="shrink-0 whitespace-nowrap font-mono text-[11.5px] text-ink-faint tabular-nums">
            {scope.version ?? '—'}
            {scope.build !== null && <span className="text-ink-faint"> #{scope.build}</span>}
          </span>
          <span className="ml-auto shrink-0 text-[11px] text-ink-subtle tabular-nums">
            {ago(scope.updated)}
          </span>
        </span>

        <span className="mt-1 flex items-center gap-1.5">
          <span
            className={`size-1.5 shrink-0 rounded-full ${DOT_CLASS[scope.status]}`}
            aria-hidden="true"
          />
          <span
            className={[
              'flex items-center gap-1 text-[11px]',
              scope.status === 'drifted' ? 'text-warn' : 'text-ink-subtle',
            ].join(' ')}
          >
            {scope.status === 'drifted' && (
              <TriangleAlert className="size-3 shrink-0" aria-hidden="true" />
            )}
            {STATUS_TEXT[scope.status]}
          </span>
        </span>
      </button>
    </li>
  );
}

export function GameListPane({
  scopes,
  loading,
  error,
}: {
  /** Every (game, channel) the inventory knows. */
  scopes: GameScope[];
  /** True while the inventory is in flight and has not arrived yet. */
  loading: boolean;
  /**
   * The inventory read's error, when it failed. An empty list and a failed read
   * are not the same answer, so the list must not report the second as the first.
   */
  error?: string | null;
}) {
  const selectedKey = useSession((state) => state.selectedKey);
  const query = useSession((state) => state.query);
  const setQuery = useSession((state) => state.setQuery);
  const select = useSession((state) => state.select);
  const setCreating = useSession((state) => state.setCreating);

  const visible = useVisibleScopes(scopes);

  return (
    // A list, so a list and not a tablist: `nav` here would announce a second
    // navigation landmark on the page, and a `group` with no parent disclosure
    // would announce a collapsed-and-expanded state that no longer exists. The
    // heading keeps it a region a screen reader can jump to.
    <section
      aria-label="Game list"
      className="flex h-full min-h-0 w-[272px] shrink-0 flex-col border-r border-edge bg-side"
    >
      <div className="shrink-0 px-2 pt-2 pb-1.5">
        <button type="button" onClick={() => setCreating(true)} className="dw-button w-full">
          <Plus className="size-3.5" aria-hidden="true" />
          New game
        </button>

        <div className="relative mt-1.5">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-faint"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter games"
            aria-label="Filter games by id or channel"
            className="dw-input pl-8"
          />
        </div>
      </div>

      {/* The one scrolling region in this column: the header above stays pinned
          so the filter is always reachable. */}
      <div className="dw-scroll min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2">
        {/* The guide line and the indent make this read as the games under Games
            rather than as a second navigation of its own. */}
        <ul className="ml-1 flex flex-col gap-0.5 border-l border-edge pl-2">
          {loading && !scopes.length ? (
            <li>
              <p className="px-2 py-1 text-[12px] text-ink-subtle">Loading games&hellip;</p>
            </li>
          ) : error && !scopes.length ? (
            // A failed read is NOT an empty bucket. Without this the empty state
            // below answers a broken request with "No games", which is a wrong
            // answer rather than a missing one.
            <li className="px-2 py-1">
              <ErrorLine>Could not read the games: {error}</ErrorLine>
            </li>
          ) : visible.length ? (
            visible.map((scope) => (
              <GameRow
                key={scope.key}
                scope={scope}
                active={scope.key === selectedKey}
                onSelect={() => select(scope.gameId, scope.channel)}
              />
            ))
          ) : (
            <li>
              <p className="px-2 py-1 text-[12px] text-ink-subtle">
                {scopes.length
                  ? `No game matches "${query.trim()}".`
                  : 'No games on the bucket yet.'}
              </p>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
