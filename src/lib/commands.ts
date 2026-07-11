import { invoke, Channel } from '@tauri-apps/api/core';
import type { GameInstallation, LauncherSettings, GameManifest, DownloadEvent, LaunchResult, VerificationResult } from '@/types';

export const commands = {
  fetchGameManifest: (url: string) =>
    invoke<GameManifest>('fetch_game_manifest', { url }),

  installGame: (manifest: GameManifest, baseUrl: string, onEvent: Channel<DownloadEvent>) =>
    invoke<GameInstallation>('install_game', { manifest, baseUrl, onEvent }),

  checkGameUpdate: (gameId: string, manifest: GameManifest) =>
    invoke<boolean>('check_game_update', { gameId, manifest }),

  launchGame: (gameId: string) =>
    invoke<LaunchResult>('launch_game', { gameId }),

  getInstalledGames: () =>
    invoke<GameInstallation[]>('get_installed_games'),

  getGameInstallation: (gameId: string) =>
    invoke<GameInstallation | null>('get_game_installation', { gameId }),

  verifyGame: (manifest: GameManifest, installPath: string) =>
    invoke<VerificationResult>('verify_game', { manifest, installPath }),

  uninstallGame: (gameId: string) =>
    invoke('uninstall_game', { gameId }),

  getSettings: () =>
    invoke<LauncherSettings>('get_settings'),

  saveSettings: (settings: LauncherSettings) =>
    invoke('save_settings', { newSettings: settings }),

  selectInstallFolder: () =>
    invoke<string | null>('select_install_folder'),

  cancelOperation: () =>
    invoke('cancel_operation'),

  getAppDataDir: () =>
    invoke<string>('get_app_data_dir'),
};
