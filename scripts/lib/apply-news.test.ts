import { describe, it, expect } from 'vitest';

import { applyNewsOps, newsItemLabel } from './apply-news.mjs';

/**
 * A fresh feed per test.
 *
 * These tests assert on array identity, so a shared fixture would let a mutation
 * leak from one test into the next and hide the very thing being checked.
 */
const feedWith = (...ids: Array<string>) => ({
  items: ids.map((id) => ({ id, title: `${id} title`, category: 'Update' })),
});

const idsOf = (feed: { items: Array<{ id: string }> }) => feed.items.map((item) => item.id);

describe('updating a news item', () => {
  it('writes the requested field, leaves the others, and reports what moved', () => {
    const feed = feedWith('patch');

    const { applied } = applyNewsOps(feed, [
      { op: 'update', id: 'patch', values: { title: 'Patch 1.2' } },
    ]);

    expect(feed.items[0].title).toBe('Patch 1.2');
    // The category was never mentioned in `values`, so it must survive untouched.
    expect(feed.items[0].category).toBe('Update');
    expect(applied).toHaveLength(1);
    expect(applied[0].label).toBe('Update patch');
    // A log that echoed the whole item back would drown the one field that moved.
    expect(applied[0].before).toEqual({ title: 'patch title' });
    expect(applied[0].after).toEqual({ title: 'Patch 1.2' });
  });

  it('removes a field posted blank but keeps one that is simply absent', () => {
    const feed = { items: [{ id: 'patch', title: 'Patch', excerpt: 'Old', content: 'Body' }] };

    applyNewsOps(feed, [{ op: 'update', id: 'patch', values: { title: 'Patch', excerpt: '' } }]);

    // Blank means "take it down", the same rule fieldsToNewsItem applies on create.
    expect('excerpt' in feed.items[0]).toBe(false);
    // Absent means "not part of this edit" - a form posting every field on every
    // save would otherwise wipe the article body on each typo fix in the title.
    expect(feed.items[0].content).toBe('Body');
  });

  it('maps the game-id flag onto gameId rather than leaking the flag name', () => {
    const feed = feedWith('patch');

    // Also a merge check: nothing but gameId may move, and the old title stays
    // because an update that never mentions the title must not blank it.
    applyNewsOps(feed, [{ op: 'update', id: 'patch', values: { 'game-id': 'space-drifter' } }]);

    expect(feed.items[0].gameId).toBe('space-drifter');
    expect('game-id' in feed.items[0]).toBe(false);
    expect(feed.items[0].title).toBe('patch title');
  });

  it('rejects a blank title and leaves the published item intact', () => {
    const feed = { items: [{ id: 'patch', title: 'Patch', content: 'Body' }] };

    const { applied, errors } = applyNewsOps(feed, [
      { op: 'update', id: 'patch', values: { title: '   ', content: 'New body' } },
    ]);

    expect(applied).toEqual([]);
    expect(errors[0].message).toContain('needs a title');
    // Half-applying would delete the live article body on a rejected save.
    expect(feed.items[0]).toEqual({ id: 'patch', title: 'Patch', content: 'Body' });
  });
});
describe('creating and deleting news items', () => {
  it('appends when no index is given and returns the item it wrote', () => {
    const feed = feedWith('alpha');

    const { applied } = applyNewsOps(feed, [
      { op: 'create', id: 'beta', values: { title: 'Beta', category: 'Release' } },
    ]);

    expect(idsOf(feed)).toEqual(['alpha', 'beta']);
    expect(applied[0].before).toBe(null);
    expect(feed.items[1]).toEqual({ id: 'beta', title: 'Beta', category: 'Release' });
  });

  it('honours an explicit index', () => {
    const feed = feedWith('alpha', 'beta');

    applyNewsOps(feed, [{ op: 'create', id: 'gamma', index: 1, values: { title: 'Gamma' } }]);

    // Order is display order, so the index is the operator choosing the slot.
    expect(idsOf(feed)).toEqual(['alpha', 'gamma', 'beta']);
  });

  it('clamps an index outside the feed instead of dropping the item', () => {
    const past = feedWith('alpha');
    const before = feedWith('alpha', 'beta');

    // A stale row count from a form that was not re-rendered after a delete, and
    // a negative slot, which splice would otherwise read as "from the end".
    applyNewsOps(past, [{ op: 'create', id: 'beta', index: 99, values: { title: 'Beta' } }]);
    applyNewsOps(before, [{ op: 'create', id: 'gamma', index: -5, values: { title: 'Gamma' } }]);

    expect(idsOf(past)).toEqual(['alpha', 'beta']);
    expect(idsOf(before)).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('refuses a duplicate id', () => {
    const feed = feedWith('alpha');

    const { applied, errors } = applyNewsOps(feed, [
      { op: 'create', id: 'alpha', values: { title: 'Impostor' } },
    ]);

    // Two rows on one id would merge in the dashboard and collide on the image name.
    expect(errors[0].message).toContain('already exists');
    expect(applied).toEqual([]);
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].title).toBe('alpha title');
  });

  it('errors on a create with an empty title', () => {
    const feed = feedWith('alpha');

    const { errors } = applyNewsOps(feed, [{ op: 'create', id: 'blank', values: { title: '' } }]);

    expect(errors[0].id).toBe('blank');
    expect(feed.items).toHaveLength(1);
  });

  it('leaves absent optional fields absent rather than writing empty strings', () => {
    const feed = feedWith();

    applyNewsOps(feed, [{ op: 'create', id: 'beta', values: { title: 'Beta' } }]);

    // The launcher tests truthiness; "" is indistinguishable from absent but
    // larger, so an item full of empty strings is a published file of noise.
    expect(Object.keys(feed.items[0])).toEqual(['id', 'title']);
  });

  it('deletes only the named item and hands it back as the before value', () => {
    const feed = feedWith('alpha', 'beta', 'gamma');

    const { applied } = applyNewsOps(feed, [{ op: 'delete', id: 'beta' }]);

    expect(idsOf(feed)).toEqual(['alpha', 'gamma']);
    expect(applied[0].label).toBe('Delete beta');
    expect(applied[0].before).toEqual({ id: 'beta', title: 'beta title', category: 'Update' });
    expect(applied[0].after).toBe(null);
  });

  it('errors on a missing id whatever the op, and applies nothing', () => {
    const feed = feedWith('alpha');

    const { applied, errors } = applyNewsOps(feed, [
      { op: 'delete', id: 'ghost' },
      { op: 'move', id: 'ghost', delta: -1 },
    ]);

    // Delete, move and update share one lookup, so all three have to speak up:
    // a row that silently refuses to change is the worst thing a panel can do.
    expect(errors.map((entry) => entry.message)).toEqual([
      'no news item with id "ghost"',
      'no news item with id "ghost"',
    ]);
    expect(applied).toEqual([]);
    expect(idsOf(feed)).toEqual(['alpha']);
  });
});
describe('moving news items', () => {
  it('moves an item up with delta -1 and back down with delta 1', () => {
    const feed = feedWith('alpha', 'beta', 'gamma');

    applyNewsOps(feed, [
      { op: 'move', id: 'gamma', delta: -1 },
      { op: 'move', id: 'gamma', delta: 1 },
    ]);

    // Two moves in opposite directions must return to the start, or the sign
    // convention is ambiguous and the two buttons silently disagree.
    expect(idsOf(feed)).toEqual(['alpha', 'beta', 'gamma']);

    applyNewsOps(feed, [{ op: 'move', id: 'gamma', delta: -1 }]);
    expect(idsOf(feed)).toEqual(['alpha', 'gamma', 'beta']);
  });

  it('records a move off either end as applied at the unchanged position', () => {
    const top = feedWith('alpha', 'beta');
    const bottom = feedWith('alpha', 'beta');

    const first = applyNewsOps(top, [{ op: 'move', id: 'alpha', delta: -1 }]);
    const last = applyNewsOps(bottom, [{ op: 'move', id: 'beta', delta: 1 }]);

    // Not an error: the button did nothing wrong, it had nowhere to go. Not a
    // silent no-op either, or the operator presses it twice and sees no record.
    for (const { applied, errors } of [first, last]) {
      expect(errors).toEqual([]);
      expect(applied).toHaveLength(1);
      expect(applied[0].label).toMatch(/^Move /);
      // before === after is the whole report: the row did not move.
      expect(applied[0].before).toBe(applied[0].after);
    }
    expect(idsOf(top)).toEqual(['alpha', 'beta']);
    expect(idsOf(bottom)).toEqual(['alpha', 'beta']);
  });
});
describe('applying a batch', () => {
  it('applies the good ops and reports the bad ones without aborting', () => {
    const feed = feedWith('alpha', 'beta', 'gamma');

    const { applied, errors } = applyNewsOps(feed, [
      { op: 'create', id: 'delta', values: { title: 'Delta' } },
      { op: 'update', id: 'ghost', values: { title: 'Nope' } },
      { op: 'move', id: 'gamma', delta: -1 },
      { op: 'create', id: 'alpha', values: { title: 'Impostor' } },
      { op: 'create', id: 'epsilon', values: { title: '' } },
      { op: 'delete', id: 'beta' },
      { op: 'update', id: 'alpha', values: { title: 'Alpha, edited' } },
    ]);

    // Four good ops survive three bad ones, and the update that follows a failed
    // one still lands. Aborting at the first error would have left the feed
    // untouched and told the operator to redo the whole list.
    expect(applied.map((entry) => entry.label)).toEqual([
      'Create delta',
      'Move gamma',
      'Delete beta',
      'Update alpha',
    ]);
    expect(errors.map((entry) => entry.id)).toEqual(['ghost', 'alpha', 'epsilon']);
    expect(idsOf(feed)).toEqual(['alpha', 'gamma', 'delta']);
    expect(feed.items[0].title).toBe('Alpha, edited');
  });

  it('reports an op it does not recognise rather than ignoring it', () => {
    const feed = feedWith('alpha');

    const { applied, errors } = applyNewsOps(feed, [
      { op: 'frobnicate', id: 'alpha' },
      { op: 'delete', id: 'alpha' },
    ]);

    // A typo in a verb must not read as success, and must not eat the op after it.
    expect(errors[0].message).toContain('unknown op');
    expect(applied).toHaveLength(1);
    expect(idsOf(feed)).toEqual([]);
  });

  it('mutates the feed in place, leaving its keys and array identity alone', () => {
    const feed = { version: 2, updatedAt: 'yesterday', items: feedWith('alpha').items };
    const items = feed.items;

    applyNewsOps(feed, [{ op: 'create', id: 'beta', values: { title: 'Beta' } }]);

    // The dashboard holds this array; replacing it would detach the reference the
    // UI is rendering from and make the edit look like it never happened.
    expect(feed.items).toBe(items);
    expect(feed).toEqual({
      version: 2,
      updatedAt: 'yesterday',
      items: [
        { id: 'alpha', title: 'alpha title', category: 'Update' },
        { id: 'beta', title: 'Beta' },
      ],
    });
  });
});

describe('labelling a news item', () => {
  it('names an item by its title, or by its id when the title is blank', () => {
    expect(newsItemLabel({ id: 'patch', title: 'Patch 1.2' })).toBe('Patch 1.2');

    // A draft being typed has no title yet; a column of blank rows is useless for
    // telling two drafts apart, and the id is always there.
    expect(newsItemLabel({ id: 'patch', title: '   ' })).toBe('patch');
    expect(newsItemLabel({ id: 'patch' })).toBe('patch');
  });
});
