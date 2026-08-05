import { create } from 'zustand';
import type { Game, GameInstallation, GameInfo, LauncherSettings, NewsItem } from '@/types';
import * as catalogService from './catalog-service';
import * as newsService from './news-service';
import * as gameService from './game-service';
import { logger } from './logger';
import i18n from './i18n';
import {
  notifyInstallComplete,
  notifyUpdateAvailable,
  notifyUpdateComplete,
} from './notifications';
import type { DownloadProgressSnapshot } from './download-channel';
import { CommandError } from './errors';
import { emptyFilters, type GameFilters } from './game-filters';

export interface LauncherNotification {
  id: string;
  title: string;
  body: string;
  date: string;
  read: boolean;
}

type SetState = (fn: (state: LauncherState) => Partial<LauncherState>) => void;

type GetState = () => LauncherState;

interface LauncherState {
  games: Game[];
  news: NewsItem[];
  selectedGameId: string | null;
  isLoading: boolean;
  error: string | null;
  activeDownloads: Map<string, DownloadProgressSnapshot>;
  settings: LauncherSettings | null;
  catalogSource: 'remote' | 'local' | 'embedded' | null;
  catalogUnreachable: boolean;
  gameFilters: GameFilters;
  notifications: LauncherNotification[];

  // Actions
  setGames: (games: Game[]) => void;
  pushNotification: (notification: Omit<LauncherNotification, 'id' | 'date' | 'read'>) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
  selectGame: (gameId: string | null) => void;
  addGame: (gameInfo: GameInfo) => void;
  updateGameStatus: (
    gameId: string,
    status: Game['status'],
    installation?: GameInstallation
  ) => void;
  setDownloadProgress: (gameId: string, snapshot: DownloadProgressSnapshot) => void;
  removeDownload: (gameId: string) => void;
  setSettings: (settings: LauncherSettings) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  setGameFilters: (partial: Partial<GameFilters>) => void;

  // Async actions
  loadCatalog: () => Promise<void>;
  loadNews: () => Promise<void>;
  loadGames: () => Promise<void>;
  loadSettings: () => Promise<void>;
  installGame: (gameId: string, channel: string) => Promise<void>;
  updateGame: (gameId: string, channel: string) => Promise<void>;
  launchGame: (gameId: string) => Promise<void>;
  uninstallGame: (gameId: string) => Promise<void>;
  checkForUpdates: (gameId: string, channel: string) => Promise<boolean>;
  refreshUpdateStatus: () => Promise<void>;
  refreshInstallation: (gameId: string) => Promise<void>;
  cancelOperation: () => Promise<void>;
}

export const useLauncherStore = create<LauncherState>((set, get) => ({
  games: [],
  news: [],
  selectedGameId: null,
  isLoading: false,
  error: null,
  activeDownloads: new Map(),
  settings: null,
  catalogSource: null,
  catalogUnreachable: false,
  gameFilters: emptyFilters,
  notifications: [],

  setGames: (games) => set({ games }),

  pushNotification: (notification) =>
    set((state) => ({
      notifications: [
        { ...notification, id: crypto.randomUUID(), date: new Date().toISOString(), read: false },
        ...state.notifications,
      ],
    })),

  markAllNotificationsRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => (n.read ? n : { ...n, read: true })),
    })),

  clearNotifications: () => set({ notifications: [] }),
  selectGame: (gameId) => set({ selectedGameId: gameId }),

  addGame: (gameInfo) => {
    const game: Game = {
      info: gameInfo,
      installation: null,
      status: 'not_installed',
      hasUpdate: false,
    };
    set((state) => ({ games: [...state.games, game] }));
  },

  updateGameStatus: (gameId, status, installation) => {
    set((state) => ({
      games: state.games.map((g) =>
        g.info.id === gameId ? { ...g, status, installation: installation ?? g.installation } : g
      ),
    }));
  },

  setDownloadProgress: (gameId, snapshot) => {
    set((state) => {
      const newDownloads = new Map(state.activeDownloads);
      newDownloads.set(gameId, snapshot);
      return { activeDownloads: newDownloads };
    });
  },

  removeDownload: (gameId) => {
    set((state) => {
      const newDownloads = new Map(state.activeDownloads);
      newDownloads.delete(gameId);
      return { activeDownloads: newDownloads };
    });
  },

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  setGameFilters: (partial) =>
    set((state) => ({ gameFilters: { ...state.gameFilters, ...partial } })),

  setSettings: async (settings) => {
    try {
      await gameService.saveSettings(settings);
      set({ settings, error: null });
    } catch (err) {
      handleStoreError(err, set, 'setSettings');
    }
  },

  loadSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const settings = await gameService.loadSettings();
      set({ settings, isLoading: false });
    } catch (err) {
      handleStoreError(err, set, 'loadSettings');
      set({ isLoading: false });
    }
  },

  loadCatalog: async () => {
    set({ isLoading: true, error: null, catalogSource: null, catalogUnreachable: false });
    try {
      const { games, source, unreachable } = await catalogService.loadCatalog();
      const gamesState: Game[] = games.map((gameInfo) => ({
        info: gameInfo,
        installation: null,
        status: 'not_installed',
        hasUpdate: false,
      }));
      set({
        games: gamesState,
        isLoading: false,
        catalogSource: source,
        catalogUnreachable: !!unreachable,
      });
    } catch (err) {
      handleStoreError(err, set, 'loadCatalog');
      set({ isLoading: false, catalogSource: null, catalogUnreachable: true });
    }
  },

  loadNews: async () => {
    try {
      const news = await newsService.loadNews();
      set({ news });
    } catch (err) {
      logger.warn('Failed to load news', { error: String(err) });
    }
  },

  loadGames: async () => {
    set({ isLoading: true, error: null });
    try {
      const installations = await gameService.loadInstalledGames();
      set((state) => ({ games: mergeInstallations(state.games, installations), isLoading: false }));
      // Missing settings (not loaded yet) are treated as enabled, matching the
      // DEFAULT_SETTINGS in Settings.tsx where autoUpdateGames defaults to true.
      if (get().settings?.autoUpdateGames ?? true) {
        await get().refreshUpdateStatus();
      }
    } catch (err) {
      handleStoreError(err, set, 'loadGames');
      set({ isLoading: false });
    }
  },

  installGame: async (gameId, channel) => {
    await runPatchFlow(get, set, gameId, channel, 'downloading');
  },

  updateGame: async (gameId, channel) => {
    await runPatchFlow(get, set, gameId, channel, 'updating');
  },

  launchGame: async (gameId) => {
    const { updateGameStatus } = get();
    try {
      updateGameStatus(gameId, 'running');
      await gameService.launchGame(gameId);
    } catch (err) {
      updateGameStatus(gameId, 'installed');
      handleStoreError(err, set, 'launchGame');
    }
  },

  uninstallGame: async (gameId) => {
    const { updateGameStatus } = get();
    try {
      await gameService.uninstallGame(gameId);
      updateGameStatus(gameId, 'not_installed', undefined);
    } catch (err) {
      handleStoreError(err, set, 'uninstallGame');
    }
  },

  checkForUpdates: async (gameId, channel) => {
    try {
      const hasUpdate = await gameService.checkForUpdates(gameId, channel);
      setGameHasUpdate(get, set, gameId, hasUpdate);
      return hasUpdate;
    } catch (err) {
      handleStoreError(err, set, 'checkForUpdates');
      return false;
    }
  },

  refreshUpdateStatus: async () => {
    const { games } = get();
    await Promise.all(
      games.map(async (g) => {
        if (g.status !== 'installed') return;
        try {
          const hasUpdate = await gameService.checkForUpdates(g.info.id, g.info.channel);
          setGameHasUpdate(get, set, g.info.id, hasUpdate);
        } catch (err) {
          logger.warn('Update check failed', { gameId: g.info.id, error: String(err) });
        }
      })
    );
  },

  cancelOperation: async () => {
    try {
      await gameService.cancelOperation();
    } catch (err) {
      handleStoreError(err, set, 'cancelOperation');
    }
  },

  // Re-fetches one installation record (playtime/last played). Used after a
  // game exits. Failures keep the cached record; they only stale the display.
  refreshInstallation: async (gameId) => {
    try {
      const installation = await gameService.loadInstallation(gameId);
      if (!installation) return;
      set((state) => ({
        games: state.games.map((g) => (g.info.id === gameId ? { ...g, installation } : g)),
      }));
    } catch (err) {
      logger.warn('Failed to refresh installation', { gameId, error: String(err) });
    }
  },
}));

// Private helpers

function handleStoreError(
  error: unknown,
  set:
    | ((partial: Partial<LauncherState>) => void)
    | ((fn: (state: LauncherState) => Partial<LauncherState>) => void),
  context: string
): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof CommandError ? error.code : 'unknown';
  logger.error(`Store action failed: ${context}`, { code, error: message });
  (set as (partial: Partial<LauncherState>) => void)({ error: message });
  return message;
}

function mergeInstallations(games: Game[], installations: GameInstallation[]): Game[] {
  const gamesWithInstalls = games.map((game) => {
    const installation = installations.find((i) => i.game_id === game.info.id);
    return {
      ...game,
      installation: installation || null,
      status: (installation ? 'installed' : 'not_installed') as Game['status'],
      hasUpdate: false,
    };
  });

  const existingIds = new Set(gamesWithInstalls.map((g) => g.info.id));
  const newGames: Game[] = installations
    .filter((i) => !existingIds.has(i.game_id))
    .map((i) => ({
      info: {
        id: i.game_id,
        channel: 'stable',
        name: i.game_id,
        description: '',
        developer: 'Pandawan Corp',
        genre: [],
        iconUrl: '',
        bannerUrl: '',
        screenshots: [],
        version: i.installed_version,
        sizeBytes: 0,
        releaseDate: i.installed_at,
      },
      installation: i,
      status: 'installed' as const,
      hasUpdate: false,
    }));

  return [...gamesWithInstalls, ...newGames];
}

async function runPatchFlow(
  get: GetState,
  set: SetState,
  gameId: string,
  channel: string,
  activeStatus: 'downloading' | 'updating'
) {
  const { updateGameStatus, setDownloadProgress, removeDownload } = get();
  updateGameStatus(gameId, activeStatus);

  try {
    const { installation } = await gameService.patchGame(gameId, channel, {
      onProgress: (id, snapshot) => setDownloadProgress(id, snapshot),
      onComplete: (id) => removeDownload(id),
      onError: (message) => set((state) => ({ ...state, error: message })),
    });

    updateGameStatus(gameId, 'installed', installation);
    set((state) => ({
      games: state.games.map((g) =>
        g.info.id === gameId
          ? { ...g, hasUpdate: activeStatus === 'updating' ? false : g.hasUpdate }
          : g
      ),
    }));

    const gameName = get().games.find((g) => g.info.id === gameId)?.info.name ?? gameId;
    // Missing settings (not loaded yet) are treated as enabled, matching the
    // DEFAULT_SETTINGS in Settings.tsx where these toggles default to true.
    const downloadNotify = get().settings?.notifyDownloadComplete ?? true;
    if (activeStatus === 'updating') {
      void notifyUpdateComplete(gameName, downloadNotify);
      get().pushNotification({
        title: gameName,
        body: i18n.t('notifications.updateComplete'),
      });
    } else {
      void notifyInstallComplete(gameName, downloadNotify);
      get().pushNotification({
        title: gameName,
        body: i18n.t('notifications.installComplete'),
      });
    }
  } catch (err) {
    const fallbackStatus = activeStatus === 'downloading' ? 'not_installed' : 'installed';
    updateGameStatus(gameId, fallbackStatus);
    handleStoreError(err, set, `runPatchFlow:${activeStatus}`);
  }
}

// Sets the hasUpdate flag and notifies when an update is newly detected
// (false -> true transition only, to avoid repeat notifications on refresh).
function setGameHasUpdate(get: GetState, set: SetState, gameId: string, hasUpdate: boolean) {
  const previous = get().games.find((g) => g.info.id === gameId);
  set((state) => ({
    games: state.games.map((g) => (g.info.id === gameId ? { ...g, hasUpdate } : g)),
  }));
  if (hasUpdate && previous && !previous.hasUpdate) {
    const enabled = get().settings?.notifyGameUpdates ?? true;
    void notifyUpdateAvailable(previous.info.name, enabled);
    get().pushNotification({
      title: previous.info.name,
      body: i18n.t('notifications.updateAvailable'),
    });
  }
}
