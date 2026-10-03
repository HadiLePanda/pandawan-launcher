#!/usr/bin/env node
/**
 * Publish the game catalog (and news feed) to R2.
 *
 * The launcher resolves games from {CDN_ORIGIN}/launcher/catalog.json, so a new
 * or changed game is invisible until this runs. It is a small mutable index, so
 * it is never cached.
 *
 *   npm run publish:catalog
 *   npm run publish:catalog -- --dry-run
 *   npm run publish:catalog -- --force
 *
 * The catalog is merged, not overwritten. public/catalog.json is the checked-in
 * copy, and the CDN document is the one that has been edited since:
 * publish:meta rewrites the published catalog in place, so uploading the local
 * file over it reverted every metadata edit and brought the stale name back.
 * Therefore
 *
 *   - a game the CDN already lists keeps its published entry, untouched;
 *   - a game the CDN has never seen is added from the local file;
 *   - a game the local file omits is NOT deleted - it is kept and reported.
 *
 * `--force` lets the local file win for games both sides know, for the rare case
 * where the local copy is the one deliberately maintained. It still never
 * deletes: making a live game disappear is not something a catalog push should
 * be able to do. `--dry-run` reports and changes nothing.
 *
 * The decision lives in scripts/lib/catalog-merge.mjs so it is testable without
 * R2 credentials; this file only reads, writes and prints.
 *
 * news.json is guarded by the same rule and for the same reason: this script
 * replaces the CDN feed with the checked-in public/news.json, so an upload that
 * would REMOVE a published item is refused rather than performed. `--force-news`
 * overrides it. The decision is `droppedNewsIds` in scripts/lib/news-merge.mjs.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fail, NO_CACHE, repoRoot, r2Config, S3, upload } from './lib/r2.mjs';
import { parseArgs } from './lib/args.mjs';
import { mergeCatalog, remoteCatalogRefusal, validateCatalog } from './lib/catalog-merge.mjs';
import { droppedNewsIds, newsRefusal } from './lib/news-merge.mjs';

/** Fetch a JSON document from the CDN, or null when it is absent or unparseable. */
async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * The CDN document's body, or null when it is genuinely absent.
 *
 * Unlike fetchJson this does not fold a read failure into "absent": treating a
 * network blip as an empty document is exactly what lets a publish overwrite
 * something it never managed to read.
 */
async function fetchOptionalJson(url) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    fail(`could not read ${url} (${err.message}). Refusing to publish.`);
  }
  if (res.status === 404) return null;
  if (!res.ok) fail(`could not read ${url} (HTTP ${res.status}). Refusing to publish.`);
  try {
    return await res.json();
  } catch {
    // Present but malformed: there is nothing to protect, and replacing it with a
    // valid local document is a repair rather than a revert.
    return null;
  }
}

/** One-line rendering of a catalog field value, for the report. */
function format(value) {
  if (value === undefined) return '(absent)';
  if (value === null) return '(null)';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '(empty list)';
  const text = String(value);
  return text === '' ? '(empty)' : text;
}

export async function publishCatalog(argv = []) {
  const args = parseArgs(argv);
  const dryRun = Boolean(args['dry-run']);
  const force = Boolean(args.force);

  const catalogPath = path.join(repoRoot, 'public', 'catalog.json');
  if (!existsSync(catalogPath)) {
    fail(`Catalog not found: ${catalogPath}`);
  }

  // Validate before uploading: a malformed catalog breaks every client, and the
  // remote copy is harder to inspect than a local file. The same three checks
  // and the same messages as before - only the decision about what gets written
  // changed.
  let local;
  try {
    local = JSON.parse(readFileSync(catalogPath, 'utf-8'));
  } catch (err) {
    fail(`${catalogPath} is not valid JSON: ${err.message}`);
  }
  const problem = validateCatalog(local);
  if (problem) fail(problem);

  const { bucket, cdnOrigin, endpoint } = r2Config();
  const catalogUrl = `${cdnOrigin}/launcher/catalog.json`;

  console.log('Mode:    MERGE (the published catalog wins for games it already lists)');
  if (dryRun) console.log('Mode:    DRY RUN - nothing will be uploaded');
  if (force) {
    console.log(
      '\n!! --force: public/catalog.json will overwrite the PUBLISHED entry for every game\n' +
        '   both sides know. Metadata edits made with `npm run publish:meta` will be\n' +
        '   discarded - stale names, descriptions and icon URLs included.'
    );
  }

  // --- Read what is published today -----------------------------------------

  const remote = await fetchJson(catalogUrl);

  // The refusal that matters. Publishing from the local file alone because the
  // CDN was unreachable would drop every game missing from the local copy from
  // the launcher, so a network blip would become a total outage. Fail loudly
  // and leave the published document exactly as it is.
  if (!remote || !Array.isArray(remote.games)) fail(remoteCatalogRefusal(catalogUrl));

  const { catalog, added, skipped, preserved, changed } = mergeCatalog(remote, local, { force });

  // --- Report ----------------------------------------------------------------
  //
  // Every skip is listed, not just the interesting ones: the whole point is that
  // an operator who just edited a name in the dashboard can see afterwards that
  // this run did not undo it, and which games it declined to touch.

  if (added.length === 0 && skipped.length === 0) {
    console.log('\nNothing to do: the published catalog already lists every game in this file.');
  }

  if (added.length > 0) {
    console.log(`\nAdding ${added.length} new game(s):`);
    for (const item of added) console.log(`  + ${item.id} (${item.channel})`);
  }

  if (skipped.length > 0) {
    console.log(
      force
        ? `\nOverwriting the published entry for ${skipped.length} game(s) (--force):`
        : `\nKeeping the published entry for ${skipped.length} game(s) the CDN already lists:`
    );
    for (const item of skipped) {
      console.log(`  = ${item.id} (${item.channel})`);
      // CDN-side edits the merge saved. Only these two directions are a
      // reversal: the CDN holds something and the local copy would have undone
      // it. Printed field by field so an operator can see that this run did not
      // revert the edit they just made.
      for (const change of item.differs) {
        console.log(`      ${item.forced ? 'overwrote' : 'kept'}: ${change.field}`);
        console.log(`        published: ${format(change.cdn)}`);
        console.log(`        local:     ${format(change.local)}`);
      }
      // A field the CDN has and the local file never mentions: a plain upload
      // would have blanked it. That is how a content-addressed iconUrl pointing
      // at real uploaded artwork disappears.
      if (item.cdnOnly.length > 0) {
        console.log(`      dropped by a plain upload: ${item.cdnOnly.join(', ')}`);
      }
      // The opposite direction, and deliberately not counted as a save: the
      // published entry simply does not carry these. Listing them separately
      // keeps the two above trustworthy instead of drowning them in noise.
      if (item.localOnly.length > 0) {
        console.log(`      not in the published entry: ${item.localOnly.join(', ')}`);
      }
      if (item.differs.length === 0 && item.cdnOnly.length === 0 && item.localOnly.length === 0) {
        console.log('      identical in both copies');
      }
    }
  }

  if (preserved.length > 0) {
    console.log(
      `\n${preserved.length} game(s) exist only on the CDN and are being left in place\n` +
        '   (a game missing from the local file is not a removal):'
    );
    for (const item of preserved) console.log(`  * ${item.id} (${item.channel})`);
  }

  const kept = skipped.filter(
    (item) => !item.forced && (item.differs.length > 0 || item.cdnOnly.length > 0)
  );
  if (kept.length > 0) {
    console.log(
      `\n${kept.length} entr${kept.length === 1 ? 'y was' : 'ies were'} preserved over a conflicting\n` +
        `   local copy: ${kept.map((item) => item.id).join(', ')}.`
    );
    console.log('   A plain upload would have reverted those edits. Use --force to override.');
  }

  // --- Upload ---------------------------------------------------------------

  if (!changed) {
    // Compared against the remote document rather than inferred from `added`, so
    // a --force run that rewrites entries with identical values does not churn a
    // file every launcher reads on every push.
    console.log('\nPublished catalog already matches; nothing to upload.');
  }

  if (changed && !dryRun) {
    // upload() takes a path because `aws s3 cp` reads a file, so the merged
    // document has to land somewhere on disk first.
    const staging = path.join(repoRoot, 'dist');
    const mergedPath = path.join(staging, 'catalog-merged.json');
    try {
      writeFileSync(mergedPath, `${JSON.stringify(catalog, null, 2)}\n`);
      upload(mergedPath, S3.s3Uri(bucket, 'launcher/catalog.json'), {
        endpoint,
        // Mutable index, so it must never be cached or a client keeps reading
        // the document that was just replaced.
        cacheControl: NO_CACHE,
        contentType: 'application/json',
      });
    } finally {
      // Transport detail, not state. A stale copy left in dist/ could be picked
      // up by a later build, or read by hand as if it were published.
      rmSync(mergedPath, { force: true });
    }
    console.log(`\nCatalog published: ${catalogUrl}`);
  }

  if (dryRun) {
    console.log('\nDry run. Nothing was uploaded.');
  }

  // News is guarded, not merged: the local file may add items to the CDN feed but
  // may not remove any, which is the one silent revert left in this script.
  const newsPath = path.join(repoRoot, 'public', 'news.json');
  if (existsSync(newsPath) && !process.env.SKIP_NEWS) {
    const newsUrl = `${cdnOrigin}/launcher/news.json`;
    let localNews;
    try {
      localNews = JSON.parse(readFileSync(newsPath, 'utf-8'));
    } catch (err) {
      fail(`${newsPath} is not valid JSON: ${err.message}`);
    }

    const publishedNews = await fetchOptionalJson(newsUrl);
    const dropped = droppedNewsIds(publishedNews, localNews);
    if (dropped.length > 0 && !args['force-news']) {
      fail(newsRefusal(newsUrl, dropped));
    }
    if (dropped.length > 0) {
      console.log(
        `\n!! --force-news: replacing ${newsUrl} will remove ${dropped.length} ` +
          `published item(s): ${dropped.join(', ')}`
      );
    }

    if (dryRun) {
      console.log('\nnews.json: not uploaded (dry run).');
    } else {
      upload(newsPath, S3.s3Uri(bucket, 'launcher/news.json'), {
        endpoint,
        cacheControl: NO_CACHE,
        contentType: 'application/json',
      });
    }
  }

  console.log(
    `\n${added.length} added, ${skipped.length} ${force ? 'overwritten from local' : 'kept as published'}, ` +
      `${preserved.length} kept CDN-only.`
  );
}

// Only run when invoked directly, so the module can be imported by a test
// without the script publishing anything. Same guard as publish-metadata.mjs.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishCatalog(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
