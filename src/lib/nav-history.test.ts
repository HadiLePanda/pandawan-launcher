import { describe, it, expect } from 'vitest';
import {
  NAV_HISTORY_LIMIT,
  canGoBack,
  canGoForward,
  current,
  goBack,
  goForward,
  initialHistory,
  push,
  replaceEntry,
  sameEntry,
  type NavEntry,
  type NavHistory,
} from './nav-history';

const HOME: NavEntry = { view: 'games', gameId: null, article: null };
const NEWS: NavEntry = { view: 'news', gameId: null, article: null };
const GAME: NavEntry = { view: 'games', gameId: 'pandawan-idle', article: null };
const ARTICLE: NavEntry = {
  view: 'games',
  gameId: 'pandawan-idle',
  article: { articleId: 'idle-1.0', gameId: 'pandawan-idle' },
};

const at = (history: NavHistory) => history.entries[history.index];

describe('push', () => {
  it('records the surface reached', () => {
    const history = push(initialHistory(HOME), GAME);
    expect(history.entries).toEqual([HOME, GAME]);
    expect(history.index).toBe(1);
    expect(current(history)).toEqual(GAME);
  });

  it('stops at the start instead of wrapping around', () => {
    let history = push(initialHistory(HOME), NEWS);
    history = push(history, GAME);
    history = goBack(history);
    history = goBack(history);
    expect(history.index).toBe(0);
    expect(at(history)).toEqual(HOME);
  });

  it('stops at the end instead of wrapping around', () => {
    let history = push(initialHistory(HOME), NEWS);
    history = goForward(history);
    expect(history.index).toBe(1);
    expect(at(history)).toEqual(NEWS);
  });

  it('reports what is reachable', () => {
    let history = initialHistory(HOME);
    expect(canGoBack(history)).toBe(false);
    expect(canGoForward(history)).toBe(false);

    history = push(history, NEWS);
    expect(canGoBack(history)).toBe(true);
    expect(canGoForward(history)).toBe(false);

    history = goBack(history);
    expect(canGoBack(history)).toBe(false);
    expect(canGoForward(history)).toBe(true);
  });

  it('records the same surface only once', () => {
    const history = push(push(initialHistory(HOME), GAME), GAME);
    expect(history.entries).toEqual([HOME, GAME]);
    expect(history.index).toBe(1);
  });

  it('drops the branch ahead of a new destination', () => {
    let history = push(initialHistory(HOME), NEWS);
    history = push(history, GAME);
    history = goBack(history);
    history = push(history, ARTICLE);
    expect(history.entries).toEqual([HOME, NEWS, ARTICLE]);
    expect(history.index).toBe(2);
  });

  it('keeps every surface, so the arrows work from any tab', () => {
    let history = initialHistory(HOME);
    for (const entry of [NEWS, GAME, ARTICLE]) history = push(history, entry);
    expect(history.entries).toHaveLength(4);
    expect(at(goBack(history))).toEqual(GAME);
    expect(at(goBack(goBack(history)))).toEqual(NEWS);
  });

  it('drops the oldest entry past the limit and keeps the cursor on the live one', () => {
    let history = initialHistory(HOME);
    for (let i = 0; i < NAV_HISTORY_LIMIT + 20; i += 1) {
      history = push(history, { view: 'news', gameId: null, article: null });
      history = push(history, GAME);
    }
    expect(history.entries).toHaveLength(NAV_HISTORY_LIMIT);
    expect(current(history)).toEqual(GAME);
  });
});

describe('replaceEntry', () => {
  it('repairs the live entry without adding a step', () => {
    const history = replaceEntry(push(initialHistory(HOME), ARTICLE), HOME);
    expect(history.entries).toEqual([HOME, HOME]);
    expect(history.index).toBe(1);
  });
});

describe('sameEntry', () => {
  it('compares the article as well as the surface', () => {
    expect(sameEntry(ARTICLE, ARTICLE)).toBe(true);
    expect(sameEntry(ARTICLE, GAME)).toBe(false);
    expect(
      sameEntry(
        { view: 'news', gameId: 'a', article: { articleId: 'x', gameId: 'a' } },
        { view: 'news', gameId: 'b', article: { articleId: 'x', gameId: 'b' } }
      )
    ).toBe(false);
  });

  it('treats a missing article as no article', () => {
    expect(sameEntry(GAME, { ...GAME, article: null })).toBe(true);
  });
});

describe('goBack and goForward', () => {
  it('leaves an untouched history where it is', () => {
    const history = initialHistory(HOME);
    expect(goBack(history)).toEqual(history);
    expect(goForward(history)).toEqual(history);
  });

  it('walks the whole trail and stops', () => {
    let history = push(push(initialHistory(HOME), NEWS), GAME);
    history = goBack(goBack(history));
    expect(at(history)).toEqual(HOME);
    history = goForward(goForward(history));
    expect(at(history)).toEqual(GAME);
    expect(canGoForward(history)).toBe(false);
  });
});
