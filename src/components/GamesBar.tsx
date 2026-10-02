import { useTranslation } from 'react-i18next';
import { Gamepad2, LayoutGrid, Plus } from 'lucide-react';
import { isGamePinned } from '@/lib/pins';
import type { GameInfo } from '@/types';

export interface GamesBarProps {
  games: GameInfo[];
  installedIds: Set<string>;
  unpinnedGameIds: string[];
  selectedGameId: string | null;
  isOverviewSelected: boolean;
  onSelect: (gameId: string | null) => void;
  onContextMenu: (e: React.MouseEvent, gameId: string) => void;
  onOpenPins: () => void;
}

// How many pinned games the bar shows.
//
// This is a cap rather than a scroll: a horizontal scroller in a 62px strip is
// easy to miss, scrolls the whole page when the wheel is over it, and hides the
// fact that more are pinned. Overflow is signalled by a count on the manage-pins
// button instead, so the limit is discoverable without a scrollbar.
const MAX_VISIBLE = 7;

export function GamesBar({
  games,
  installedIds,
  unpinnedGameIds,
  selectedGameId,
  isOverviewSelected,
  onSelect,
  onContextMenu,
  onOpenPins,
}: GamesBarProps) {
  const { t } = useTranslation();

  const pinned = games.filter((g) => isGamePinned(g.id, unpinnedGameIds));
  const visibleGames = pinned.slice(0, MAX_VISIBLE);
  // Games that are pinned but past the limit. Counted rather than rendered: the
  // overflow has to be visible somewhere or the cap looks like data loss.
  const overflow = pinned.length - visibleGames.length;

  // The bar carries no `no-scrollbar` class: it no longer scrolls, so hiding a
  // scrollbar would only conceal the cap from anyone who goes looking for it.
  return (
    <div className="games-bar" data-testid="games-bar">
      <div className="games-bar-item">
        <button
          type="button"
          className={['games-bar-icon', 'installed', isOverviewSelected ? 'selected' : ''].join(
            ' '
          )}
          aria-label={t('gamesBar.allGames')}
          onClick={() => onSelect(null)}
        >
          <LayoutGrid size={20} />
        </button>
        <span className="games-bar-tip">{t('gamesBar.allGames')}</span>
      </div>
      {visibleGames.length > 0 && <div className="games-bar-divider" aria-hidden="true" />}
      {visibleGames.map((game) => (
        <div key={game.id} className="games-bar-item">
          <button
            type="button"
            className={[
              'games-bar-icon',
              installedIds.has(game.id) ? 'installed' : '',
              selectedGameId === game.id ? 'selected' : '',
            ].join(' ')}
            aria-label={game.name}
            onClick={() => onSelect(game.id)}
            onContextMenu={(e) => onContextMenu(e, game.id)}
          >
            {game.iconUrl ? (
              <img src={game.iconUrl} alt="" className="w-full h-full object-cover rounded-[6px]" />
            ) : (
              <Gamepad2 size={20} />
            )}
          </button>
          <span className="games-bar-tip">{game.name}</span>
        </div>
      ))}
      {/*
       * The overflow count rides on the manage-pins button because that is the
       * one control that can reach the hidden games. It is aria-hidden: the
       * button's own label already says what it does, and a bare number next to
       * it would be read aloud as part of the name.
       */}
      <button
        type="button"
        className="games-bar-add"
        aria-label={t('gamesBar.managePins')}
        title={t('gamesBar.managePins')}
        onClick={onOpenPins}
      >
        <Plus size={16} />
        {overflow > 0 && (
          <span className="games-bar-overflow" aria-hidden="true">
            +{overflow}
          </span>
        )}
      </button>
    </div>
  );
}
