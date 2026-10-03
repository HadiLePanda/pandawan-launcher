/**
 * The news field contract: what a news item has, and the flag naming each field.
 *
 * Shared by the publisher, the dashboard form and the tests so a field cannot exist
 * in one and be missing from the other. Unlike game metadata the whole item lives in
 * one place, so there is no catalog/manifest split to describe.
 */

/** The channels the launcher knows. Mirrors KNOWN_CHANNELS in the frontend. */
export const CHANNELS = ['stable', 'beta', 'alpha'];

/**
 * `id` is deliberately absent: it is the item's identity, and its artwork object
 * names derive from it, so renaming one in place orphans those. Create a new id and
 * delete the old item instead. `long` renders as a textarea.
 */
export const NEWS_FIELDS = [
  { flag: 'title', label: 'Title' },
  { flag: 'excerpt', label: 'Excerpt', long: true },
  { flag: 'content', label: 'Article body', long: true },
  { flag: 'date', label: 'Date' },
  { flag: 'category', label: 'Category' },
  { flag: 'game-id', label: 'Game' },
  { flag: 'url', label: 'Link' },
  { flag: 'image-url', label: 'Image URL' },
];

/** The field that also accepts an upload; objects are named after the item id. */
export const NEWS_IMAGE_FIELD = {
  flag: 'image-file',
  metadataFlag: 'image-url',
  objectName: '{id}',
};

/** The prefix news artwork is published under, relative to the CDN origin. */
export const NEWS_ART_PREFIX = 'launcher/news';

/**
 * Categories offered as suggestions.
 *
 * Suggestions only, never a closed set: news-service.ts validates an item on `id`
 * and `title` alone, so rejecting a category the operator invented would be the
 * dashboard enforcing a rule the launcher does not have.
 */
export const NEWS_CATEGORY_SUGGESTIONS = ['Release', 'Event', 'Launcher', 'Update', 'Announcement'];

/** Turn a title into an id candidate. */
export function slugify(text) {
  return (
    String(text ?? '')
      .normalize('NFKD')
      // Drops the accents NFKD separates out, so "Café" becomes "cafe" not "caf".
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
  );
}

/** A new id distinct from every id already published; duplicates would merge two items. */
export function uniqueNewsId(title, taken) {
  const base = slugify(title) || 'news-item';
  const used = new Set(taken ?? []);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Matches news-service.ts and nothing more. */
export function validateNewsItem(item) {
  if (!item || typeof item !== 'object') return 'a news item must be an object';
  if (!String(item.id ?? '').trim()) return 'a news item needs an id';
  if (!String(item.title ?? '').trim()) return `"${item.id}" needs a title`;
  return null;
}

/** Every field present as a string, so the form renders a stable set of inputs. */
export function newsItemToFields(item) {
  const out = {};
  for (const field of NEWS_FIELDS) {
    out[field.flag] = item?.[toKey(field.flag)] ?? '';
  }
  return out;
}

/** `game-id` on the wire is `gameId`. One conversion, used everywhere. */
export function toKey(flag) {
  return flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Build the item a publish will write.
 *
 * Emptied optional fields are dropped rather than written as "", because the
 * launcher tests truthiness and "" would be indistinguishable from absent but larger.
 */
export function fieldsToNewsItem(id, values) {
  const item = { id: String(id).trim(), title: String(values.title ?? '').trim() };
  for (const field of NEWS_FIELDS) {
    if (field.flag === 'title') continue;
    const key = toKey(field.flag);
    const value = String(values[field.flag] ?? '').trim();
    if (value) item[key] = value;
  }
  return item;
}
