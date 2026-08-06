import { useTranslation } from 'react-i18next';
import { Gamepad2, Plus } from 'lucide-react';
import { isGamePinned } from '@/lib/pins';
import type { GameInfo } from '@/types';

export interface GamesBarProps {
  games: GameInfo[];
  installedIds: Set<string>;
  unpinnedGameIds: string[];
  selectedGameId: string | null;
  onSelect: (gameId: string) => void;
  onContextMenu: (e: React.MouseEvent, gameId: string) => void;
  onOpenPins: () => void;
}

export function GamesBar({
  games,
  installedIds,
  unpinnedGameIds,
  selectedGameId,
  onSelect,
  onContextMenu,
  onOpenPins,
}: GamesBarProps) {
  const { t } = useTranslation();

  const visibleGames = games.filter((g) => isGamePinned(g.id, unpinnedGameIds));

  return (
    <div className="games-bar no-scrollbar" data-testid="games-bar">
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
      <button
        type="button"
        className="games-bar-add"
        aria-label={t('gamesBar.managePins')}
        title={t('gamesBar.managePins')}
        onClick={onOpenPins}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
