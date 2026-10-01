import type { Game } from '@/types';

export type GameContextAction =
  'play' | 'install' | 'verify' | 'patchNotes' | 'gameNews' | 'gameInfo' | 'uninstall';

export interface GameContextMenuItem {
  id: GameContextAction;
  danger?: boolean;
}

/**
 * Items in the game's overflow menu.
 *
 * Deliberately excludes play and install: both are the primary button one click
 * away, and repeating them in a menu made the two look like separate choices
 * when they are the same action. Game news is excluded for the same reason - it
 * is already in the game's own sidebar, and a menu entry for it was a dead end
 * that scrolled to something the user could see.
 */
export function deriveMenuItems(game: Game): GameContextMenuItem[] {
  const isInstalled = game.status === 'installed';
  const isDownloading = game.status === 'downloading' || game.status === 'updating';

  // Mid-transfer there is nothing to act on but the details panel.
  if (isDownloading) {
    return [{ id: 'gameInfo' }];
  }

  const items: GameContextMenuItem[] = [];

  if (isInstalled) {
    items.push({ id: 'verify' });
  }

  items.push({ id: 'patchNotes' }, { id: 'gameInfo' });

  if (isInstalled) {
    items.push({ id: 'uninstall', danger: true });
  }

  return items;
}
