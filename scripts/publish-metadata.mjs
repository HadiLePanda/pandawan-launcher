#!/usr/bin/env node
/**
 * Edit a game's display metadata without republishing its build.
 *
 * A game's presentation lives in two documents - the catalog and the manifest -
 * and the launcher reads both; the field contract is shared in
 * scripts/lib/metadata-fields.mjs. publish-game.mjs is a build publisher that
 * regenerates the manifest from an input directory and re-uploads every file, so
 * a one-word typo fix would mean re-sending a build. This script instead reads
 * what is on the bucket, changes only the fields it was asked to change, and
 * writes the documents back - the file list, hashes, sizes and version are
 * copied through because they describe bytes that are not changing.
 *
 *   npm run publish:meta -- --game-id misspell --channel alpha \
 *     --name "Misspell" --genre "Multiplayer,Party" --icon-file ./art/icon.png
 *
 * Fields left unset keep their published value, so a partial edit never blanks a
 * field nobody touched. The icon and banner can be a local file to upload
 * (--icon-file) or an already-hosted URL (--icon-url).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fail, IMMUTABLE, NO_CACHE, repoRoot, r2Config, run, S3, upload } from './lib/r2.mjs';

import {
  CHANNELS,
  FIELDS,
  IMAGE_FIELDS,
  first,
  listValue,
  parseArgs,
} from './lib/metadata-fields.mjs';
import { applyMetadataChanges } from './lib/apply-metadata.mjs';
import { artworkObjectName } from './lib/artwork.mjs';
import { fetchJson } from './lib/game-metadata.mjs';

/** Apply the requested metadata edits. Streams its own progress to stdout. */
export async function publishMetadata(argv) {
  const args = parseArgs(argv);

  for (const name of ['game-id', 'channel']) {
    if (!first(args[name])) fail(`--${name} is required.`);
  }

  const gameId = String(first(args['game-id'])).trim();
  const channel = String(first(args.channel)).trim();
  const dryRun = Boolean(args['dry-run']);

  // The channel decides the manifest URL, so a typo reads the wrong document or
  // none at all. These three are the only ones the launcher knows.
  if (!CHANNELS.includes(channel)) {
    fail(`--channel must be one of ${CHANNELS.join(', ')} (got "${channel}").`);
  }

  const { bucket, cdnOrigin, endpoint } = r2Config();
  const prefix = `games/${gameId}/${channel}`;
  const manifestUrl = `${cdnOrigin}/${prefix}/manifest.json`;
  const catalogUrl = `${cdnOrigin}/launcher/catalog.json`;

  console.log(`Game:    ${gameId}`);
  console.log(`Channel: ${channel}`);
  if (dryRun) console.log('Mode:    DRY RUN - nothing will be uploaded');

  // --- Work out the new values ---------------------------------------------

  const changes = [];
  for (const field of FIELDS) {
    if (args[field.flag] === undefined) continue;
    const value = field.list ? listValue(args[field.flag]) : String(args[field.flag]).trim();
    changes.push({ ...field, value });
  }

  // A local file is an upload plus a URL rewrite, so it joins the same change
  // list rather than being handled separately below.
  const uploads = [];
  for (const [catalogKey, file] of Object.entries(IMAGE_FIELDS)) {
    const chosen = args[file.flag];
    if (!chosen) continue;
    const localPath = path.resolve(String(first(chosen)));
    if (!existsSync(localPath)) fail(`--${file.flag} does not exist: ${localPath}`);
    if (!statSync(localPath).isFile()) fail(`--${file.flag} is not a file: ${localPath}`);

    // Content-addressed: hashing the bytes puts changed art on a new URL, so the
    // old one stays valid forever under the immutable header. The extension comes
    // from the source file so a JPEG is not served with the wrong Content-Type.
    // Both decisions live in artwork.mjs so the dashboard cannot disagree.
    const base = file.objectName.slice(0, file.objectName.lastIndexOf('.'));
    const hash = createHash('sha256').update(readFileSync(localPath)).digest('hex').slice(0, 8);
    const objectName = artworkObjectName({
      baseName: base,
      hash,
      fileName: localPath,
      fallbackName: file.objectName,
    });
    const key = `${prefix}/${objectName}`;
    uploads.push({ localPath, key, label: objectName });

    // A chosen file supersedes any URL in the same payload rather than adding a
    // second change for the same field. IMAGE_FIELDS and FIELDS are keyed by
    // flag, so match on flag: matching on catalog finds nothing and writes a
    // literal "undefined" key into the catalog instead of the icon URL.
    const field = FIELDS.find((f) => f.flag === catalogKey);
    if (!field) fail(`No field contract entry for "${catalogKey}".`);
    // Relative, not absolute: the CDN host stays in VITE_CDN_ORIGIN.
    const change = { ...field, value: key };
    // Compare on flag too, so a typed URL for this field is replaced rather than
    // left as a second write where only the last one survives.
    const at = changes.findIndex((c) => c.flag === catalogKey);
    if (at >= 0) changes[at] = change;
    else changes.push(change);
  }

  if (changes.length === 0) {
    fail('Nothing to change. Pass at least one field, e.g. --name "Misspell".');
  }

  // --- Read what is published today ----------------------------------------

  const manifest = await fetchJson(manifestUrl);
  const catalog = await fetchJson(catalogUrl);

  if (!manifest) {
    fail(
      `No manifest at ${manifestUrl}.\n  A build must be published before its metadata can be edited.`
    );
  }
  if (!catalog || !Array.isArray(catalog.games)) {
    fail(`Could not read ${catalogUrl}. Refusing to write a new catalog from scratch.`);
  }

  let entry = catalog.games.find((game) => game && game.id === gameId);
  const isNewEntry = !entry;
  if (isNewEntry) {
    // A build with no catalog entry is exactly the state where a game is
    // invisible in the launcher. Adding it is the fix, so allow it and say so.
    entry = { id: gameId, channel };
    catalog.games.push(entry);
    console.log(`\nNo catalog entry for "${gameId}"; one will be created.`);
  }

  // --- Apply ----------------------------------------------------------------

  const applied = applyMetadataChanges(entry, manifest, changes);

  // A game with no channel cannot have its manifest URL built by the launcher, so
  // an entry missing one is not usable even after a metadata edit.
  if (!entry.channel) entry.channel = channel;
  if (!Array.isArray(entry.availableChannels) || entry.availableChannels.length === 0) {
    entry.availableChannels = [channel];
  }

  if (applied.length === 0 && !isNewEntry) {
    console.log('\nNo changes: every field already holds the requested value.');
    return;
  }

  console.log(`\n${applied.length} change(s):`);
  for (const change of applied) {
    console.log(`  ${change.label}`);
    console.log(`    - ${change.before || '(empty)'}`);
    console.log(`    + ${change.after || '(empty)'}`);
  }

  if (dryRun) {
    console.log('\nDry run. Nothing was uploaded.');
    return;
  }

  // --- Upload --------------------------------------------------------------
  //
  // Images first. The manifest is the signal that they exist, so publishing it
  // first would leave a client resolving a banner that 404s for a moment.

  for (const item of uploads) {
    run(
      'aws',
      [
        's3',
        'cp',
        item.localPath,
        S3.s3Uri(bucket, item.key),
        '--endpoint-url',
        endpoint,
        '--no-progress',
        // Immutable, and the key carries a content hash, so a year-long cache is
        // truthful: a changed image lands on a different URL.
        '--cache-control',
        IMMUTABLE,
      ],
      `Uploading ${item.label}`
    );
  }

  const staging = path.join(repoRoot, 'dist');
  const manifestPath = path.join(staging, 'meta-manifest.json');
  const catalogPath = path.join(staging, 'meta-catalog.json');

  try {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

    // Both documents are mutable and must never be cached, or a client keeps
    // reading the metadata that was just replaced.
    upload(manifestPath, S3.s3Uri(bucket, `${prefix}/manifest.json`), {
      endpoint,
      cacheControl: NO_CACHE,
      contentType: 'application/json',
    });
    upload(catalogPath, S3.s3Uri(bucket, 'launcher/catalog.json'), {
      endpoint,
      cacheControl: NO_CACHE,
      contentType: 'application/json',
    });
  } finally {
    // Transport detail, not state. A stale manifest left in dist/ could be
    // picked up by a later build.
    for (const file of [manifestPath, catalogPath]) rmSync(file, { force: true });
  }

  console.log(`\nPublished metadata for ${gameId} (${channel}).`);
  console.log(`  manifest: ${manifestUrl}`);
  console.log(`  catalog:  ${catalogUrl}`);
  console.log('The launcher polls the catalog and picks this up on its own.');
}

// Only run when invoked directly, so the dashboard can import the helpers above
// without the module publishing something.
//
// `.then()` rather than a top-level `await`: a top-level await makes the module
// an async graph, which the test runner's bundler transform rejects when this
// file is imported from a TypeScript test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishMetadata(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
