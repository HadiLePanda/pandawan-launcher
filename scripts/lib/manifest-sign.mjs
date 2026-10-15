/**
 * Signing the documents a launcher checks before it installs anything.
 *
 * The client verifies against the key in `src-tauri/updater.pub`, so an unsigned
 * publish is a build nobody can install. The key is therefore checked up front: a
 * missing key must cost nothing, not be discovered with bytes already on the bucket.
 *
 * The signature covers the exact bytes on disk, so it is written once the document is
 * final. A metadata edit rewrites the manifest, which is why it signs too.
 */

import { existsSync } from 'node:fs';
import { runTauriCli, secretKeyBody } from './updater-key.mjs';

/**
 * Whether this machine can sign at all. The publishers call it before uploading.
 *
 * @returns {{ok: true, keyBody: string} | {ok: false, detail: string}}
 */
export function checkReleaseKey(keyPath) {
  if (!existsSync(keyPath)) {
    return {
      ok: false,
      detail:
        `no release key at ${keyPath}.\n` +
        '  A publish signs its manifest so a client can tell a build we shipped from one\n' +
        '  somebody else planted, and the key is gitignored, so a fresh clone does not have\n' +
        '  it. Copy it from your backup, or run `npm run keys:generate` if no release has\n' +
        '  shipped yet (that invalidates signatures made with the old key).',
    };
  }

  const keyBody = secretKeyBody(keyPath);
  if (!keyBody) return { ok: false, detail: `${keyPath} is empty.` };
  return { ok: true, keyBody };
}

/**
 * Sign `file` with the release key, writing `<file>.sig` beside it.
 *
 * @returns {{ok: true, signature: string} | {ok: false, detail: string}}
 */
export function signFile(file, { repoRoot, keyPath }) {
  const key = checkReleaseKey(keyPath);
  if (!key.ok) return key;

  const result = runTauriCli(repoRoot, ['signer', 'sign', file], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: key.keyBody,
      // Always set, even empty: unset makes the CLI prompt, and a publish waiting on
      // a prompt is a publish that hangs.
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '',
    },
  });

  const signature = `${file}.sig`;
  if (result.status !== 0 || !existsSync(signature)) {
    const detail = `${result.stderr || result.stdout || ''}`.trim();
    return {
      ok: false,
      detail: `signing ${file} failed (exit ${result.status}): ${detail || 'no output'}`,
    };
  }
  return { ok: true, signature };
}
