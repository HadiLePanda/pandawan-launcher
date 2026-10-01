/**
 * Per-game release channel selection.
 *
 * The catalog publishes one channel per game, so a store page can only ever show
 * whichever the publisher chose. A friend on a different channel needs to be
 * able to pull the release instead, and opting into a playtest should survive a
 * launcher update. Overrides live in localStorage next to the pin state, because
 * they are a per-device preference rather than account data.
 *
 * Values are validated on read: a stale or hand-edited key must not put the
 * launcher into a channel it has no manifest for.
 */

const STORAGE_KEY = 'pandawan.gameChannels';

export const KNOWN_CHANNELS = ['stable', 'beta', 'alpha'] as const;
export type Channel = (typeof KNOWN_CHANNELS)[number];

export function isChannel(value: unknown): value is Channel {
  return typeof value === 'string' && (KNOWN_CHANNELS as readonly string[]).includes(value);
}

/** Every stored override. Entries that are not known channels are dropped. */
export function loadChannelOverrides(): Record<string, Channel> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, Channel> = {};
    for (const [gameId, channel] of Object.entries(parsed as Record<string, unknown>)) {
      if (isChannel(channel)) out[gameId] = channel;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveChannelOverrides(overrides: Record<string, Channel>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Non-fatal; the override just will not survive a restart.
  }
}

/**
 * Channel to use for a game: the player's override if they set one, otherwise
 * whatever the catalog published.
 */
export function resolveChannel(
  gameId: string,
  catalogChannel: string,
  overrides: Record<string, Channel>
): string {
  return overrides[gameId] ?? catalogChannel;
}

/**
 * Set or clear one game's override. Choosing the catalog's own channel clears
 * the entry rather than storing a redundant one, so a later publisher change to
 * that channel is picked up automatically.
 */
export function setChannelOverride(
  overrides: Record<string, Channel>,
  gameId: string,
  channel: Channel,
  catalogChannel: string
): Record<string, Channel> {
  const next = { ...overrides };
  if (channel === catalogChannel) {
    delete next[gameId];
  } else {
    next[gameId] = channel;
  }
  return next;
}
