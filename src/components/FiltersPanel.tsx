import { Filter, FilterX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { GameInfo } from '@/types';
import {
  emptyFilters,
  isDefaultFilters,
  collectPlatforms,
  platformLabel,
  type GameFilters,
} from '@/lib/game-filters';

interface FiltersPanelProps {
  games: GameInfo[];
  filters: GameFilters;
  onFilterChange: (partial: Partial<GameFilters>) => void;
}

type FilterOption =
  | { kind: 'status'; value: 'all' | 'installed'; label: string }
  | { kind: 'platform'; value: string; label: string };

interface FilterSection {
  key: string;
  options: FilterOption[];
}

export function FiltersPanel({ games, filters, onFilterChange }: FiltersPanelProps) {
  const { t } = useTranslation();
  const canReset = !isDefaultFilters(filters);

  const sections: FilterSection[] = [
    {
      key: 'status',
      options: [
        { kind: 'status', value: 'all', label: t('filters.all') },
        { kind: 'status', value: 'installed', label: t('filters.installed') },
      ],
    },
    {
      key: 'platform',
      options: collectPlatforms(games).map((p) => ({
        kind: 'platform' as const,
        value: p,
        label: platformLabel(p),
      })),
    },
  ];

  const handleStatusClick = (value: 'all' | 'installed') => {
    onFilterChange({ status: value });
  };

  const handlePlatformClick = (value: string) => {
    onFilterChange({ platform: filters.platform === value ? null : value });
  };

  return (
    <aside className="filters-panel no-drag">
      <div className="filter-search-row">
        <input
          type="search"
          className="filter-search"
          placeholder={t('filters.searchPlaceholder')}
          value={filters.search}
          onChange={(e) => onFilterChange({ search: e.target.value })}
        />
        <button
          type="button"
          className={cn('filter-reset', canReset && 'active')}
          title={t('filters.reset')}
          aria-label={t('filters.reset')}
          onClick={() => onFilterChange(emptyFilters)}
          disabled={!canReset}
        >
          {canReset ? <FilterX className="w-3.5 h-3.5" /> : <Filter className="w-3.5 h-3.5" />}
        </button>
      </div>

      {sections.map((section, sectionIndex) => (
        <div key={section.key}>
          {sectionIndex > 0 && <div className="sidebar-separator" />}
          <div className="filter-options">
            {section.options.map((option) => {
              const selected =
                option.kind === 'status'
                  ? filters.status === option.value
                  : filters.platform === option.value;

              return (
                <button
                  key={`${section.key}-${option.value}`}
                  type="button"
                  className={cn('filter-option', selected && 'selected')}
                  // Selection here is a background colour and nothing else, so it is
                  // invisible without the state exposed. A pressed toggle is what the
                  // styling was already drawing.
                  aria-pressed={selected}
                  onClick={() =>
                    option.kind === 'status'
                      ? handleStatusClick(option.value)
                      : handlePlatformClick(option.value)
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </aside>
  );
}
