/**
 * Deciding what still needs uploading from a generated manifest.
 *
 * The version directory is immutable, so a path already published with the same
 * hash is the same object. Comparing against the published manifest is what lets
 * a republish skip the files it already sent without listing the bucket - and
 * listing is the permission a publisher should not need.
 */

/**
 * The files a manifest lists for one platform. A flat (pre-platform) manifest
 * keeps them at the top level. A missing manifest yields nothing, which callers
 * read as "nothing published yet".
 */
export function manifestFiles(manifest, platform) {
  if (!platform) return Array.isArray(manifest?.files) ? manifest.files : [];
  return manifest?.platforms?.[platform]?.files ?? [];
}

/** Paths to upload, and paths the published manifest already accounts for. */
export function planUpload(localFiles, publishedFiles) {
  const published = new Map((publishedFiles ?? []).map((file) => [file.path, file.hash]));
  const upload = [];
  const skipped = [];
  for (const file of localFiles ?? []) {
    // An entry with no hash never matches, so it is uploaded rather than assumed.
    if (published.get(file.path) === file.hash) skipped.push(file.path);
    else upload.push(file.path);
  }
  return { upload, skipped };
}
