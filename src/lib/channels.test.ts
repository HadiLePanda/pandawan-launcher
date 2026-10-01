import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isChannel,
  loadChannelOverrides,
  resolveChannel,
  saveChannelOverrides,
  setChannelOverride,
} from './channels';

// The test environment is node, which has no localStorage. The module wraps every
// access in try/catch, so a stub exercises the same path the webview does.
function stubStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

describe('isChannel', () => {
  it('accepts the three known channels', () => {
    expect(isChannel('stable')).toBe(true);
    expect(isChannel('beta')).toBe(true);
    expect(isChannel('alpha')).toBe(true);
  });

  it('rejects anything else, including a prototype key', () => {
    expect(isChannel('nightly')).toBe(false);
    expect(isChannel('')).toBe(false);
    expect(isChannel(null)).toBe(false);
    expect(isChannel('toString')).toBe(false);
  });
});

describe('loadChannelOverrides', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubStorage();
  });

  it('returns an empty map when nothing is stored', () => {
    expect(loadChannelOverrides()).toEqual({});
  });

  it('reads back what was saved', () => {
    saveChannelOverrides({ misspell: 'alpha' });
    expect(loadChannelOverrides()).toEqual({ misspell: 'alpha' });
  });

  it('drops entries that are not known channels', () => {
    // A stale key from an older build must not put the launcher into a channel
    // it has no manifest for.
    localStorage.setItem(
      'pandawan.gameChannels',
      JSON.stringify({ good: 'beta', bad: 'nightly', alsoBad: 42 })
    );
    expect(loadChannelOverrides()).toEqual({ good: 'beta' });
  });

  it('ignores a non-object payload', () => {
    localStorage.setItem('pandawan.gameChannels', '["alpha"]');
    expect(loadChannelOverrides()).toEqual({});
    localStorage.setItem('pandawan.gameChannels', 'not json');
    expect(loadChannelOverrides()).toEqual({});
  });
});

describe('resolveChannel', () => {
  it('prefers the player override over the catalog', () => {
    expect(resolveChannel('misspell', 'alpha', {})).toBe('alpha');
    expect(resolveChannel('misspell', 'alpha', { misspell: 'beta' })).toBe('beta');
  });

  it('does not leak one game override onto another', () => {
    expect(resolveChannel('other', 'stable', { misspell: 'alpha' })).toBe('stable');
  });
});

describe('setChannelOverride', () => {
  it('stores a channel that differs from the catalog', () => {
    const next = setChannelOverride({}, 'misspell', 'beta', 'alpha');
    expect(next).toEqual({ misspell: 'beta' });
  });

  it('clears the entry when the catalog channel is chosen', () => {
    // Storing the default would be redundant, and would keep overriding a later
    // publisher change to that channel.
    const next = setChannelOverride({ misspell: 'beta' }, 'misspell', 'alpha', 'alpha');
    expect(next).toEqual({});
  });

  it('does not mutate the input', () => {
    const before: Record<string, 'stable' | 'beta' | 'alpha'> = { misspell: 'beta' };
    setChannelOverride(before, 'misspell', 'alpha', 'stable');
    expect(before).toEqual({ misspell: 'beta' });
  });
});
