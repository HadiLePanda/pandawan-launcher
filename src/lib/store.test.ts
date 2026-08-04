import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { checkForUpdates as serviceCheckForUpdates, patchGame } from './game-service';
import {
  notifyInstallComplete,
  notifyUpdateAvailable,
  notifyUpdateComplete,
} from './notifications';
import type { Game, GameInfo, GameInstallation, LauncherSettings } from '@/types';

vi.mock('./game-service', () => ({
  checkForUpdates: vi.fn(),
  patchGame: vi.fn(),
}));

vi.mock('./catalog-service', () => ({
  loadCatalog: vi.fn(),
}));

vi.mock('./news-service', () => ({
  loadNews: vi.fn(),
}));

vi.mock('./notifications', () => ({
  notifyInstallComplete: vi.fn(),
  notifyUpdateAvailable: vi.fn(),
  notifyUpdateComplete: vi.fn(),
}));

function makeGameInfo(overrides?: Partial<GameInfo>): GameInfo {
  return {
    id: 'game-1',
    channel: 'stable',
    name: 'Quirheim Online',
    description: '',
    developer: 'Pandawan Corp',
    genre: [],
    iconUrl: '',
    bannerUrl: '',
    screenshots: [],
    version: '1.0.0',
    sizeBytes: 0,
    releaseDate: '2026-01-01',
    ...overrides,
  };
}

function makeGame(overrides?: Partial<Game>): Game {
  return {
    info: makeGameInfo(),
    installation: null,
    status: 'installed',
    hasUpdate: false,
    ...overrides,
  };
}

function makeInstallation(): GameInstallation {
  return {
    game_id: 'game-1',
    installed_version: '1.1.0',
    installed_build: 2,
    install_path: 'C:/games/game-1',
    installed_files: {},
    installed_at: '2026-01-01T00:00:00Z',
    last_played: null,
    total_playtime_seconds: 0,
    executable: 'game.exe',
  };
}

function makeSettings(overrides?: Partial<LauncherSettings>): LauncherSettings {
  return {
    gamesInstallPath: null,
    maxDownloadSpeed: null,
    maxConcurrentDownloads: 4,
    autoUpdateGames: true,
    autoUpdateLauncher: true,
    minimizeToTray: true,
    closeToTray: false,
    language: 'en',
    theme: 'adaptive',
    notifyGameUpdates: true,
    notifyDownloadComplete: true,
    notifyFriendActivity: false,
    notifyNewsEvents: true,
    ...overrides,
  };
}

// Focused coverage for the hasUpdate false -> true notification gating in
// store.ts (setGameHasUpdate / runPatchFlow). The rest of the store is
// intentionally out of scope here.
describe('store update-notification gating', () => {
  let store: typeof import('./store');

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    (patchGame as Mock).mockResolvedValue({ installation: makeInstallation() });
    store = await import('./store');
    store.useLauncherStore.setState({
      games: [makeGame()],
      settings: makeSettings(),
    });
  });

  it('notifies exactly once across repeated detections of the same update', async () => {
    (serviceCheckForUpdates as Mock).mockResolvedValue(true);
    const { checkForUpdates } = store.useLauncherStore.getState();

    expect(await checkForUpdates('game-1', 'stable')).toBe(true);
    expect(await checkForUpdates('game-1', 'stable')).toBe(true);

    expect(notifyUpdateAvailable).toHaveBeenCalledTimes(1);
    expect(notifyUpdateAvailable).toHaveBeenCalledWith('Quirheim Online', true);
  });

  it('does not notify when no update is found', async () => {
    (serviceCheckForUpdates as Mock).mockResolvedValue(false);
    const { checkForUpdates } = store.useLauncherStore.getState();

    expect(await checkForUpdates('game-1', 'stable')).toBe(false);

    expect(notifyUpdateAvailable).not.toHaveBeenCalled();
  });

  it('notifies again when a new update is detected after the game updated', async () => {
    (serviceCheckForUpdates as Mock).mockResolvedValue(true);
    const { checkForUpdates, updateGame } = store.useLauncherStore.getState();

    await checkForUpdates('game-1', 'stable');
    expect(notifyUpdateAvailable).toHaveBeenCalledTimes(1);

    // Applying the update resets hasUpdate to false...
    await updateGame('game-1', 'stable');
    expect(notifyUpdateComplete).toHaveBeenCalledTimes(1);
    expect(notifyUpdateComplete).toHaveBeenCalledWith('Quirheim Online', true);
    expect(store.useLauncherStore.getState().games[0].hasUpdate).toBe(false);

    // ...so a later re-detection is a new transition and notifies again.
    await checkForUpdates('game-1', 'stable');
    expect(notifyUpdateAvailable).toHaveBeenCalledTimes(2);
  });

  it('passes the notifyGameUpdates toggle through to the notification helper', async () => {
    (serviceCheckForUpdates as Mock).mockResolvedValue(true);
    store.useLauncherStore.setState({ settings: makeSettings({ notifyGameUpdates: false }) });
    const { checkForUpdates } = store.useLauncherStore.getState();

    await checkForUpdates('game-1', 'stable');

    expect(notifyUpdateAvailable).toHaveBeenCalledWith('Quirheim Online', false);
  });

  it('passes the notifyDownloadComplete toggle through on install completion', async () => {
    store.useLauncherStore.setState({
      games: [makeGame({ status: 'not_installed' })],
      settings: makeSettings({ notifyDownloadComplete: false }),
    });
    const { installGame } = store.useLauncherStore.getState();

    await installGame('game-1', 'stable');

    expect(notifyInstallComplete).toHaveBeenCalledTimes(1);
    expect(notifyInstallComplete).toHaveBeenCalledWith('Quirheim Online', false);
  });
});
