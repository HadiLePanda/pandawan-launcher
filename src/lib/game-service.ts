import { commands } from './commands';
import { createDownloadChannel } from './download-channel';
import type { GameInstallation, GameManifest, LauncherSettings, LaunchResult } from '@/types';
import { fetchGameManifest } from './catalog-service';
import { resolveGameUrls } from './cdn';

export interface DownloadProgressSnapshot {
  progress: number;
  overallProgress: number;
  speed: string;
  currentFile: string | null;
  completedFiles: number;
  totalFiles: number;
}

export interface PatchCallbacks {
  onProgress: (gameId: string, snapshot: DownloadProgressSnapshot) => void;
  onComplete: (gameId: string) => void;
  onError: (message: string) => void;
}

export interface PatchResult {
  manifest: GameManifest;
  installation: GameInstallation;
}

export async function patchGame(
  gameId: string,
  channel: string,
  callbacks: PatchCallbacks
): Promise<PatchResult> {
  const { manifestUrl, baseUrl } = resolveGameUrls(gameId, channel);
  const manifest = await fetchGameManifest(manifestUrl);
  const downloadChannel = createDownloadChannel(gameId, callbacks);
  const installation = await commands.installGame(manifest, baseUrl, downloadChannel);
  return { manifest, installation };
}

export async function uninstallGame(gameId: string): Promise<void> {
  await commands.uninstallGame(gameId);
}

export async function launchGame(gameId: string): Promise<LaunchResult> {
  const result = await commands.launchGame(gameId);
  if (!result.success) {
    throw new Error(result.message);
  }
  return result;
}

export async function checkForUpdates(gameId: string, channel: string): Promise<boolean> {
  const { manifestUrl } = resolveGameUrls(gameId, channel);
  const manifest = await fetchGameManifest(manifestUrl);
  return commands.checkGameUpdate(gameId, manifest);
}

export async function loadInstalledGames(): Promise<GameInstallation[]> {
  return commands.getInstalledGames();
}

export async function loadSettings(): Promise<LauncherSettings> {
  return commands.getSettings();
}

export async function saveSettings(settings: LauncherSettings): Promise<void> {
  await commands.saveSettings(settings);
}

export async function selectInstallFolder(): Promise<string | null> {
  return commands.selectInstallFolder();
}

export async function cancelOperation(): Promise<void> {
  await commands.cancelOperation();
}
