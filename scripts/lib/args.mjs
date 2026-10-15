/** Command-line argument parsing shared by the publishing scripts. */

/**
 * Parse `--key value` / `--flag` pairs into an object, collecting repeats as arrays.
 *
 * The next token is the value whenever it exists and does not start with `--`.
 * Tested against `undefined` rather than truthiness on purpose: an explicitly
 * empty value (`--title ""`, how the dashboard says "clear this field") is
 * falsy, and reading it as a boolean flag would store the literal string "true".
 */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    // `--key=value` is the same flag as `--key value`.
    const eq = argv[i].indexOf('=');
    const key = eq === -1 ? argv[i].slice(2) : argv[i].slice(2, eq);
    let value;
    if (eq !== -1) {
      value = argv[i].slice(eq + 1);
    } else {
      const next = argv[i + 1];
      value = next !== undefined && !next.startsWith('--') ? argv[++i] : 'true';
    }
    if (key in args) args[key] = [].concat(args[key], value);
    else args[key] = value;
  }
  return args;
}

/**
 * Whether a value would be read as a flag rather than as the value of one. parseArgs
 * takes the next token as a value only when it does not start with `--`, so a name or
 * an id of `--force` becomes an option the caller never chose.
 */
export const isFlagLike = (value) =>
  String(value ?? '')
    .trim()
    .startsWith('--');

export const first = (value) => (Array.isArray(value) ? value[0] : value);

/** Split a comma-separated field into its list values, dropping empty parts. */
export const listValue = (value) =>
  String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
