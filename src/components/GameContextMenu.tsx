import { useEffect, useRef, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { deriveMenuItems, type GameContextAction } from '@/lib/game-context';
import type { Game } from '@/types';
import { Play, Download, ShieldCheck, FileText, Newspaper, Info, Trash2 } from 'lucide-react';

const iconByAction: Record<GameContextAction, React.ComponentType<{ className?: string }>> = {
  play: Play,
  install: Download,
  verify: ShieldCheck,
  patchNotes: FileText,
  gameNews: Newspaper,
  gameInfo: Info,
  uninstall: Trash2,
};

function actionLabel(t: (key: string) => string, action: GameContextAction): string {
  switch (action) {
    case 'play':
      return t('contextMenu.play');
    case 'install':
      return t('contextMenu.install');
    case 'verify':
      return t('contextMenu.verifyFiles');
    case 'patchNotes':
      return t('contextMenu.patchNotes');
    case 'gameNews':
      return t('contextMenu.gameNews');
    case 'gameInfo':
      return t('contextMenu.gameInfo');
    case 'uninstall':
      return t('contextMenu.uninstall');
  }
}

export interface MenuAnchor {
  x: number;
  y: number;
}

interface GameContextMenuProps {
  game: Game;
  anchor: MenuAnchor | null;
  onClose: () => void;
  onAction: (action: GameContextAction) => void;
  /**
   * The control that opens this menu, when there is one. A mousedown on it is
   * not a click-away: without this the trigger's own click reopens the menu it
   * just closed, so it could never be dismissed by pressing the button again.
   * Same fix the channel picker applies to its trigger.
   */
  triggerRef?: RefObject<HTMLElement | null>;
}

export function GameContextMenu({
  game,
  anchor,
  onClose,
  onAction,
  triggerRef,
}: GameContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const items = deriveMenuItems(game);

  useEffect(() => {
    if (!anchor) return;

    const isInside = (target: EventTarget | null) =>
      Boolean(menuRef.current?.contains(target as Node)) ||
      Boolean(triggerRef?.current?.contains(target as Node));

    const handleClick = (e: MouseEvent) => {
      if (!isInside(e.target)) {
        onClose();
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [anchor, onClose, triggerRef]);

  if (!anchor) return null;

  let left = anchor.x;
  let top = anchor.y;

  // Clamp to the viewport so the menu never opens off-screen. Both placements
  // position the menu by its own left edge, so it always reads as belonging to
  // the thing that opened it.
  const menuWidth = 180;
  const menuHeight = items.length * 32 + 8;

  if (typeof window !== 'undefined') {
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    if (top + menuHeight > window.innerHeight - 8) {
      top = window.innerHeight - menuHeight - 8;
    }
    if (left < 8) left = 8;
    if (top < 8) top = 8;
  }

  return (
    <div
      ref={menuRef}
      className="game-context-menu"
      style={{ position: 'fixed', top, left, zIndex: 100 }}
      role="menu"
    >
      {items.map((item) => {
        const Icon = iconByAction[item.id];
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={cn('game-context-menu-item', item.danger && 'game-context-menu-item-danger')}
            onClick={() => {
              onAction(item.id);
              onClose();
            }}
          >
            <Icon className="w-4 h-4" />
            <span>{actionLabel(t, item.id)}</span>
          </button>
        );
      })}
    </div>
  );
}
