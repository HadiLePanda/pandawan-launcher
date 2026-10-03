/**
 * Session state: which SECTION is open, which game is selected, and which tab of
 * that game is open.
 *
 * The dashboard is two levels deep and this store mirrors that exactly:
 *
 *   level 1  section       games | launcher | website | services | commands
 *   level 2  tab           metadata | artwork | builds | news | prune  (games only)
 *             launcherTab  releases | catalog                     (launcher only)
 *
 * Games is one section and not the whole tool. A published launcher version, the
 * public website and the local dev services have their own lifecycles - and the
 * website has its own repository - while the launcher owns the catalog because
 * the catalog IS the launcher's game index. Nothing outside Games takes a game
 * id, which is why only Games has a selection here at all.
 *
 * The ids live here and the COMPONENTS live in components/sections/registry.tsx
 * and components/tabs/registry.tsx. That split is deliberate: the registries
 * import these id types from here, so the components cannot come too. It also
 * means a stale persisted id can be validated without importing a single
 * component.
 *
 * PERSISTENCE. The section lives in `location.hash` - a reload lands where you
 * were and `#website` is a link someone can paste - and is mirrored into
 * localStorage so a first paint before the listener attaches already has it. The
 * sub-tabs stay in localStorage as they always did. Every read is validated
 * against the id lists below, so a renamed or removed entry falls back rather
 * than rendering a component that no longer exists.
 */

import { create } from 'zustand';

import { filterScopes, parseScopeKey, scopeKey, type GameScope } from '@lib/games';
import { readRaw, removeRaw, writeRaw, SESSION_KEYS } from '@lib/storage';

/**
 * The level-1 sections, in render order.
 *
 * Games first because that is where work starts. The order is a workflow, not a
 * risk ranking: nothing destructive is a top-level section, and Prune - the one
 * tab that deletes - is deliberately the last tab inside the first section, so it
 * is one deliberate reach past the tabs people use every day.
 *
 * The order here is the order of SECTIONS in components/sections/registry.tsx.
 */
export const SECTION_IDS = ['games', 'launcher', 'website', 'services', 'commands'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export function isSectionId(value: string | null | undefined): value is SectionId {
  return Boolean(value) && (SECTION_IDS as readonly string[]).includes(value as string);
}

/**
 * The level-2 tabs inside Games, in render order.
 *
 * Metadata first: it is the editor people live in. Prune is LAST because it is
 * the only one of these that deletes things.
 *
 * Every one of these acts on the game selected in the rail, so the strip cannot
 * be reached without a selection. There is no panel-style exception any more:
 * the panels that used to sit in this strip are now top-level sections or
 * Launcher sub-sections.
 */
export const GAME_TAB_IDS = ['metadata', 'artwork', 'builds', 'news', 'prune'] as const;
export type GameTabId = (typeof GAME_TAB_IDS)[number];

export function isGameTabId(value: string | null | undefined): value is GameTabId {
  return Boolean(value) && (GAME_TAB_IDS as readonly string[]).includes(value as string);
}

/**
 * The level-2 sub-sections inside Launcher.
 *
 * Releases is the launcher app's own ladder and its publish verbs. Catalog is the
 * game index the launcher reads. One section because publishing a launcher build
 * and registering a game are both "what the launcher shows", and because the
 * relationship between an index and the app that ships inside it is the same one
 * the Website section makes obvious about the site: the data lives in R2 and the
 * app reads it, so neither one is true on its own.
 */
export const LAUNCHER_TAB_IDS = ['releases', 'catalog'] as const;
export type LauncherTabId = (typeof LAUNCHER_TAB_IDS)[number];

export function isLauncherTabId(value: string | null | undefined): value is LauncherTabId {
  return Boolean(value) && (LAUNCHER_TAB_IDS as readonly string[]).includes(value as string);
}

/*
 * The two new keys are declared here rather than added to SESSION_KEYS in
 * @lib/storage. That module owns the DRAFT key grammar and is shared with the
 * editors; these two are this store's own contract, and the section's real home
 * is the address bar, so localStorage is only a mirror of it.
 */
const SECTION_KEY = 'pandawan.selection.section';
const LAUNCHER_TAB_KEY = 'pandawan.selection.launcherTab';

/** The hash for a section. One place, so the link format is one grep. */
export function sectionHash(section: SectionId): string {
  return `#${section}`;
}

/**
 * The section a location hash names, or null.
 *
 * Tolerant in what it accepts and strict in what it returns: '#games', '#/games'
 * and '#games?x=1' all resolve, while an anchor left by another page, a truncated
 * paste or a typo resolves to null - and null means "fall back", never "render
 * nothing". A malformed URL must never leave the dashboard with no page at all.
 */
export function sectionFromHash(hash: string | null | undefined): SectionId | null {
  const raw = String(hash ?? '').trim();
  if (!raw) return null;
  // Strip the leading '#' or '#!', drop leading slashes, then take the first path,
  // query or fragment segment - so '#/games/builds' names games.
  const cleaned =
    raw
      .replace(/^[#!]+/, '')
      .replace(/^\/+/, '')
      .split(/[/?#&]/)[0] ?? '';
  if (!cleaned) return null;
  let value = cleaned;
  try {
    value = decodeURIComponent(cleaned);
  } catch {
    // A malformed percent escape is not a section id. Use the raw text.
  }
  const id = value.trim().toLowerCase();
  return isSectionId(id) ? id : null;
}

/** Put the section in the address bar. Never throws, never adds a history entry. */
export function writeSectionHash(section: SectionId): void {
  try {
    const hash = sectionHash(section);
    if (window.location.hash === hash) return;
    // replaceState, not `location.hash =`: switching section is a mode change,
    // not a navigation, and pushing an entry per click would make the browser's
    // Back button walk the sections instead of leaving the tool.
    window.history.replaceState(null, '', hash);
  } catch {
    /* Some webviews refuse history writes; the section still switches. */
  }
}

function readStoredSection(): SectionId {
  const fromHash = sectionFromHash(window.location.hash);
  if (fromHash) return fromHash;
  const stored = readRaw(SECTION_KEY);
  return isSectionId(stored) ? stored : 'games';
}

interface SessionState {
  /** The open level-1 section. */
  section: SectionId;
  /** `<gameId> <channel>`, or '' when nothing is selected. Games only. */
  selectedKey: string;
  query: string;
  /** The open level-2 tab inside Games. */
  tab: GameTabId;
  /** The open level-2 sub-section inside Launcher. */
  launcherTab: LauncherTabId;
  /** Set while the create-game dialog is open. */
  creating: boolean;

  setSection: (section: SectionId) => void;
  /** Adopt whatever the address bar says, after a Back or a pasted link. */
  syncSectionFromHash: () => void;
  select: (gameId: string, channel: string) => void;
  clearSelection: () => void;
  setQuery: (query: string) => void;
  setTab: (tab: GameTabId) => void;
  setLauncherTab: (tab: LauncherTabId) => void;
  setCreating: (creating: boolean) => void;
  /**
   * Re-validate the persisted selection against freshly loaded scopes.
   *
   * Returns the scope it landed on, or null when nothing is selected. Kept as a
   * pure function of `scopes` so the rail and the detail header cannot disagree
   * about what "selected" means.
   */
  reconcile: (scopes: GameScope[]) => GameScope | null;
}

function readStoredGameTab(): GameTabId {
  const stored = readRaw(SESSION_KEYS.tab);
  return isGameTabId(stored) ? stored : 'metadata';
}

function readStoredLauncherTab(): LauncherTabId {
  const stored = readRaw(LAUNCHER_TAB_KEY);
  return isLauncherTabId(stored) ? stored : 'releases';
}

function readStoredKey(): string {
  const gameId = readRaw(SESSION_KEYS.game);
  const channel = readRaw(SESSION_KEYS.channel);
  if (!gameId) return '';
  return scopeKey(gameId, channel || '');
}

export const useSession = create<SessionState>((set, get) => ({
  section: readStoredSection(),
  selectedKey: readStoredKey(),
  query: readRaw(SESSION_KEYS.query) ?? '',
  tab: readStoredGameTab(),
  launcherTab: readStoredLauncherTab(),
  creating: false,

  setSection: (section) => {
    // Guarded rather than trusted: an id that no longer exists must never reach
    // the registry, and 'games' is the one section that is always valid.
    const next = isSectionId(section) ? section : 'games';
    writeRaw(SECTION_KEY, next);
    writeSectionHash(next);
    set({ section: next });
  },

  syncSectionFromHash: () => {
    const named = sectionFromHash(window.location.hash);
    if (!named) {
      // Something else left a hash in the address bar. Put the real one back, so
      // the next copy-and-paste of this URL is a working link.
      writeSectionHash(get().section);
      return;
    }
    if (named === get().section) return;
    writeRaw(SECTION_KEY, named);
    set({ section: named });
  },

  select: (gameId, channel) => {
    const key = scopeKey(gameId, channel);
    writeRaw(SESSION_KEYS.game, gameId);
    writeRaw(SESSION_KEYS.channel, channel);
    // Picking a game is leaving the create dialog, whatever opened it: the two
    // are alternatives and can never be true at once.
    set({ selectedKey: key, creating: false });
  },

  clearSelection: () => {
    removeRaw(SESSION_KEYS.game);
    removeRaw(SESSION_KEYS.channel);
    set({ selectedKey: '', creating: false });
  },

  setQuery: (query) => {
    writeRaw(SESSION_KEYS.query, query);
    set({ query });
  },

  setTab: (tab) => {
    const next = isGameTabId(tab) ? tab : 'metadata';
    writeRaw(SESSION_KEYS.tab, next);
    set({ tab: next });
  },

  setLauncherTab: (tab) => {
    const next = isLauncherTabId(tab) ? tab : 'releases';
    writeRaw(LAUNCHER_TAB_KEY, next);
    set({ launcherTab: next });
  },

  setCreating: (creating) => set({ creating }),

  reconcile: (scopes) => {
    const current = get().selectedKey;
    if (!current) return null;
    const hit = scopes.find((scope) => scope.key === current);
    if (hit) return hit;
    // A game that has been deleted, or a channel that no longer exists. Landing
    // on the empty state is honest; rendering a detail pane for a game that is
    // gone is not.
    const parsed = parseScopeKey(current);
    const byGame = parsed ? scopes.filter((scope) => scope.gameId === parsed.gameId) : [];
    if (byGame.length === 1 && byGame[0]) {
      const only = byGame[0];
      get().select(only.gameId, only.channel);
      return only;
    }
    get().clearSelection();
    return null;
  },
}));

/** The scopes currently visible in the rail, after the search box is applied. */
export function useVisibleScopes(scopes: GameScope[]): GameScope[] {
  const query = useSession((state) => state.query);
  return filterScopes(scopes, query);
}
