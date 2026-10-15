/**
 * The argument list the build publish runs, from the form's fields.
 *
 * The form must not pass through a flag the UI never offers, and it cannot be trusted
 * to know that: while it built the array itself, a version typed as `--dry-run`
 * arrived as an option. Every value travels as `--flag=value`, and a value that would
 * be read as a flag is refused.
 */

import { isFlagLike } from './args.mjs';

/** The flags publish-game.mjs takes a value for, and the field carrying it. */
const VALUE_FLAGS = [
  ['game-id', 'gameId'],
  ['channel', 'channel'],
  ['version', 'version'],
  ['build-number', 'buildNumber'],
  ['executable', 'executable'],
  ['input-dir', 'inputDir'],
];

/**
 * Build the argument list, or say what is wrong with the request.
 *
 * @returns {{argv: string[]} | {error: string}}
 */
export function buildPublishArgv(payload) {
  const argv = [];

  for (const [flag, field] of VALUE_FLAGS) {
    const value = String(payload?.[field] ?? '').trim();
    // Left out rather than sent empty: publish-game.mjs names what it needs.
    if (!value) continue;
    if (isFlagLike(value)) return { error: `${field} must be a value, not a flag` };
    argv.push(`--${flag}=${value}`);
  }

  const dirs = payload?.platforms;
  if (dirs && typeof dirs === 'object') {
    for (const [platform, rawDir] of Object.entries(dirs)) {
      const dir = String(rawDir ?? '').trim();
      if (!dir) continue;
      if (isFlagLike(platform) || isFlagLike(dir)) {
        return { error: `${platform} must be a value, not a flag` };
      }
      argv.push(`--platform=${platform}=${dir}`);
    }
  }

  if (payload?.dryRun) argv.push('--dry-run');

  return { argv };
}
