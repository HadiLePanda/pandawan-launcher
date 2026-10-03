/**
 * The guard on the news document publish-catalog.mjs uploads.
 *
 * publish-news.mjs writes both copies of the feed, so normally this script's
 * upload is a no-op. But `npm run publish:catalog` replaces the CDN copy from the
 * checked-in public/news.json, so any edit that reached the CDN by another route -
 * a hand edit in R2, a restored bucket, a future tool - is destroyed by the next
 * catalog publish with no diff and no warning. That is the same trap the catalog
 * merge closed, and the rule is the same shape:
 *
 *   an upload may ADD items, never REMOVE them.
 *
 * Pure, with no R2 imports, so it is testable without credentials.
 */

/** The item ids in a news document, or [] when the document is not one. */
function itemIds(document) {
  const items = document && typeof document === 'object' ? document.items : null;
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => (item && typeof item === 'object' ? item.id : undefined))
    .filter((id) => typeof id === 'string' && id !== '');
}

/**
 * Ids the published document has that the local one does not - what the upload
 * would remove. Empty when the upload is purely additive, or when the published
 * copy is absent (a first publish has nothing to protect).
 */
export function droppedNewsIds(published, local) {
  const localIds = new Set(itemIds(local));
  return itemIds(published).filter((id) => !localIds.has(id));
}

/** The refusal, worded where the rule lives so the two cannot drift apart. */
export function newsRefusal(url, dropped) {
  return (
    `refusing to publish: replacing ${url} would remove ${dropped.length} published ` +
    `news item(s) the local file does not have:\n  ${dropped.join('\n  ')}\n\n` +
    'Re-publish the news with `npm run publish:news`, or pass --force-news to ' +
    'overwrite the CDN copy anyway.'
  );
}
