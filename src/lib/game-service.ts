import { commands } from './commands';
import { Channel } from '@tauri-apps/api/core';
import type { VerifyProgress } from '@/types';
import { createDownloadChannel, type DownloadProgressSnapshot } from './download-channel';
import { unwrapResult } from './errors';
import type {
  GameInstallation,
  GameManifest,
  LauncherSettings,
  LaunchResult,
  VerificationResult,
} from '@/types';
import { resolveManifestForPlatform } from './catalog-service';
import { resolveBaseUrl } from './cdn';
import { detectPlatform, selectPlatformBuild } from './platform';
import type { GameInfo } from '@/types';

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
  const resolved = await resolveManifestForPlatform(gameId, channel);
  if (resolved.status === 'unavailable') {
    throw new Error('No build of ' + gameId + ' is available for this platform.');
  }
  const manifest = resolved.manifest;

  // Narrow the manifest to this machine's build before handing it to the backend.
  // The downloader works from executable/files/base_url, so leaving the raw
  // multi-platform manifest in place would download every platform's files and
  // then try to start whichever executable happened to be at the top level.
  const supported = supportedPlatformsFor(gameId);
  const build = selectPlatformBuild(manifest, detectPlatform(), supported);
  if (!build) {
    throw new Error(
      `No build of "${gameId}" is available for this platform (${detectPlatform() ?? 'unknown'}).`
    );
  }

  // Flat manifests published before the version-stamped layout carry no
  // base_url, so the build resolves to an empty string. The backend turns that
  // into "/" and rejects it as a relative URL, so the channel directory is the
  // only place its files can live.
  const baseUrl = build.baseUrl || resolveBaseUrl(manifest);

  const platformManifest: GameManifest = {
    ...manifest,
    executable: build.executable,
    files: build.files,
    base_url: baseUrl,
    platforms: undefined,
  };

  const downloadChannel = createDownloadChannel(gameId, callbacks);
  const installation = unwrapResult(
    await commands.installGame(platformManifest, baseUrl, downloadChannel)
  );
  return { manifest, installation };
}

/**
 * The catalog's declared platforms for a game, used to decide whether a flat
 * (pre-platform) manifest can run here. Read from the last resolved catalog
 * rather than re-fetched.
 */
let lastSupportedPlatforms: Record<string, string[]> = {};

export function rememberSupportedPlatforms(games: GameInfo[]): void {
  const next: Record<string, string[]> = {};
  for (const game of games) {
    if (game.supportedPlatforms) next[game.id] = game.supportedPlatforms;
  }
  lastSupportedPlatforms = next;
}

function supportedPlatformsFor(gameId: string): string[] | undefined {
  return lastSupportedPlatforms[gameId];
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

export async function closeGame(gameId: string): Promise<void> {
  unwrapResult(await commands.closeGame(gameId));
}

export async function checkForUpdates(gameId: string, channel: string): Promise<boolean> {
  const resolved = await resolveManifestForPlatform(gameId, channel);
  if (resolved.status === 'unavailable') {
    throw new Error('No build of ' + gameId + ' is available for this platform.');
  }
  const manifest = resolved.manifest;
  return unwrapResult(await commands.checkGameUpdate(gameId, manifest));
}

export async function verifyGame(
  gameId: string,
  channel: string,
  onProgress?: (row: VerifyProgress) => void
): Promise<VerificationResult> {
  const installation = unwrapResult(await commands.getGameInstallation(gameId));
  if (!installation) {
    throw new Error('Game is not installed');
  }
  const resolved = await resolveManifestForPlatform(gameId, channel);
  if (resolved.status === 'unavailable') {
    throw new Error('No build of ' + gameId + ' is available for this platform.');
  }
  const manifest = resolved.manifest;

  const channelHandle = new Channel<VerifyProgress>();
  channelHandle.onmessage = (row) => onProgress?.(row);
  return unwrapResult(
    await commands.verifyGame(manifest, installation.install_path, channelHandle)
  );
}

export async function loadInstalledGames(): Promise<GameInstallation[]> {
  return unwrapResult(await commands.getInstalledGames());
}

export async function loadInstallation(gameId: string): Promise<GameInstallation | null> {
  return unwrapResult(await commands.getGameInstallation(gameId));
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
