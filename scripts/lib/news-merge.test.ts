import { describe, it, expect } from 'vitest';

import { droppedNewsIds, newsRefusal } from './news-merge.mjs';

const item = (id: string, title = id) => ({ id, title, body: '', date: '2026-01-01' });

describe('droppedNewsIds', () => {
  it('is empty when the upload only adds items', () => {
    const published = { items: [item('a')] };
    const local = { items: [item('a'), item('b')] };
    expect(droppedNewsIds(published, local)).toEqual([]);
  });

  it('is empty when both sides are identical', () => {
    const doc = { items: [item('a'), item('b')] };
    expect(droppedNewsIds(doc, doc)).toEqual([]);
  });

  it('names the published items the local file does not have', () => {
    const published = { items: [item('a'), item('b'), item('c')] };
    const local = { items: [item('a')] };
    expect(droppedNewsIds(published, local)).toEqual(['b', 'c']);
  });

  it('is order-independent', () => {
    const published = { items: [item('a'), item('b')] };
    const local = { items: [item('b'), item('a')] };
    expect(droppedNewsIds(published, local)).toEqual([]);
  });

  it('protects nothing when the published copy is absent', () => {
    expect(droppedNewsIds(null, { items: [item('a')] })).toEqual([]);
    expect(droppedNewsIds(undefined, { items: [item('a')] })).toEqual([]);
  });

  it('treats a non-news document as having no items', () => {
    expect(droppedNewsIds({ games: [] }, { items: [item('a')] })).toEqual([]);
    expect(droppedNewsIds('not an object', { items: [item('a')] })).toEqual([]);
  });

  it('ignores items with no usable id rather than reporting an empty one', () => {
    const published = { items: [{ title: 'no id' }, item('a'), { id: '' }, null] };
    expect(droppedNewsIds(published, { items: [item('a')] })).toEqual([]);
  });

  it('reports every published item when the local file is empty', () => {
    // The destructive case the guard exists for: a local file that lost its items.
    const published = { items: [item('a'), item('b')] };
    expect(droppedNewsIds(published, { items: [] })).toEqual(['a', 'b']);
  });
});

describe('newsRefusal', () => {
  it('names the url, the count and every id, and says how to override', () => {
    const message = newsRefusal('https://cdn/launcher/news.json', ['a', 'b']);
    expect(message).toContain('https://cdn/launcher/news.json');
    expect(message).toContain('2 published');
    expect(message).toContain('  a\n  b');
    expect(message).toContain('--force-news');
  });
});
