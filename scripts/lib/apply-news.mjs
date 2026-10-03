/**
 * How a news edit is decided. Two rules the dashboard leans on: one bad op never
 * aborts the batch, and an update only touches the fields it is given - absent keeps
 * the published value, blank removes it, or every save would wipe every article body.
 */

import { NEWS_FIELDS, fieldsToNewsItem, toKey, validateNewsItem } from './news-fields.mjs';

/** Flag -> wire key, resolved once: `game-id`/`gameId` is the pair that gets retyped wrong. */
const EDITABLE = NEWS_FIELDS.map((field) => ({ flag: field.flag, key: toKey(field.flag) }));

const VERBS = { update: 'Update', create: 'Create', delete: 'Delete', move: 'Move' };

/** An item's name in a list: its title, or its id while the title is still blank. */
export function newsItemLabel(item) {
  const title = String(item?.title ?? '').trim();
  return title || String(item?.id ?? '').trim();
}

/** Absent and "" both report as null, so a cleared field is visible in the diff. */
function fieldDiff(before, after) {
  const left = {};
  const right = {};
  for (const { key } of EDITABLE) {
    const a = before?.[key] ?? null;
    const b = after?.[key] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    left[key] = a;
    right[key] = b;
  }
  return { before: left, after: right };
}

/**
 * Apply the ops in order, mutating `feed` in place - the caller holds that object.
 * Array order is display order: nothing here sorts or dedupes, because reordering
 * announcements is a deliberate operator action.
 */
export function applyNewsOps(feed, ops) {
  const applied = [];
  const errors = [];

  const items = Array.isArray(feed?.items) ? feed.items : null;

  for (const op of ops ?? []) {
    const id = String(op?.id ?? '').trim();
    const label = `${VERBS[op?.op] ?? 'Apply'} ${id || '(no id)'}`;

    if (!items) {
      errors.push({ id, message: 'the news document has no items array' });
      continue;
    }

    const at = id ? items.findIndex((item) => item?.id === id) : -1;

    switch (op?.op) {
      case 'update': {
        if (at < 0) {
          errors.push({ id, message: `no news item with id "${id}"` });
          break;
        }
        const before = items[at];
        const next = buildUpdate(before, id, op.values);
        const problem = validateNewsItem(next);
        if (problem) {
          // A rejected edit must not half-apply; the published copy stays as it was.
          errors.push({ id, message: problem });
          break;
        }
        items[at] = next;
        const { before: from, after: to } = fieldDiff(before, next);
        applied.push({ label, before: from, after: to });
        break;
      }

      case 'create': {
        if (at >= 0) {
          // A duplicate id merges two announcements in the dashboard and collides on the
          // artwork name, which is keyed off it.
          errors.push({ id, message: `a news item with id "${id}" already exists` });
          break;
        }
        const item = fieldsToNewsItem(id, op.values);
        const problem = validateNewsItem(item);
        if (problem) {
          errors.push({ id, message: problem });
          break;
        }
        const index = insertionIndex(items.length, op.index);
        if (Number.isNaN(index)) {
          errors.push({ id, message: `create index "${op.index}" is not a whole number` });
          break;
        }
        items.splice(index, 0, item);
        applied.push({ label, before: null, after: item });
        break;
      }

      case 'delete': {
        if (at < 0) {
          errors.push({ id, message: `no news item with id "${id}"` });
          break;
        }
        const [removed] = items.splice(at, 1);
        applied.push({ label, before: removed, after: null });
        break;
      }

      case 'move': {
        if (at < 0) {
          errors.push({ id, message: `no news item with id "${id}"` });
          break;
        }
        const to = at + Number(op.delta ?? 0);
        const lands = Number.isInteger(to) && to >= 0 && to < items.length;
        if (lands) items.splice(to, 0, items.splice(at, 1)[0]);
        // Off the end is not an error: the button was pressed, so log the press and the
        // position the item stayed at.
        applied.push({ label, before: at, after: lands ? to : at });
        break;
      }

      default:
        errors.push({ id, message: `unknown op "${op?.op}"` });
    }
  }

  return { applied, errors };
}

/**
 * The item an update produces. Posted keys are dropped before the rebuilt values go
 * back on, which is what makes a blanked field a removal rather than a leftover.
 */
function buildUpdate(item, id, values) {
  const posted = values ?? {};
  const next = { ...item };
  for (const { flag, key } of EDITABLE) {
    if (Object.hasOwn(posted, flag)) delete next[key];
  }
  const rebuilt = fieldsToNewsItem(id, posted);
  // fieldsToNewsItem always writes a title, because a create without one fails
  // validation. Here it is optional: an unposted title would blank the headline and
  // get the whole op rejected as titleless.
  if (!Object.hasOwn(posted, 'title')) delete rebuilt.title;
  return Object.assign(next, rebuilt);
}

/** Clamped, because a stale index is a UI artifact; a non-integer one is a caller bug. */
function insertionIndex(length, index) {
  if (index === undefined || index === null) return length;
  const at = Number(index);
  if (!Number.isInteger(at)) return NaN;
  return Math.min(Math.max(at, 0), length);
}
