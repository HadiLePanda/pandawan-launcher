/** Reading the release keypair, in the two forms the tooling needs it. */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** The Tauri CLI's JS entry point. Run through node rather than the `tauri` shim in
 * node_modules/.bin: that shim is a `.cmd` on Windows, which needs a shell. */
export const tauriCliPath = (repoRoot) =>
  path.join(repoRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

export function runTauriCli(repoRoot, args, options = {}) {
  return spawnSync(process.execPath, [tauriCliPath(repoRoot), ...args], {
    shell: false,
    ...options,
  });
}

/** The secret half of the release keypair. Gitignored, so a clone does not have it. */
export const secretKeyPath = (repoRoot) =>
  path.join(repoRoot, 'src-tauri', '.secrets', 'updater.key');

/** The public half. Committed, and pinned by every installed launcher. */
export const publicKeyPath = (repoRoot) => path.join(repoRoot, 'src-tauri', 'updater.pub');

/** The public key in the form `plugins.updater.pubkey` expects: the base64 of a whole
 * PublicKeyBox, because `verify_signature()` in tauri-plugin-updater base64-decodes it
 * before parsing. Must stay in step with `publicKeyForConfig` in sync-updater-key.cjs. */
export function publicKeyBody(file) {
  return encodedBox(file);
}

/** The secret key in the base64 form the Tauri CLI decodes. A `minisign`-CLI key is plain
 * text and has to be encoded first, or the CLI fails with "Invalid symbol 32, offset 9"
 * (offset 9 is the space in its `untrusted comment:` header). Never log the value. */
export function secretKeyBody(file) {
  return encodedBox(file);
}

function encodedBox(file) {
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (!raw) return null;
  return /^untrusted comment:/i.test(raw) ? Buffer.from(raw, 'utf-8').toString('base64') : raw;
}
