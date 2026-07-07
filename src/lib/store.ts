import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Game, GameInfo, GameInstallation, LauncherSettings, DownloadEvent, GameManifest } from '@/types';

interface LauncherState {
  // Games
  games: Game[];
  selectedGameId: string | null;
  isLoading: boolean;
  error: string | null;
  
  // Downloads
  activeDownloads: Map<string, { progress: number; speed: string; currentFile: string | null }>;
  
  // Settings
  settings: LauncherSettings | null;
  
  // Actions
  setGames: (games: Game[]) => void;
  selectGame: (gameId: string | null) => void;
  addGame: (gameInfo: GameInfo) => void;
  updateGameStatus: (gameId: string, status: Game['status'], installation?: GameInstallation) => void;
  setDownloadProgress: (gameId: string, progress: number, speed: string, currentFile: string | null) => void;
  removeDownload: (gameId: string) => void;
  setSettings: (settings: LauncherSettings) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  
  // Async actions
  loadGames: () => Promise<void>;
  loadSettings: () => Promise<void>;
  installGame: (gameId: string, manifestUrl: string, baseUrl: string) => Promise<void>;
  launchGame: (gameId: string) => Promise<void>;
  uninstallGame: (gameId: string) => Promise<void>;
  checkForUpdates: (gameId: string, manifestUrl: string) => Promise<boolean>;
}

export const useLauncherStore = create<LauncherState>((set, get) => ({
  games: [],
  selectedGameId: null,
  isLoading: false,
  error: null,
  activeDownloads: new Map(),
  settings: null,

  setGames: (games) => set({ games }),
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
        g.info.id === gameId
          ? { ...g, status, installation: installation || g.installation }
          : g
      ),
    }));
  },
  
  setDownloadProgress: (gameId, progress, speed, currentFile) => {
    set((state) => {
      const newDownloads = new Map(state.activeDownloads);
      newDownloads.set(gameId, { progress, speed, currentFile });
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
  
  setSettings: async (settings) => {
    try {
      await invoke('save_settings', { newSettings: settings });
      set({ settings });
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  },
  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),

  loadSettings: async () => {
    try {
      const settings = await invoke<LauncherSettings>('get_settings');
      set({ settings });
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  },

  loadGames: async () => {
    set({ isLoading: true, error: null });
    try {
      const installations = await invoke<GameInstallation[]>('get_installed_games');
      
      // Merge installations with known games
      set((state) => {
        const gamesWithInstalls = state.games.map((game) => {
          const installation = installations.find((i) => i.game_id === game.info.id);
          return {
            ...game,
            installation: installation || null,
            status: (installation ? 'installed' : 'not_installed') as Game['status'],
          };
        });
        
        // Add installed games not in the list
        const existingIds = new Set(gamesWithInstalls.map((g) => g.info.id));
        const newGames: Game[] = installations
          .filter((i) => !existingIds.has(i.game_id))
          .map((i) => ({
            info: {
              id: i.game_id,
              name: i.game_id, // Will be updated from manifest
              description: '',
              developer: 'Pandawan Corp',
              genre: [],
              iconUrl: '',
              bannerUrl: '',
              screenshots: [],
              version: i.installed_version,
              sizeBytes: 0,
              releaseDate: i.installed_at,
              manifestUrl: '',
            },
            installation: i,
            status: 'installed' as const,
            hasUpdate: false,
          }));
        
        return { games: [...gamesWithInstalls, ...newGames], isLoading: false };
      });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  installGame: async (gameId: string, manifestUrl: string, baseUrl: string) => {
    const { updateGameStatus, setDownloadProgress, removeDownload } = get();
    
    updateGameStatus(gameId, 'downloading');
    
    try {
      // Fetch manifest
      const manifest = await invoke<GameManifest>('fetch_game_manifest', { url: manifestUrl });
      
      // Create channel for download progress
      const { Channel } = await import('@tauri-apps/api/core');
      const channel = new Channel<DownloadEvent>();
      
      let totalBytes = 0;
      let downloadedBytes = 0;
      
      channel.onmessage = (message) => {
        switch (message.event) {
          case 'started':
            totalBytes = message.data.totalSize;
            break;
          case 'progress':
            downloadedBytes = message.data.downloaded;
            const progress = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
            const speed = `${(message.data.speedBps / 1024 / 1024).toFixed(1)} MB/s`;
            setDownloadProgress(gameId, progress, speed, message.data.filePath);
            break;
          case 'complete':
            removeDownload(gameId);
            break;
          case 'error':
            console.error('Download error:', message.data.message);
            break;
        }
      };
      
      // Start installation
      const installation = await invoke<GameInstallation>('install_game', {
        manifest,
        baseUrl,
        onEvent: channel,
      });
      
      updateGameStatus(gameId, 'installed', installation);
      
      // Update game info from manifest
      set((state) => ({
        games: state.games.map((g) =>
          g.info.id === gameId
            ? {
                ...g,
                info: {
                  ...g.info,
                  name: manifest.name,
                  description: manifest.description || g.info.description,
                  version: manifest.version,
                },
              }
            : g
        ),
      }));
    } catch (err) {
      console.error('Installation failed:', err);
      updateGameStatus(gameId, 'not_installed');
      set({ error: String(err) });
    }
  },

  launchGame: async (gameId: string) => {
    const { updateGameStatus } = get();
    
    try {
      updateGameStatus(gameId, 'running');
      
      const result = await invoke<LaunchResult>('launch_game', { gameId });
      
      if (!result.success) {
        updateGameStatus(gameId, 'installed');
        set({ error: result.message });
      } else {
        // Game launched, will be marked as not running when process exits
        setTimeout(() => {
          updateGameStatus(gameId, 'installed');
        }, 5000);
      }
    } catch (err) {
      updateGameStatus(gameId, 'installed');
      set({ error: String(err) });
    }
  },

  uninstallGame: async (gameId: string) => {
    const { updateGameStatus } = get();
    
    try {
      await invoke('uninstall_game', { gameId });
      updateGameStatus(gameId, 'not_installed', undefined);
    } catch (err) {
      set({ error: String(err) });
    }
  },

  checkForUpdates: async (gameId: string, manifestUrl: string) => {
    try {
      const manifest = await invoke<GameManifest>('fetch_game_manifest', { url: manifestUrl });
      const hasUpdate = await invoke<boolean>('check_game_update', { gameId, manifest });
      
      set((state) => ({
        games: state.games.map((g) =>
          g.info.id === gameId ? { ...g, hasUpdate } : g
        ),
      }));
      
      return hasUpdate;
    } catch (err) {
      console.error('Failed to check for updates:', err);
      return false;
    }
  },
}));

interface LaunchResult {
  success: boolean;
  message: string;
  processId: number | null;
}
