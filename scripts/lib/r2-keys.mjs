/** Bucket keys for the launcher's mutable control documents. */

export const LAUNCHER_PREFIX = 'launcher';
export const CATALOG_KEY = `${LAUNCHER_PREFIX}/catalog.json`;
export const DOWNLOADS_KEY = `${LAUNCHER_PREFIX}/downloads.json`;
export const LATEST_KEY = `${LAUNCHER_PREFIX}/latest.json`;

/** The public URL of a bucket key. */
export const cdnUrl = (origin, key) => `${origin}/${key}`;
