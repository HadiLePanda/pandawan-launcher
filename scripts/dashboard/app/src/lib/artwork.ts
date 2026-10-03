/**
 * Staging a chosen file into a path the publisher can upload.
 *
 * A browser cannot hand over an absolute path, which is exactly what
 * publish-metadata.mjs needs in order to upload. So the bytes travel over the
 * same loopback connection the rest of the panel uses and come back as a real
 * path the publisher can upload.
 *
 * The typed path box stays beside the picker on purpose: both routes write into
 * the same value, so everything downstream - the dirty count, the undo button,
 * the publish payload - behaves identically whether the file was picked or
 * typed, and neither route is left half-wired.
 */

import type { StagedFile } from '@app-types/api';

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

/**
 * Post a chosen file and return the path it was staged at.
 *
 * Throws with the server's own words on refusal: these endpoints answer
 * operator mistakes (a 14 MB PNG, a .bmp) with a plain readable string on
 * purpose, and swallowing it would leave the field looking unedited.
 */
export async function stageArtwork(file: File): Promise<StagedFile> {
  const data = await fileToBase64(file);
  if (!data) throw new Error('that file could not be read');

  const res = await fetch('/api/art/stage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, sizeBytes: file.size, data }),
  });

  if (!res.ok) {
    throw new Error((await res.text()) || `HTTP ${res.status}`);
  }
  return (await res.json()) as StagedFile;
}

/** A blob URL for previewing a picked file before it is uploaded. */
export function previewUrlFor(file: File): string {
  return URL.createObjectURL(file);
}

export function releasePreviewUrl(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* Already revoked. Revoking twice is not worth guarding loudly. */
  }
}
