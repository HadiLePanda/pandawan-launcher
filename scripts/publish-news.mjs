#!/usr/bin/env node
/**
 * Edit the launcher news feed without republishing anything else.
 *
 * Both copies are written: the launcher falls back to the bundled public/news.json
 * when the CDN is unreachable, and publish-catalog.mjs uploads that file straight
 * over the CDN document, so a CDN-only edit is reverted by the next catalog publish.
 *
 * An id is its artwork object's stem, so it is never renamed in place: create a new
 * id and delete the old item instead.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fail, IMMUTABLE, NO_CACHE, repoRoot, r2Config, run, S3, upload } from './lib/r2.mjs';

import { first, parseArgs } from './lib/args.mjs';
import {
  NEWS_ART_PREFIX,
  NEWS_FIELDS,
  NEWS_IMAGE_FIELD,
  validateNewsItem,
} from './lib/news-fields.mjs';
import { applyNewsOps, newsItemLabel } from './lib/apply-news.mjs';
import { artworkObjectName } from './lib/artwork.mjs';

const NEWS_KEY = 'launcher/news.json';

/** The four forms an invocation can take, quoted verbatim in the help text. */
const USAGE = [
  '  --update <id>  [--title ...] [--excerpt ...] [--image-file ./art/x.png]',
  '  --create --id <id>  --title "..." [...field flags]',
  '  --delete <id>',
  '  --move <id> --up | --down',
].join('\n');

// One before/after line. These values are not strings - a create reports a whole
// item, a move an index - so a template literal would print "[object Object]" for
// every edit, which is the output the operator is meant to read.
function describe(value) {
  if (value === null || value === undefined) return '(none)';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    // An item is named by its label; a field subset has no id of its own, so its entries
    // are listed. Empty means the field was removed, which is not the same as the
    // value never having existed.
    if (value.id !== undefined) return newsItemLabel(value) || value.id;
    const entries = Object.entries(value);
    if (entries.length === 0) return '(removed)';
    return entries
      .map(([key, entry]) => `${key}: ${entry === null ? '(removed)' : String(entry)}`)
      .join(', ');
  }
  return String(value);
}

// Structurally compared: an update reports whole items, so setting a field to the
// value it already held yields an equal object and must not trigger an upload. This
// is also what lets a "move up" on the top row - reported rather than ignored, since
// somebody pressed a button - come out as no change.
function sameValue(a, b) {
  if (a === b) return true;
  const bothObjects = typeof a === 'object' && typeof b === 'object' && a !== null && b !== null;
  return bothObjects && JSON.stringify(a) === JSON.stringify(b);
}

export async function publishNews(argv) {
  const args = parseArgs(argv);
  const dryRun = Boolean(args['dry-run']);

  // One op per run: two would read as atomic, but the feed is read once and written
  // once, so a failure halfway leaves the operator guessing which half landed.
  const requested = ['update', 'create', 'delete', 'move'].filter((name) => args[name]);
  if (requested.length === 0) {
    fail(`Say what to do. One of:\n${USAGE}\n  Add --dry-run to preview without uploading.`);
  }
  if (requested.length > 1) {
    fail(
      `Only one operation per run (got --${requested.join(', --')}).\n  Run them one at a time.`
    );
  }

  const operation = requested[0];
  const { bucket, cdnOrigin, endpoint } = r2Config();
  const newsUrl = `${cdnOrigin}/${NEWS_KEY}`;

  // --create names the id with its own flag because it has no other value to carry
  // it. The ?? is load-bearing: String(undefined) is the truthy literal "undefined".
  const rawId = operation === 'create' ? first(args.id) : first(args[operation]);
  const itemId = String(rawId ?? '').trim();
  if (!itemId) {
    fail(operation === 'create' ? '--create needs an --id.' : `--${operation} needs an id.`);
  }

  console.log(`Operation: ${operation}`);
  console.log(`Item:      ${itemId}`);
  if (dryRun) console.log('Mode:      DRY RUN - nothing will be uploaded');

  // --- Work out the new values ---------------------------------------------

  // Built from the shared contract, not from the flags that happened to be passed,
  // so a field added to news-fields.mjs appears without editing this script. An unset
  // flag is skipped, and that omission is what makes a partial edit safe.
  const values = {};
  for (const field of NEWS_FIELDS) {
    // A chosen file supersedes the typed URL for the same field; see below.
    if (field.flag === NEWS_IMAGE_FIELD.metadataFlag && args[NEWS_IMAGE_FIELD.flag]) continue;
    if (args[field.flag] === undefined) continue;
    // Keyed by flag, not by wire key: apply-news.mjs reads `values` as the contract
    // names them and treats an absent flag as "leave this field alone", so wire keys
    // here would turn an edit into a silent no-op.
    values[field.flag] = String(first(args[field.flag])).trim();
  }

  // --- Artwork ---------------------------------------------------------------
  //
  // The upload and the URL rewrite are one decision, resolved here so the op list
  // stays a plain description of the edit.
  const uploads = [];
  const chosenImage = args[NEWS_IMAGE_FIELD.flag];
  if (chosenImage && (operation === 'update' || operation === 'create')) {
    const localPath = path.resolve(String(first(chosenImage)));
    if (!existsSync(localPath)) fail(`--${NEWS_IMAGE_FIELD.flag} does not exist: ${localPath}`);
    if (!statSync(localPath).isFile()) {
      fail(`--${NEWS_IMAGE_FIELD.flag} is not a file: ${localPath}`);
    }

    // Content-addressed, stem taken from the item id so a news/<id>-<hash>.png name
    // says which announcement it belongs to. Hashing is what makes the immutable
    // cache header truthful: changed art lands on a new URL, so the old one stays
    // valid forever. Both decisions live in artwork.mjs so this cannot drift from
    // the dashboard's listing.
    const hash = createHash('sha256').update(readFileSync(localPath)).digest('hex').slice(0, 8);
    const objectName = artworkObjectName({
      baseName: itemId,
      hash,
      fileName: localPath,
      // An extensionless chosen file still resolves to a .png object.
      fallbackName: 'news.png',
    });
    const key = `${NEWS_ART_PREFIX}/${objectName}`;
    uploads.push({ localPath, key, objectName });
    console.log(`Image:     ${objectName} -> ${key}`);

    // A chosen file supersedes a typed URL rather than joining it as a second
    // value, where only the last write would survive.
    values[NEWS_IMAGE_FIELD.metadataFlag] = `${cdnOrigin}/${key}`;
  } else if (chosenImage) {
    fail(`--${NEWS_IMAGE_FIELD.flag} only applies to --create or --update.`);
  }

  // --- Build the op ----------------------------------------------------------

  let ops;
  switch (operation) {
    case 'update':
      if (Object.keys(values).length === 0) {
        fail('Nothing to update. Pass at least one field, e.g. --title "New title".');
      }
      ops = [{ op: 'update', id: itemId, values }];
      break;
    case 'create':
      if (!values.title) fail('--create needs a --title.');
      ops = [{ op: 'create', id: itemId, values }];
      break;
    case 'delete':
      ops = [{ op: 'delete', id: itemId }];
      break;
    case 'move': {
      const up = Boolean(args.up);
      const down = Boolean(args.down);
      if (up === down) fail('--move needs exactly one of --up or --down.');
      ops = [{ op: 'move', id: itemId, delta: up ? -1 : 1 }];
      break;
    }
    default:
      fail(`Unknown operation "${operation}".`);
  }

  // --- Read what is published today ----------------------------------------

  /** Fetch a JSON document from the CDN, or null when it is not there. */
  async function fetchJson(url) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  const published = await fetchJson(newsUrl);
  const isNewFeed = !published || !Array.isArray(published.items);
  const feed = isNewFeed ? { items: [] } : published;

  // Unlike publish-metadata.mjs, which refuses to invent a catalog, an absent feed
  // is legitimate: the first announcement creates the document.
  if (isNewFeed) {
    console.log(`\nNo readable feed at ${newsUrl}; one will be created.`);
  }

  // --- Apply ----------------------------------------------------------------

  // A rejected op must not be published alongside the accepted ones: the operator
  // asked for N things and would see confirmation for the half that worked. Fail
  // before uploading anything.
  const { applied = [], errors = [] } = applyNewsOps(feed, ops);
  const nextFeed = feed;

  if (errors.length > 0) {
    console.error(`\n${errors.length} operation(s) failed:`);
    for (const error of errors) {
      // An error carries the id it belongs to; with more than one item in the feed a
      // bare message does not say which one.
      console.error(`  ${error.id ? `${error.id}: ` : ''}${error.message ?? error}`);
    }
    fail('Nothing was uploaded.');
  }

  // An update asking for what is already published produces an empty diff, so
  // dropping those here makes the "no changes" path below genuinely no changes.
  const moved = applied.filter((change) => !sameValue(change.before, change.after));

  if (moved.length === 0) {
    console.log('\nNo changes: the feed already says exactly that.');
    return;
  }

  console.log(`\n${moved.length} change(s):`);
  for (const change of moved) {
    console.log(`  ${change.label}`);
    console.log(`    - ${describe(change.before)}`);
    console.log(`    + ${describe(change.after)}`);
  }

  // Validate the whole document, not only the item that moved. The launcher
  // drops an item with no id or title, so publishing one hands the operator a
  // feed that looks edited while an announcement is silently missing on screen.
  for (const item of nextFeed.items ?? []) {
    const problem = validateNewsItem(item);
    if (problem) fail(`Refusing to publish: ${problem}.`);
  }

  // The launcher ignores updatedAt, but the dashboard reads it to say when the
  // feed last changed, so it is stamped when absent and refreshed on every real
  // publish - a feed claiming to be as fresh as whenever it was first written
  // is worse than not showing the field at all.
  if (typeof nextFeed.updatedAt !== 'string' || !nextFeed.updatedAt.trim()) {
    nextFeed.updatedAt = new Date().toISOString();
  }

  if (dryRun) {
    console.log('\nDry run. Nothing was uploaded, and public/news.json was left alone.');
    return;
  }

  nextFeed.updatedAt = new Date().toISOString();

  // --- Publish --------------------------------------------------------------

  // Images first. The feed is the signal that they exist, so publishing it
  // first would leave a client resolving an image that 404s for a moment.
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
        // truthful: changed art lands on a different URL, which means a client
        // that cached the old one is never served stale art.
        //
        // The earlier NO_CACHE here was correct in isolation - the name was
        // stable, so a cached copy could outlive the file - but it made every
        // launch re-download every announcement image. Hashing the name fixes
        // both the staleness and the download.
        '--cache-control',
        IMMUTABLE,
      ],
      `Uploading ${item.objectName}`
    );
  }

  const stagedPath = path.join(repoRoot, 'dist', 'news-publish.json');

  try {
    writeFileSync(stagedPath, `${JSON.stringify(nextFeed, null, 2)}\n`);

    // A mutable index, so it must never be cached: a client holding a copy keeps
    // reading the feed that was just replaced.
    upload(stagedPath, S3.s3Uri(bucket, NEWS_KEY), {
      endpoint,
      cacheControl: NO_CACHE,
      contentType: 'application/json',
    });
  } finally {
    // Transport detail, not state. A stale feed left in dist/ could be picked up
    // by a later build.
    rmSync(stagedPath, { force: true });
  }

  // The bundled copy is not optional, and this is the line that explains why:
  // public/news.json ships inside the app as the offline fallback, and
  // publish-catalog.mjs uploads this very file over the CDN document. A
  // CDN-only news edit would therefore be reverted by the next catalog
  // publish - silently, with no error to point at. Same shape as the file
  // already on disk: 2-space JSON with a trailing newline.
  const localPath = path.join(repoRoot, 'public', 'news.json');
  writeFileSync(localPath, `${JSON.stringify(nextFeed, null, 2)}\n`);

  console.log(`\nPublished ${operation} for "${itemId}".`);
  console.log('Both copies of the feed were written:');
  console.log(`  CDN:   ${newsUrl}`);
  console.log(`  local: ${localPath}`);
}

// Only run when invoked directly, so the dashboard can import publishNews above
// without the module trying to publish something.
//
// `.then()` rather than a top-level `await`: a top-level await makes the whole
// module an async graph, and the bundler's transform used by the test runner
// rejects that when this file is imported from a TypeScript test.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishNews(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
