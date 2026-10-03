/**
 * Generic command-line argument parsing, shared by the publishing scripts.
 *
 * Extracted from metadata-fields.mjs because news publishing needs the same
 * parsing and importing a module called "metadata fields" to get it would be
 * actively misleading. metadata-fields.mjs re-exports these, so existing callers
 * keep working unchanged.
 */

/**
 * Parse `--key value` / `--flag` pairs into an object, collecting repeats as arrays.
 *
 * The next token is taken as the value whenever it exists and does not start with
 * `--`. Tested against `undefined` rather than truthiness on purpose: an explicitly
 * empty value (`--title ""`, which is how the dashboard says "clear this field") is
 * falsy, and reading it as a boolean flag would store the literal string "true" in
 * the document being edited.
 */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    // `--key=value` is the same flag as `--key value`; without this, `--dry-run=1`
    // was stored under the literal key "dry-run=1" and read as false.
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

export const first = (value) => (Array.isArray(value) ? value[0] : value);

/** Split a comma-separated field into its list values, dropping empty parts. */
export const listValue = (value) =>
  String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
