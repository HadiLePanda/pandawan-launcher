/**
 * Read a mutable published document together with the `.sig` beside it.
 *
 * A publisher merges what the bucket already holds and then signs the result. If
 * it merged an unverified document, a planted entry would be copied into a
 * freshly signed one - the signature would launder the attack. This is the
 * check that prevents that, done before the merge.
 *
 * One migration case is explicit: a document published before signing existed
 * has no `.sig`. Reporting it as `unsigned` lets the first signed publish replace
 * it; once a `.sig` is present, an invalid one is refused.
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
