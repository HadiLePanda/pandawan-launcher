/**
 * What a game tab receives.
 *
 * Kept in its own module rather than in the registry because the registry
 * imports every tab, and a tab importing the registry to get its own prop type
 * would close a cycle. Types are erased at build time so this costs nothing.
 *
 * A game tab's props name a game and a section's take nothing at all, so the
 * split is enforced by the compiler rather than by a runtime flag.
 */

import type { GameScope } from '@lib/games';

/** Props every game-scoped tab receives. */
export interface GameTabProps {
  gameId: string;
  channel: string;
  /**
   * The full derived scope: newest version, newest build, per-platform releases,
   * and the drift status. Tabs prefill from this rather than asking for an id.
   */
  scope: GameScope;
  /** Re-read the inventory after a publish, so the rail and header agree. */
  onPublished: () => void;
}
