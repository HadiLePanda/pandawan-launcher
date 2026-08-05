import type { Game } from '@/types';

export type GameContextAction =
  | 'play'
  | 'install'
  | 'verify'
  | 'patchNotes'
  | 'gameNews'
  | 'gameInfo'
  | 'uninstall';

export interface GameContextMenuItem {
  id: GameContextAction;
  danger?: boolean;
}

export function deriveMenuItems(game: Game): GameContextMenuItem[] {
  const isInstalled = game.status === 'installed';
  const isDownloading = game.status === 'downloading' || game.status === 'updating';

  const items: GameContextMenuItem[] = [];

  if (isDownloading) {
    items.push({ id: 'gameInfo' });
    return items;
  }

  if (isInstalled) {
    items.push({ id: 'play' });
    items.push({ id: 'verify' });
  } else {
    items.push({ id: 'install' });
  }

  items.push({ id: 'patchNotes' }, { id: 'gameNews' }, { id: 'gameInfo' });

  if (isInstalled) {
    items.push({ id: 'uninstall', danger: true });
  }

  return items;
}
