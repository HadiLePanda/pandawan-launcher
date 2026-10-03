/**
 * Cached server data.
 *
 * One store, keyed by endpoint, because every cached GET in this app is a
 * document the operator may be looking at while it goes stale in the background.
 * The server tells us how old it is (x-cache-age-ms) and whether it is stale
 * (x-cache), and both facts are kept next to the data - not in a component's
 * local state - so the header age and a tab's spinner can never disagree about
 * the same fetch.
 *
 * NO POLLING AND NO BACKGROUND REVALIDATION. That is a decision, not an omission:
 * the operator presses Refresh when they want fresh data. A silent revalidation
 * would replace the values someone is halfway through reviewing a diff against,
 * which is the one thing this tool must never do. So `load` is called on mount
 * and on an explicit refresh, and nowhere else.
 *
 * Draft state is deliberately NOT here. Drafts are per-target and belong to the
 * tab that owns them; putting them in a global store would let a draft for one
 * game leak into another.
 */

import { create } from 'zustand';

import { apiGet, type CacheState } from '@lib/api';
import type { CatalogPayload, InventoryPayload } from '@app-types/api';

export interface CacheEntry<T> {
  data: T | null;
  cache: CacheState;
  ageMs: number | null;
  error: string | null;
  loading: boolean;
  /** True while a refresh is in flight over data that is already on screen. */
  refreshing: boolean;
}

interface ServerState {
  inventory: CacheEntry<InventoryPayload>;
  /** GET /api/catalog is not guaranteed to exist yet; 404 is not an error here. */
  catalog: CacheEntry<CatalogPayload>;

  loadInventory: (options?: { refresh?: boolean }) => Promise<void>;
  loadCatalog: (options?: { refresh?: boolean }) => Promise<void>;
}

function empty<T>(): CacheEntry<T> {
  return { data: null, cache: null, ageMs: null, error: null, loading: false, refreshing: false };
}

/**
 * Fold a result into an entry.
 *
 * A success REPLACES the data outright rather than merging into it, so a game
 * that has been deleted or moved between channels cannot survive in the rail as a
 * ghost row. The failure path below is the one that preserves it.
 */
function fold<T>(result: { data: T; cache: CacheState; ageMs: number | null }): CacheEntry<T> {
  return {
    data: result.data,
    cache: result.cache,
    ageMs: result.ageMs,
    error: null,
    loading: false,
    refreshing: false,
  };
}

/**
 * Fold a failure into an entry, PRESERVING the previous data.
 *
 * A failed refresh must not blank the screen: the operator would lose the page
 * they were working on to a transient blip, and the previous data is still the
 * best available truth. Only `error` changes.
 */
function failed<T>(entry: CacheEntry<T>, message: string): CacheEntry<T> {
  return { ...entry, error: message, loading: false, refreshing: false };
}

export const useServer = create<ServerState>((set) => ({
  inventory: empty<InventoryPayload>(),
  catalog: empty<CatalogPayload>(),

  loadInventory: async (options = {}) => {
    const refresh = Boolean(options.refresh);
    set((state) => ({
      // A first load blanks; a refresh keeps the current data on screen and marks
      // the entry busy, which is what the header spinner reads.
      inventory: {
        ...state.inventory,
        loading: !refresh && state.inventory.data === null,
        refreshing: refresh,
      },
    }));
    try {
      const result = await apiGet<InventoryPayload>('/api/inventory', { refresh });
      set(() => ({ inventory: fold(result) }));
    } catch (err) {
      set((state) => ({
        inventory: failed(state.inventory, err instanceof Error ? err.message : String(err)),
      }));
    }
  },

  loadCatalog: async (options = {}) => {
    const refresh = Boolean(options.refresh);
    set((state) => ({
      catalog: {
        ...state.catalog,
        loading: !refresh && state.catalog.data === null,
        refreshing: refresh,
      },
    }));
    try {
      const result = await apiGet<CatalogPayload>('/api/catalog', { refresh });
      set(() => ({ catalog: fold(result) }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Not being able to read the catalog is a normal state for a server that
      // has not added the endpoint yet, or for a game with no entry. It must not
      // be the thing that stops the rail rendering, so an absent endpoint is
      // recorded as "nothing to show" rather than as a failure.
      const absent = /HTTP 404|not found/i.test(message);
      set((state) => ({
        catalog: {
          ...state.catalog,
          error: absent ? null : message,
          loading: false,
          refreshing: false,
        },
      }));
    }
  },
}));

/** The scopes the rail and the detail header both render from. */
export function useInventory() {
  return useServer((state) => state.inventory);
}
