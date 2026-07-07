export interface GameManifest {
  game_id: string;
  name: string;
  version: string;
  build_number: number;
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
  install_path: string;
  installed_files: Record<string, string>;
  installed_at: string;
  last_played: string | null;
  total_playtime_seconds: number;
}

export type DownloadEvent =
  | { event: 'started'; data: { filePath: string; totalSize: number } }
  | { event: 'progress'; data: { filePath: string; downloaded: number; total: number; speedBps: number } }
  | { event: 'fileComplete'; data: { filePath: string } }
  | { event: 'complete' }
  | { event: 'error'; data: { message: string } };

export type PatchState = 'idle' | 'checking' | 'downloading' | 'verifying' | 'installing' | 'complete' | 'error';

export interface PatchProgress {
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  downloadedBytes: number;
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
}

export interface GameInfo {
  id: string;
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
  manifestUrl: string;
  colorTheme?: {
    accent: string;
    accentHover: string;
    accentMuted: string;
  };
}

export interface DownloadProgress {
  gameId: string;
  isDownloading: boolean;
  progress: number; // 0-100
  speed: string;
  downloadedBytes: number;
  totalBytes: number;
  currentFile: string | null;
}

export type GameStatus = 
  | 'not_installed'
  | 'installed'
  | 'updating'
  | 'downloading'
  | 'repairing'
  | 'running';

export interface Game {
  info: GameInfo;
  installation: GameInstallation | null;
  status: GameStatus;
  hasUpdate: boolean;
}
