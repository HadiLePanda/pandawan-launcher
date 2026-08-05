import { describe, it, expect } from 'vitest';
import {
  filterGames,
  emptyFilters,
  isDefaultFilters,
  collectPlatforms,
  collectGenres,
  type GameFilters,
  type GameInfoLike,
} from './game-filters';

const games: GameInfoLike[] = [
  {
    id: 'astro-odyssey',
    name: 'Astro Odyssey',
    genre: ['RPG', 'Adventure'],
    supportedPlatforms: ['windows', 'macos'],
  },
  {
    id: 'pixel-racer',
    name: 'Pixel Racer',
    genre: ['Racing'],
    supportedPlatforms: ['windows', 'linux'],
  },
  {
    id: 'dungeon-crawl',
    name: 'Dungeon Crawl',
    genre: ['RPG', 'Action'],
    supportedPlatforms: ['macos'],
  },
  {
    id: 'void-solitaire',
    name: 'Void Solitaire',
    genre: ['Card'],
    supportedPlatforms: [],
  },
];

const installedIds = new Set<string>(['astro-odyssey', 'dungeon-crawl']);

describe('game-filters', () => {
  it('emptyFilters matches all games', () => {
    expect(filterGames(games, installedIds, emptyFilters)).toEqual(games);
  });

  it("status 'installed' keeps only installed ids", () => {
    const filters: GameFilters = { ...emptyFilters, status: 'installed' };
    const result = filterGames(games, installedIds, filters);
    expect(result.map((g) => g.id)).toEqual(['astro-odyssey', 'dungeon-crawl']);
  });

  it('platform single-select filters to games that include the selected platform', () => {
    const filters: GameFilters = { ...emptyFilters, platform: 'windows' };
    const result = filterGames(games, installedIds, filters);
    expect(result.map((g) => g.id)).toEqual(['astro-odyssey', 'pixel-racer']);
  });

  it('genres multi-select: game matches if it has ANY selected genre', () => {
    const filters: GameFilters = { ...emptyFilters, genres: ['RPG', 'Card'] };
    const result = filterGames(games, installedIds, filters);
    expect(result.map((g) => g.id)).toEqual(['astro-odyssey', 'dungeon-crawl', 'void-solitaire']);
  });

  it('search narrows by name case-insensitively within already-filtered set', () => {
    const filters: GameFilters = { ...emptyFilters, genres: ['RPG'], search: 'dungeon' };
    const result = filterGames(games, installedIds, filters);
    expect(result.map((g) => g.id)).toEqual(['dungeon-crawl']);
  });

  it('isDefaultFilters true only for emptyFilters', () => {
    expect(isDefaultFilters(emptyFilters)).toBe(true);
    expect(isDefaultFilters({ ...emptyFilters, status: 'installed' })).toBe(false);
    expect(isDefaultFilters({ ...emptyFilters, platform: 'windows' })).toBe(false);
    expect(isDefaultFilters({ ...emptyFilters, genres: ['RPG'] })).toBe(false);
    expect(isDefaultFilters({ ...emptyFilters, search: 'astro' })).toBe(false);
  });

  it('collectPlatforms returns sorted unique values', () => {
    expect(collectPlatforms(games)).toEqual(['linux', 'macos', 'windows']);
  });

  it('collectGenres returns sorted unique values', () => {
    expect(collectGenres(games)).toEqual(['Action', 'Adventure', 'Card', 'RPG', 'Racing']);
  });

  it('handles games without supportedPlatforms gracefully', () => {
    const gamesWithoutPlatforms: GameInfoLike[] = [
      { id: 'no-platforms', name: 'No Platforms', genre: ['Puzzle'] },
    ];
    expect(collectPlatforms(gamesWithoutPlatforms)).toEqual([]);
    expect(
      filterGames(gamesWithoutPlatforms, new Set(), { ...emptyFilters, platform: 'windows' })
    ).toEqual([]);
  });
});
