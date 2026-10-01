import i18n from './i18n';
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
        return i18n.t('errors.notInstalled');
      case 'AlreadyRunning':
        return i18n.t('errors.alreadyRunning');
      case 'NotRunning':
        // Benign race: the game exited on its own between the click and the
        // command arriving. Not worth an error toast.
        return i18n.t('errors.notRunning');
      case 'ExecutableNotFound':
        return i18n.t('errors.executableNotFound', {
          path: (error.details as { path: string }).path,
        });
      case 'PathNotAllowed':
        return i18n.t('errors.pathNotAllowed', {
          path: (error.details as { path: string }).path,
        });
      case 'Network':
        return i18n.t('errors.network', { details: error.details as string });
      case 'ManifestParse':
        return i18n.t('errors.manifestParse', { details: error.details as string });
      case 'Validation':
        return i18n.t('errors.validation', { details: error.details as string });
      case 'Io':
        return i18n.t('errors.io', { details: error.details as string });
      case 'Other':
        return (error.details as string) ?? i18n.t('errors.unknown');
      default:
        return i18n.t('errors.unknown');
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
