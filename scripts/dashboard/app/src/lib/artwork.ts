/**
 * The one artwork upload, and the file reader it needs.
 *
 * A browser cannot hand a file's bytes to the AWS CLI, so the bytes travel over
 * the same loopback connection the rest of the panel uses and the SERVER does the
 * upload: it validates against artwork.mjs, derives the object name from the
 * bytes' hash, and writes the object through the same r2.mjs layer the delete
 * path uses. The client never chooses or sends the object name - the hash does.
 *
 * `POST /api/art/stage` still exists for the News editor, which needs a real
 * absolute path rather than a bucket object; this module's upload is the library
 * write, which is a different thing.
 */

import { apiPost } from '@lib/api';

/**
 * The image types the artwork upload accepts. SVG is excluded because artwork
 * renders through `<img>` from a remote origin, where an SVG can carry script.
 */
export const ARTWORK_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/** What POST /api/art/upload answers with. `ok` is always true on a 200. */
export interface ArtworkUploadResult {
  /** False for the dry run and for a duplicate: nothing was written. */
  written: boolean;
  /** True when these exact bytes are already on the bucket. */
  duplicate: boolean;
  /** The existing object's name when duplicate, else null. */
  existingName: string | null;
  /** The name the object is (or would be) stored under. Server-derived. */
  objectName: string;
  key: string;
  url: string;
  sizeBytes: number;
}

/**
 * Put a chosen file into the bucket as content-addressed artwork, and return what
 * was written.
 *
 * The object name is derived from the bytes' hash on the SERVER, so it cannot be
 * known before the bytes are hashed. That is why this is two requests: the first
 * is a dry run answering with the consequence (the resulting object name, and
 * whether these bytes are already on the bucket), and only after the operator
 * confirms THAT - naming the file and the object - does the second request write.
 * A duplicate is never confirmed or re-uploaded.
 *
 * This is the ONE library-upload path: the Artwork page and the MediaPicker both
 * go through it, so they cannot diverge in validation, naming or confirmation.
 *
 * Returns null when the operator cancelled. Throws with the server's own words on
 * a refusal.
 */
export async function uploadArtwork({
  gameId,
  channel,
  file,
}: {
  gameId: string;
  channel: string;
  file: File;
}): Promise<ArtworkUploadResult | null> {
  const data = await fileToBase64(file);
  if (!data) throw new Error('that file could not be read');

  const body = { gameId, channel, fileName: file.name, sizeBytes: file.size, data };
  const planned = await apiPost<ArtworkUploadResult>('/api/art/upload', {
    ...body,
    confirm: false,
  });
  if (planned.duplicate) return planned;

  if (
    !window.confirm(
      `Upload ${file.name} to ${gameId} / ${channel} as ${planned.objectName}? ` +
        'It becomes a permanent, content-addressed object in the bucket.'
    )
  ) {
    return null;
  }

  return apiPost<ArtworkUploadResult>('/api/art/upload', { ...body, confirm: true });
}

/** What a picker needs back from an upload: the object to select, and a line to show. */
export interface MediaUploadOutcome {
  key: string;
  note: string;
}

/**
 * Read a File as base64.
 *
 * ReadAsDataURL gives "data:image/png;base64,...." and the server wants the
 * payload alone. The client's MIME type is dropped rather than trusted: the
 * server performs its own extension check, and sending a client-declared type
 * would defeat it.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve('');
    reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
}
