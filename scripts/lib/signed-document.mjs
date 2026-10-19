/**
 * Read a mutable published document together with the `.sig` beside it.
 *
 * A publisher merges what the bucket already holds and then signs the result. If
 * it merged an unverified document, a planted entry would be copied into a
 * freshly signed one - the signature would launder the attack. This is the
 * check that prevents that, done before the merge.
 *
 * A missing `.sig` may be a pre-signing document or a deleted one. The caller
 * decides whether to adopt it; nothing here adopts it automatically.
 */

import { readFileSync } from 'node:fs';

import { verifySignedBytes } from './minisign-verify.mjs';

/**
 * @returns {Promise<
 *   | { status: 'signed' | 'unsigned'; text: string }
 *   | { status: 'missing' }
 *   | { status: 'invalid' | 'error'; message: string }
 * >}
 */
export async function fetchSignedDocument(url, publicKeyPath) {
  let res;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    return { status: 'error', message: `could not read ${url}: ${err?.message ?? err}` };
  }
  if (res.status === 404) return { status: 'missing' };
  if (!res.ok) return { status: 'error', message: `${url} answered HTTP ${res.status}` };
  const text = await res.text();

  let sigRes;
  try {
    sigRes = await fetch(`${url}.sig`, { cache: 'no-store' });
  } catch (err) {
    return { status: 'error', message: `could not read ${url}.sig: ${err?.message ?? err}` };
  }
  if (sigRes.status === 404) return { status: 'unsigned', text };
  if (!sigRes.ok) {
    return { status: 'error', message: `${url}.sig answered HTTP ${sigRes.status}` };
  }

  const signature = await sigRes.text();
  const publicKey = readFileSync(publicKeyPath, 'utf-8');
  if (!verifySignedBytes(Buffer.from(text, 'utf-8'), signature, publicKey)) {
    return { status: 'invalid', message: `${url} does not match the release key` };
  }
  return { status: 'signed', text };
}

/** The reason to refuse a live document, or null when it may be merged. */
export function adoptionRefusal(read, { url, migration = 'Publish a new signed document' } = {}) {
  if (read.status === 'invalid' || read.status === 'error') return read.message;
  if (read.status === 'unsigned') {
    return `${url} has no signature. Refusing it: an R2 writer can delete that file.\n  ${migration}.`;
  }
  return null;
}
