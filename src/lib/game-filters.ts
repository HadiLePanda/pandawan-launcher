export interface GameInfoLike {
  id: string;
  name: string;
  genre: string[];
  supportedPlatforms?: string[];
}

export interface GameFilters {
  status: 'all' | 'installed';
  platform: string | null;
  search: string;
}

export const emptyFilters: GameFilters = {
  status: 'all',
  platform: null,
  search: '',
};

export function isDefaultFilters(f: GameFilters): boolean {
  return f.status === 'all' && f.platform === null && f.search === '';
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
    if (q && !g.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function collectPlatforms(games: GameInfoLike[]): string[] {
  const set = new Set<string>();
  games.forEach((g) => g.supportedPlatforms?.forEach((p) => set.add(p)));
  return Array.from(set).sort();
}

export const PLATFORM_LABELS: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform.charAt(0).toUpperCase() + platform.slice(1);
}
