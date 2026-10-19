/**
 * Upload a signed document, signature first.
 *
 * The order is the invariant: a client that reads the document can always read
 * the signature that makes it usable. Every publisher goes through here so the
 * order lives once, and no writer can forget to sign.
 */

import { signFile } from './manifest-sign.mjs';
import { NO_CACHE, S3, upload } from './r2.mjs';

export function uploadSignedDocument(
  file,
  {
    bucket,
    key,
    endpoint,
    cacheControl = NO_CACHE,
    contentType = 'application/json',
    throwOnFailure = false,
  }
) {
  upload(`${file}.sig`, S3.s3Uri(bucket, `${key}.sig`), {
    endpoint,
    cacheControl,
    contentType: 'text/plain',
    throwOnFailure,
  });
  upload(file, S3.s3Uri(bucket, key), {
    endpoint,
    cacheControl,
    contentType,
    throwOnFailure,
  });
}

/** Sign `file`, then upload it with its signature. Returns the signFile result. */
export function signAndUploadDocument(file, { repoRoot, keyPath, ...uploadOptions }) {
  const signed = signFile(file, { repoRoot, keyPath });
  if (!signed.ok) return signed;
  uploadSignedDocument(file, uploadOptions);
  return signed;
}
