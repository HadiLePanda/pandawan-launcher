/**
 * The argument list the build publish runs, assembled from the form's fields.
 *
 * Pure and unit-tested because the rule is the whole point: the form must not pass
 * through a flag the UI never offers. Forwarding a client-built array put the two
 * halves of that rule in different files - the form decided what an argument was,
 * and this server could not tell a value from an option - so a version typed as
 * `--dry-run` became an option. Every value now travels as `--flag=value`, and a
 * value that would be read as a flag is refused instead.
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
    // An empty field is left out rather than sent empty: publish-game.mjs names
    // what it needs, which is a better message than one invented here.
    if (!value) continue;
    if (isFlagLike(value)) return { error: `${field} must be a value, not a flag` };
    argv.push(`--${flag}=${value}`);
  }

  // Each platform carries its own directory. publish-game.mjs validates the name
  // against the platforms it knows, so an unknown one is refused there.
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

  // Bare, because it takes no value.
  if (payload?.dryRun) argv.push('--dry-run');

  return { argv };
}
