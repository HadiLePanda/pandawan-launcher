import { commands } from './commands';
import { createDownloadChannel, type DownloadProgressSnapshot } from './download-channel';
import { unwrapResult } from './errors';
import type {
  GameInstallation,
  GameManifest,
  LauncherSettings,
  LaunchResult,
  VerificationResult,
} from '@/types';
import { fetchGameManifest } from './catalog-service';
import { resolveGameUrls } from './cdn';

export type { DownloadProgressSnapshot } from './download-channel';

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
  const installation = unwrapResult(await commands.installGame(manifest, baseUrl, downloadChannel));
  return { manifest, installation };
}

export async function uninstallGame(gameId: string): Promise<void> {
  unwrapResult(await commands.uninstallGame(gameId));
}

export async function launchGame(gameId: string): Promise<LaunchResult> {
  const result = unwrapResult(await commands.launchGame(gameId));
  if (!result.success) {
    throw new Error(result.message);
  }
  return result;
}

export async function checkForUpdates(gameId: string, channel: string): Promise<boolean> {
  const { manifestUrl } = resolveGameUrls(gameId, channel);
  const manifest = await fetchGameManifest(manifestUrl);
  return unwrapResult(await commands.checkGameUpdate(gameId, manifest));
}

export async function verifyGame(gameId: string, channel: string): Promise<VerificationResult> {
  const installation = unwrapResult(await commands.getGameInstallation(gameId));
  if (!installation) {
    throw new Error('Game is not installed');
  }
  const { manifestUrl } = resolveGameUrls(gameId, channel);
  const manifest = await fetchGameManifest(manifestUrl);
  return unwrapResult(await commands.verifyGame(manifest, installation.install_path));
}

export async function loadInstalledGames(): Promise<GameInstallation[]> {
  return unwrapResult(await commands.getInstalledGames());
}

export async function loadSettings(): Promise<LauncherSettings> {
  return unwrapResult(await commands.getSettings());
}

export async function saveSettings(settings: LauncherSettings): Promise<void> {
  unwrapResult(await commands.saveSettings(settings));
}

export async function selectInstallFolder(): Promise<string | null> {
  return unwrapResult(await commands.selectInstallFolder());
}

export async function cancelOperation(): Promise<void> {
  unwrapResult(await commands.cancelOperation());
}
