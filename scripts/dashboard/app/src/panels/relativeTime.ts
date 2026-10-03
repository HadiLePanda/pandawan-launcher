/**
 * "3 minutes ago", for the restored-draft banner.
 *
 * One implementation rather than a per-panel copy, because the drafts in this
 * directory have to agree on how they describe their own age: a banner that said
 * "just now" in one panel and a raw timestamp in another would read as two
 * different systems.
 */
export function ago(epochMs: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - epochMs) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
