/**
 * "3 minutes ago", for the restored-draft banner.
 *
 * Named for that banner rather than `ago`: lib/format.ts also exports an `ago`,
 * which takes an ISO string and reads "2m ago". Two functions sharing a name
 * with different inputs and different output is how a timestamp ends up
 * rendering as "NaNm ago".
 */
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
