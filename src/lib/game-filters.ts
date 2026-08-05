export interface GameInfoLike {
  id: string;
  name: string;
  genre: string[];
  supportedPlatforms?: string[];
}

export interface GameFilters {
  status: 'all' | 'installed';
  platform: string | null;
  genres: string[];
  search: string;
}

export const emptyFilters: GameFilters = {
  status: 'all',
  platform: null,
  genres: [],
  search: '',
};

export function isDefaultFilters(f: GameFilters): boolean {
  return f.status === 'all' && f.platform === null && f.genres.length === 0 && f.search === '';
}

export function filterGames(
  games: GameInfoLike[],
  installedIds: Set<string>,
  f: GameFilters
): GameInfoLike[] {
  const q = f.search.trim().toLowerCase();
  return games.filter((g) => {
    if (f.status === 'installed' && !installedIds.has(g.id)) return false;
    if (f.platform && !g.supportedPlatforms?.includes(f.platform)) return false;
    if (f.genres.length > 0 && !f.genres.some((genre) => g.genre.includes(genre))) return false;
    if (q && !g.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function collectPlatforms(games: GameInfoLike[]): string[] {
  const set = new Set<string>();
  games.forEach((g) => g.supportedPlatforms?.forEach((p) => set.add(p)));
  return Array.from(set).sort();
}

export function collectGenres(games: GameInfoLike[]): string[] {
  const set = new Set<string>();
  games.forEach((g) => g.genre.forEach((genre) => set.add(genre)));
  return Array.from(set).sort();
}
