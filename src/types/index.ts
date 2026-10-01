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
  files: FileEntry[];
  launch_args?: string[];
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
      event: 'started';
      data: { filePath: string; totalSize: number; fileIndex: number; totalFiles: number };
    }
  | {
      event: 'progress';
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
      event: 'fileComplete';
      data: { filePath: string; completedFiles?: number; totalFiles?: number };
    }
  | {
      event: 'retry';
      data: { filePath: string; attempt: number; maxAttempts: number; error: string };
    }
  | { event: 'complete'; data: { completedFiles: number; totalFiles: number } }
  | { event: 'error'; data: { message: string } };

export type PatchState =
  'idle' | 'checking' | 'downloading' | 'verifying' | 'installing' | 'complete' | 'error';

export interface PatchProgress {
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  downloadedBytes: number;
  currentFile: string | null;
}

export interface DownloadProgress {
  gameId: string;
  isDownloading: boolean;
  progress: number;
  overallProgress: number;
  speed: string;
  downloadedBytes: number;
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
  currentFile: string | null;
}

export interface PatchStatus {
  gameId: string;
  currentVersion: string;
  targetVersion: string;
  status: PatchState;
  progress: PatchProgress;
}

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
  releaseDate: string;
  supportedPlatforms?: string[];
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
