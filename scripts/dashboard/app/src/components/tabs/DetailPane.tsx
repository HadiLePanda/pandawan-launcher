/**
 * The Games page: header, game tab strip, and the selected game tab's content.
 *
 * This is the ONLY page with a rail, and it is the only page whose content is
 * about one selected game. Everything here - the strip, the header, the selection
 * gate - exists to make "one game selected, five tabs about it" true.
 *
 * The rail and this scroll independently and the page never does - it is a tool
 * someone stares at while working, so a long artwork list must not drag the game
 * list off screen, and the game list must not scroll away while a form is being
 * filled in above it.
 *
 * The "no game selected" state says what to do next rather than reporting an
 * absence.
 */

import { Plus } from 'lucide-react';

import type { GameScope } from '@lib/games';
import type { CacheState } from '@lib/api';
import { useSession, type GameTabId } from '@store/session';

import { CreateGameDialog } from '@components/CreateGameDialog';
import { GameHeader } from '@components/GameHeader';
import { EmptyState, ErrorLine } from '@components/ui';

import { GAME_TABS, tabFor } from './registry';
import { TabStrip } from './TabStrip';

/** Ids are prefixed so they can never collide with Launcher's strip. */
const ID_PREFIX = 'game';

export function DetailPane({
  scopes,
  scope,
  ageMs,
  cache,
  refreshing,
  error,
  onRefresh,
  onPublished,
}: {
  scopes: GameScope[];
  scope: GameScope | null;
  ageMs: number | null;
  cache: CacheState;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onPublished: () => void;
}) {
  const tab = useSession((state) => state.tab);
  const setTab = useSession((state) => state.setTab);
  const creating = useSession((state) => state.creating);
  const setCreating = useSession((state) => state.setCreating);
  const clearSelection = useSession((state) => state.clearSelection);

  // The persisted tab id is validated against the REGISTRY, not just against
  // GAME_TAB_IDS: a tab removed in a later version must fall back to the first one
  // rather than rendering a component that no longer exists.
  const definition = tabFor(tab) ?? tabFor('metadata');
  const activeId = (definition?.id ?? 'metadata') as GameTabId;

  // EVERY game tab needs a selection, so the strip is gated unconditionally.
  const showTabStrip = Boolean(scope);

  return (
    <main
      id="section-games"
      role="tabpanel"
      aria-label="Games"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <GameHeader
        scope={scope}
        ageMs={ageMs}
        cache={cache}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />

      <div className="dw-scroll flex-1 px-8 py-5">
        {error && (
          <div className="mb-4">
            <ErrorLine>{error}</ErrorLine>
          </div>
        )}

        {creating ? (
          <CreateGameDialog
            onClose={() => setCreating(false)}
            onCreated={() => {
              // Re-read so the header and list reflect whatever the publisher
              // wrote. The selection is already set either way.
              onRefresh();
              onPublished();
            }}
          />
        ) : showTabStrip && definition ? (
          <>
            <TabStrip
              tabs={GAME_TABS}
              active={activeId}
              onSelect={setTab}
              label="Selected game"
              idPrefix={ID_PREFIX}
            />

            {/* A plain div, NOT role="tabpanel": the <main> above is already the
                Games tabpanel and a tabpanel inside a tabpanel is invalid. */}
            <div
              id={`${ID_PREFIX}-panel-${activeId}`}
              aria-labelledby={`${ID_PREFIX}-tab-${activeId}`}
              className="mt-4"
            >
              <definition.component
                // Remounting on scope change is what resets a tab's form state
                // when the operator switches games.
                key={`${scope?.gameId ?? '-'} ${scope?.channel ?? '-'} ${activeId}`}
                gameId={scope?.gameId ?? ''}
                channel={scope?.channel ?? ''}
                scope={scope as never}
                onPublished={() => {
                  onPublished();
                  onRefresh();
                }}
              />
            </div>
          </>
        ) : (
          <EmptyState
            title={scopes.length ? 'Pick a game to work on.' : 'No games on the bucket yet.'}
            action={
              <button type="button" onClick={() => setCreating(true)} className="dw-button">
                <Plus className="size-3.5" aria-hidden="true" />
                New game
              </button>
            }
          />
        )}

        {!scope && !creating && scopes.length > 0 && (
          <p className="mt-4 text-[11.5px] text-ink-faint">
            <button
              type="button"
              onClick={clearSelection}
              className="border-none bg-none p-0 text-ink-faint underline underline-offset-2 hover:text-ink-subtle"
            >
              clear the selection
            </button>
          </p>
        )}
      </div>
    </main>
  );
}
