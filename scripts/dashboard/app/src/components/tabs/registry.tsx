/**
 * The GAME TAB registry. THIS IS THE LEVEL-2 EXTENSION POINT, for tabs that act
 * on the game selected in the rail.
 *
 * Every entry here is scoped to a selection BY CONSTRUCTION: a game tab receives
 * `{ gameId, channel, scope }` as props and the shell renders nothing when there
 * is no selection. No tab is ever asked to type an id - that is the failure mode
 * the whole layout exists to remove, and the types now enforce it, because
 * `GameTabProps` has no way to name an id the shell did not choose.
 *
 * ============================================================================
 * ADDING A TAB INSIDE GAMES (a builds-history view, a per-game stats view, ...)
 * ============================================================================
 *
 *  1. Write the component in components/tabs/. Take `GameTabProps` - gameId,
 *     channel, scope, onPublished. If your thing does not act on the selected
 *     game, it is NOT a tab: add a section instead.
 *  2. Add one entry to GAME_TABS below.
 *  3. Add the id to GAME_TAB_IDS in @store/session.
 *
 * That is the whole procedure. The strip, the roving tabindex, the arrow keys,
 * the persistence of the open tab, the "no game selected" gate and the header age
 * all come from the shell and need no change.
 */

import type { ComponentType } from 'react';

import type { GameTabId } from '@store/session';

import { NewsPanel } from '@/panels';

import { ArtworkTab } from './ArtworkTab';
import { BuildsTab } from './BuildsTab';
import { MetadataTab } from './MetadataTab';
import { PruneTab } from './PruneTab';
import type { GameTabProps } from './types';

export interface TabDefinition {
  id: GameTabId;
  label: string;
  /** Named on hover and read by assistive tech, so the strip explains itself. */
  hint: string;
  component: ComponentType<GameTabProps>;
}

/**
 * The order the tabs appear in. Metadata first: it is the editor people live in.
 * Prune is LAST because it is the only one that deletes builds.
 *
 * The order here is the order of GAME_TAB_IDS in @store/session, so a tab cannot
 * be reachable in one and unreachable in the other.
 */
export const GAME_TABS: readonly TabDefinition[] = [
  {
    id: 'metadata',
    label: 'Metadata',
    hint: 'Name, description and everything else the launcher shows for this game.',
    component: MetadataTab,
  },
  {
    id: 'artwork',
    label: 'Artwork',
    hint: 'The icon and banner players see, and every image already on the bucket.',
    component: ArtworkTab,
  },
  {
    id: 'builds',
    label: 'Builds',
    hint: 'Upload another build of this game and make it visible to the launcher.',
    component: BuildsTab,
  },
  {
    id: 'news',
    label: 'News',
    hint: 'The feed on the launcher home screen, edited item by item.',
    component: NewsWithinGame,
  },
  {
    id: 'prune',
    label: 'Prune',
    hint: 'Delete all but the newest builds. Pinned versions are never deleted.',
    component: PruneTab,
  },
];

/**
 * The news feed, reached from inside Games.
 *
 * The tab is scoped to the selection but the content is not: a news item can be
 * about any game or none, so the panel it renders must not be given a scope, or
 * the feed would silently filter itself to whichever game happens to be
 * selected.
 *
 * Wrapping rather than importing keeps the panel's contract intact - it still
 * takes no props and reads the server itself - which is why this function
 * declares no parameters at all. A component with fewer parameters still
 * satisfies `ComponentType<GameTabProps>`.
 */
function NewsWithinGame() {
  return <NewsPanel />;
}

export function tabFor(id: GameTabId): TabDefinition | undefined {
  return GAME_TABS.find((tab) => tab.id === id);
}
