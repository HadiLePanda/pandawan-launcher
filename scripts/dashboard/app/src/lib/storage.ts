/**
 * Draft persistence.
 *
 * Each editor keeps its in-progress values under a key that names the TARGET
 * being edited, because a draft for one game is a lie on another and one shared
 * key would restore an edit into the wrong form.
 *
 * The keys are built here and nowhere else, so "what does this page remember" is
 * one grep. Every draft is an envelope (savedAt, target, values) rather than a
 * bare value object: the resume path has to name what a draft is FOR, and
 * asking the key to carry that would mean parsing an id that may itself contain
 * dots.
 */

/** `pandawan.draft.meta.<gameId>.<channel>` and `pandawan.draft.news.<itemId>`. */
export const DRAFT_KEYS = {
  meta: (gameId: string, channel: string) => `pandawan.draft.meta.${gameId}.${channel || 'alpha'}`,
  news: (itemId: string | null) => `pandawan.draft.news.${itemId || 'new'}`,
} as const;

/** The selection and last-open-tab keys. Session state, not a draft. */
export const SESSION_KEYS = {
  game: 'pandawan.selection.game',
  channel: 'pandawan.selection.channel',
  tab: 'pandawan.selection.tab',
  query: 'pandawan.selection.query',
} as const;

/** Everything a draft envelope carries. */
export interface DraftEnvelope {
  savedAt: number;
  /** Human-readable target, so the resume banner never parses a key. */
  target: string;
  gameId?: string;
  channel?: string;
  itemId?: string;
  values: Record<string, string>;
}

/**
 * localStorage access that never throws.
 *
 * Private-mode and disabled-storage profiles throw on ACCESS rather than
 * returning null. Drafts are a convenience, so failing to read one must never
 * be the thing that breaks the editor.
 */
export function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Storage full or blocked: the edit still works, it just will not survive. */
  }
}

export function removeRaw(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* As above. */
  }
}

/** Read one draft envelope, or null when absent, unparseable or wrong-shaped. */
export function readDraft(key: string): DraftEnvelope | null {
  const raw = readRaw(key);
  if (!raw) return null;
  try {
    const draft: unknown = JSON.parse(raw);
    if (!draft || typeof draft !== 'object') return null;
    const envelope = draft as Partial<DraftEnvelope>;
    if (!envelope.values || typeof envelope.values !== 'object') return null;
    return {
      savedAt: Number(envelope.savedAt ?? 0),
      target: String(envelope.target ?? ''),
      gameId: envelope.gameId,
      channel: envelope.channel,
      itemId: envelope.itemId,
      values: envelope.values as Record<string, string>,
    };
  } catch {
    return null;
  }
}

/** Save a draft, or clear it when there is nothing left to remember. */
export function saveDraft(key: string, envelope: Omit<DraftEnvelope, 'savedAt'>): void {
  writeRaw(key, JSON.stringify({ ...envelope, savedAt: Date.now() }));
}

export function clearDraft(key: string): void {
  removeRaw(key);
}
