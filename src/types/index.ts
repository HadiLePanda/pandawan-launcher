export type FileCheck = 'valid' | 'invalid' | 'missing';

export interface VerifyProgress {
  path: string;
  state: FileCheck;
  checked: number;
  total: number;
  valid: number;
  invalid: number;
  missing: number;
}

export interface GameManifest {
  game_id: string;
  name: string;
  version: string;
  build_number: number;
  /** Release channel this build belongs to. `fetchGameManifest` fills in
   * `stable` for pre-channel manifests that omit the field. */
  channel: string;
  description?: string;
  icon_url?: string;
  banner_url?: string;
  executable: string;
  /** Absolute directory the file `url`s are relative to. Present on manifests
   * published with the version-stamped layout; older ones omit it and the client
   * falls back to the flat channel directory. */
  base_url?: string;
  files: FileEntry[];
  launch_args?: string[];

  /**
   * Per-platform builds. Absent on single-platform manifests, which keep the
   * top-level executable/files so older clients still load them.
   *
   * Each platform's files live under its own subdirectory of the version, so
   * Windows and macOS builds of the same version can share a manifest without
   * overwriting each other.
   */
  platforms?: Record<string, PlatformBuild>;
  /** Total across all platforms, when the manifest is multi-platform. */
  size_bytes?: number;
}

/** One platform's slice of a multi-platform manifest. */
export interface PlatformBuild {
  executable: string;
  files: FileEntry[];
  base_url?: string;
  size_bytes?: number;
}

export interface FileEntry {
  path: string;
  hash: string;
  size: number;
  url: string;
  compress?: boolean;
}

export interface GameInstallation {
  game_id: string;
  installed_version: string;
  installed_build: number;
  /** Channel the installed build came from; the backend always records it. */
  channel: string;
  install_path: string;
  installed_files: Record<string, string>;
  installed_at: string;
  last_played: string | null;
  total_playtime_seconds: number;
  executable: string;
}

export type DownloadEvent =
  | {
      event: 'Started';
      data: {
        filePath: string;
        totalSize: number;
        fileIndex: number;
        totalFiles: number;
        /** Whole-build byte totals, present on every event so the bar moves even
         * for files too small to emit a progress update of their own. */
        overallDownloaded?: number;
        overallTotal?: number;
      };
    }
  | {
      event: 'Progress';
      data: {
        filePath: string;
        downloaded: number;
        total: number;
        speedBps: number;
        overallDownloaded?: number;
        overallTotal?: number;
        completedFiles?: number;
        totalFiles?: number;
        currentFile?: string;
      };
    }
  | {
      event: 'FileComplete';
      data: {
        filePath: string;
        completedFiles?: number;
        totalFiles?: number;
        overallDownloaded?: number;
        overallTotal?: number;
      };
    }
  | {
      event: 'Retry';
      data: { filePath: string; attempt: number; maxAttempts: number; error: string };
    }
  | { event: 'Complete'; data: { completedFiles: number; totalFiles: number } }
  | { event: 'Error'; data: { message: string } };

export interface LaunchResult {
  success: boolean;
  message: string;
  processId: number | null;
}

export interface VerificationResult {
  valid_files: number;
  invalid_files: string[];
  missing_files: string[];
  is_valid: boolean;
}

export interface LauncherSettings {
  gamesInstallPath: string | null;
  maxDownloadSpeed: number | null;
  maxConcurrentDownloads: number;
  autoUpdateGames: boolean;
  autoUpdateLauncher: boolean;
  minimizeToTray: boolean;
  closeToTray: boolean;
  /** One-time tray tutorial has been shown; persisted so it never returns. */
  trayHintShown: boolean;
  language: string;
  theme: string;
  notifyGameUpdates: boolean;
  notifyDownloadComplete: boolean;
}

export interface PatchNote {
  version: string;
  date: string;
  notes: string[];
}

export interface NewsItem {
  id: string;
  title: string;
  excerpt: string;
  content?: string;
  date: string;
  imageUrl?: string;
  category?: string;
  gameId?: string;
  url?: string;
}

/** One platform's current build on a channel. Mirrors publish-game.mjs output. */
export interface PlatformVersion {
  version: string;
  build: number;
}

export interface GameInfo {
  id: string;
  channel: string;
  name: string;
  description: string;
  developer: string;
  genre: string[];
  iconUrl: string;
  bannerUrl: string;
  screenshots: string[];
  version: string;
  sizeBytes: number;
  /** False when this game has no build for the platform the launcher runs on. */
  isAvailableOnThisPlatform: boolean;
  releaseDate: string;
  supportedPlatforms?: string[];
  /** Channels the publisher declared as existing. Drives the channel picker. */
  availableChannels?: string[];
  /**
   * What the channel offers per platform, present only when this machine has no
   * build. Feeds the tooltip that explains a greyed card, so it costs no layout.
   */
  availableVersions?: Record<string, PlatformVersion>;
  patchNotes?: PatchNote[];
}

export interface GameCatalog {
  schemaVersion: string;
  games: CatalogGameEntry[];
  lastUpdated: string;
}

export interface CatalogGameEntry {
  id: string;
  channel?: string;
  /**
   * Channels this game is actually published to. The picker only offers these,
   * so choosing "Release" for a game that has only ever shipped an alpha does
   * not send the user to a 404 manifest.
   *
   * Declared by the publisher rather than probed: whether a channel exists is
   * known at publish time, and probing costs a request per channel per game on
   * every page open. When omitted, the launcher falls back to offering the
   * catalog's own channel only - safe, since that is known to exist.
   */
  availableChannels?: string[];
  name?: string;
  description?: string;
  developer?: string;
  genre?: string[];
  iconUrl?: string;
  bannerUrl?: string;
  screenshots?: string[];
  supportedPlatforms?: string[];
}

export type GameStatus = 'not_installed' | 'installed' | 'updating' | 'downloading' | 'running';

export interface Game {
  info: GameInfo;
  installation: GameInstallation | null;
  status: GameStatus;
  hasUpdate: boolean;
}
