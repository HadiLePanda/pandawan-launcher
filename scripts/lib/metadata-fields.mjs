/**
 * The metadata contract: which fields a game has, and where each one is stored.
 *
 * Kept free of any dependency - not even the R2 config - because three separate
 * places need it: the publisher that writes these fields, the dashboard that
 * offers them as a form, and the tests that check the two agree. A field defined
 * once here cannot drift between the form and the script that applies it, and
 * this module stays importable from a test runner without dragging in the
 * publishing machinery.
 */

/** The channels the launcher knows. Mirrors KNOWN_CHANNELS in the frontend. */
export const CHANNELS = ['stable', 'beta', 'alpha'];

/**
 * Every editable field, and where it lands.
 *
 * `catalog` fields are presentation overrides the launcher prefers over the
 * manifest, so they win even for an older build. `manifest` fields are what a
 * client sees when it resolves a build directly, without the catalog. `list`
 * marks a field stored as an array and edited as a comma-separated string.
 */
export const FIELDS = [
  { flag: 'name', catalog: 'name', manifest: 'name', label: 'Display name' },
  {
    flag: 'description',
    catalog: 'description',
    manifest: 'description',
    label: 'Description',
  },
  { flag: 'developer', catalog: 'developer', manifest: null, label: 'Developer' },
  { flag: 'genre', catalog: 'genre', manifest: null, label: 'Genres', list: true },
  { flag: 'icon-url', catalog: 'iconUrl', manifest: 'icon_url', label: 'Icon URL' },
  { flag: 'banner-url', catalog: 'bannerUrl', manifest: 'banner_url', label: 'Banner URL' },
  { flag: 'screenshots', catalog: 'screenshots', manifest: null, label: 'Screenshots', list: true },
  {
    flag: 'supported-platforms',
    catalog: 'supportedPlatforms',
    manifest: null,
    label: 'Platforms',
    list: true,
  },
  {
    flag: 'available-channels',
    catalog: 'availableChannels',
    manifest: null,
    label: 'Available channels',
    list: true,
  },
];

/** The fields the dashboard offers a file picker for, keyed by their flag. */
export const IMAGE_FIELDS = {
  'icon-url': { flag: 'icon-file', objectName: 'icon.png' },
  'banner-url': { flag: 'banner-file', objectName: 'banner.png' },
};

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
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
