const STORAGE_KEY = 'pandawan.unpinnedGameIds';

export function loadUnpinnedGameIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

export function saveUnpinnedGameIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage failures are non-fatal; pins just won't persist.
  }
}

export function isGamePinned(gameId: string, unpinnedGameIds: string[]): boolean {
  return !unpinnedGameIds.includes(gameId);
}
