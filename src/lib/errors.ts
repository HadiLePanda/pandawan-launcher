import type { LauncherError } from './bindings';

/**
 * Error thrown when a Tauri command returns a structured `LauncherError`.
 *
 * This keeps the frontend code decoupled from Tauri Specta's result wrapper
 * shape while still exposing the typed error code/details to callers.
 */
export class CommandError extends Error {
  public readonly code: LauncherError['code'];
  public readonly details: unknown;

  constructor(public readonly launcherError: LauncherError) {
    super(CommandError.messageFor(launcherError));
    this.code = launcherError.code;
    this.details = 'details' in launcherError ? launcherError.details : undefined;
    this.name = 'CommandError';
  }

  private static messageFor(error: LauncherError): string {
    switch (error.code) {
      case 'NotInstalled':
        return 'Game is not installed.';
      case 'AlreadyRunning':
        return 'Game is already running.';
      case 'ExecutableNotFound':
        return `Executable not found: ${(error.details as { path: string }).path}`;
      case 'PathNotAllowed':
        return `Path is outside the allowed install directory: ${(error.details as { path: string }).path}`;
      case 'Network':
        return `Network error: ${error.details as string}`;
      case 'ManifestParse':
        return `Failed to parse manifest: ${error.details as string}`;
      case 'Validation':
        return `Invalid settings: ${error.details as string}`;
      case 'Io':
        return `I/O error: ${error.details as string}`;
      case 'Other':
        return (error.details as string) ?? 'Unknown launcher error';
      default:
        return 'Unknown launcher error';
    }
  }
}

/**
 * Narrow a Tauri Specta result union to its ok value, throwing a typed
 * `CommandError` when the backend returns an error.
 */
export function unwrapResult<T>(
  result: { status: 'ok'; data: T } | { status: 'error'; error: LauncherError }
): T {
  if (result.status === 'error') {
    throw new CommandError(result.error);
  }
  return result.data;
}
