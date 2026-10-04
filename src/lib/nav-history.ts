export type NavView = 'games' | 'news' | 'store' | 'downloads';

export interface NavArticle {
  articleId: string;
  gameId: string;
}

/**
 * One surface the user can be on. The whole screen is one value, so the history
 * cannot drift from what is on screen.
 */
export interface NavEntry {
  view: NavView;
  gameId: string | null;
  article: NavArticle | null;
}

export interface NavHistory {
  entries: NavEntry[];
  /** Index of the live entry. Never below 0: the history is never empty. */
  index: number;
}

/** A launcher can stay open for days, so the trail is capped and the oldest goes. */
export const NAV_HISTORY_LIMIT = 100;

const EMPTY: NavEntry = { view: 'games', gameId: null, article: null };

export function initialHistory(entry: NavEntry): NavHistory {
  return { entries: [entry], index: 0 };
}

export function current(history: NavHistory): NavEntry {
  return history.entries[history.index] ?? history.entries[0] ?? EMPTY;
}

export function sameEntry(a: NavEntry, b: NavEntry): boolean {
  return (
    a.view === b.view &&
    a.gameId === b.gameId &&
    (a.article?.articleId ?? null) === (b.article?.articleId ?? null) &&
    (a.article?.gameId ?? null) === (b.article?.gameId ?? null)
  );
}

/** A repeat of the live entry is not a step, and a new one drops the branch ahead. */
export function push(history: NavHistory, entry: NavEntry): NavHistory {
  if (sameEntry(current(history), entry)) return history;

  const kept = history.entries.slice(0, history.index + 1);
  kept.push(entry);
  const overflow = Math.max(0, kept.length - NAV_HISTORY_LIMIT);
  return { entries: kept.slice(overflow), index: kept.length - overflow - 1 };
}

/** For repairing the screen, not for navigating: it must not add a step. */
export function replaceEntry(history: NavHistory, entry: NavEntry): NavHistory {
  const entries = history.entries.slice();
  entries[history.index] = entry;
  return { entries, index: history.index };
}

/** The most recent games entry at or before the cursor, or null if none was reached. */
export function lastGamesEntry(history: NavHistory): NavEntry | null {
  for (let i = history.index; i >= 0; i -= 1) {
    const entry = history.entries[i];
    if (entry?.view === 'games') return entry;
  }
  return null;
}

export function goBack(history: NavHistory): NavHistory {
  if (history.index <= 0) return history;
  return { entries: history.entries, index: history.index - 1 };
}

export function goForward(history: NavHistory): NavHistory {
  if (history.index >= history.entries.length - 1) return history;
  return { entries: history.entries, index: history.index + 1 };
}

export function canGoBack(history: NavHistory): boolean {
  return history.index > 0;
}

export function canGoForward(history: NavHistory): boolean {
  return history.index < history.entries.length - 1;
}
