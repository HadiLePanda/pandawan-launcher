import { Gamepad2, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { GameInfo } from '@/types';
import {
  emptyFilters,
  isDefaultFilters,
  collectPlatforms,
  collectGenres,
  type GameFilters,
} from '@/lib/game-filters';

interface GameSidebarProps {
  games: GameInfo[];
  installedIds: Set<string>;
  selectedGameId: string | null;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, gameId: string) => void;
  filters: GameFilters;
  onFilterChange: (partial: Partial<GameFilters>) => void;
}

function FilterPanel({
  games,
  filters,
  onChange,
}: {
  games: GameInfo[];
  filters: GameFilters;
  onChange: (partial: Partial<GameFilters>) => void;
}) {
  const { t } = useTranslation();
  const platforms = collectPlatforms(games);
  const genres = collectGenres(games);
  const canReset = !isDefaultFilters(filters);

  const toggleGenre = (genre: string) => {
    const next = filters.genres.includes(genre)
      ? filters.genres.filter((g) => g !== genre)
      : [...filters.genres, genre];
    onChange({ genres: next });
  };

  return (
    <div className="filter-panel">
      <div className="filter-search-row">
        <input
          type="search"
          className="filter-search"
          placeholder={t('filters.searchPlaceholder')}
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
        />
        <button
          type="button"
          className={cn('filter-reset', canReset && 'active')}
          title={t('filters.reset')}
          aria-label={t('filters.reset')}
          onClick={() => onChange(emptyFilters)}
          disabled={!canReset}
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="sidebar-separator" />

      <div className="filter-category">
        <span className="filter-category-title">{t('filters.status')}</span>
        <div className="filter-pills">
          <button
            type="button"
            className={cn('filter-pill', filters.status === 'all' && 'selected')}
            onClick={() => onChange({ status: 'all' })}
          >
            {t('filters.all')}
          </button>
          <button
            type="button"
            className={cn('filter-pill', filters.status === 'installed' && 'selected')}
            onClick={() => onChange({ status: 'installed' })}
          >
            {t('filters.installed')}
          </button>
        </div>
      </div>

      <div className="sidebar-separator" />

      <div className="filter-category">
        <span className="filter-category-title">{t('filters.platforms')}</span>
        <div className="filter-pills">
          {platforms.map((platform) => (
            <button
              key={platform}
              type="button"
              className={cn('filter-pill', filters.platform === platform && 'selected')}
              onClick={() =>
                onChange({ platform: filters.platform === platform ? null : platform })
              }
            >
              {platform}
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-separator" />

      <div className="filter-category">
        <span className="filter-category-title">{t('filters.genres')}</span>
        <div className="filter-pills">
          {genres.map((genre) => (
            <button
              key={genre}
              type="button"
              className={cn('filter-pill', filters.genres.includes(genre) && 'selected')}
              onClick={() => toggleGenre(genre)}
            >
              {genre}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function GameSidebar({
  games,
  installedIds,
  selectedGameId,
  onSelect,
  onContextMenu,
  filters,
  onFilterChange,
}: GameSidebarProps) {
  const handleContextMenu = (e: React.MouseEvent, gameId: string) => {
    e.preventDefault();
    onContextMenu(e, gameId);
  };

  return (
    <aside className="game-sidebar no-drag">
      <div className="game-sidebar-list">
        {games.map((game) => {
          const isInstalled = installedIds.has(game.id);
          const isSelected = game.id === selectedGameId;
          const iconClass = cn(
            'game-sidebar-icon',
            isInstalled && 'installed',
            isSelected && 'selected'
          );

          return (
            <button
              key={game.id}
              type="button"
              className="p-0 bg-transparent border-0"
              title={game.name}
              aria-label={game.name}
              onClick={() => onSelect(game.id)}
              onContextMenu={(e) => handleContextMenu(e, game.id)}
            >
              {game.iconUrl ? (
                <img src={game.iconUrl} alt="" className={iconClass} />
              ) : (
                <div className={cn(iconClass, 'flex items-center justify-center bg-surface-light')}>
                  <Gamepad2 className="w-4 h-4 text-ink-muted" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="sidebar-separator" />
      <FilterPanel games={games} filters={filters} onChange={onFilterChange} />
    </aside>
  );
}
