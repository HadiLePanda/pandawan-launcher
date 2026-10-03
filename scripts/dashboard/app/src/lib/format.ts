/**
 * How a value is written, not what it is.
 *
 * Show the value, don't label the state: a version is the biggest thing in its
 * cell, the build number a small qualifier, the age a footnote. These functions
 * return the pieces at those sizes and the components choose the element.
 */

/**
 * A compact age from an ISO timestamp: "2m ago".
 *
 * `savedPhrase` below takes epoch milliseconds and reads "3 minutes ago". The
 * two are different formats for different places, so the input type is part of
 * each name's contract - mixing them is how a timestamp renders as "NaNm ago".
 */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}

/** "2 minutes", for the data-age footnote in the header. */
function ageWords(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute';
  if (mins < 60) return `${mins} minutes`;
  const hours = Math.round(mins / 60);
  if (hours === 1) return '1 hour';
  if (hours < 24) return `${hours} hours`;
  const days = Math.round(hours / 24);
  if (days === 1) return '1 day';
  return `${days} days`;
}

/** "updated 2m ago" - the header footnote, or null when there is no age. */
export function updatedPhrase(ms: number | null): string | null {
  const words = ageWords(ms);
  return words === null ? null : `updated ${words}`;
}

/** A locale timestamp, for "saved at" on a restored draft. */
export function savedAt(iso: number | null | undefined): string {
  if (!iso) return 'an earlier session';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'an earlier session';
  return date.toLocaleString();
}

/** "3 minutes ago", from epoch milliseconds - the restored-draft banner. */
export function savedPhrase(epochMs: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** The label a status dot carries. Colour alone fails for a colour-blind reader. */
export const STATUS_TEXT: Record<'synced' | 'drifted' | 'empty', string> = {
  synced: 'in sync',
  drifted: 'out of sync',
  empty: 'no build',
};

/** "3 fields" / "1 field" / "nothing" - a plural that reads correctly. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * Split a comma list the way the publisher does, so "a, b" and "a,b" compare
 * equal. Used for the dirty check, where whitespace must not read as an edit.
 */
export function normaliseList(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
