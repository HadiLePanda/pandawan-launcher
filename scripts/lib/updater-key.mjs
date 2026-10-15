/**
 * Reading the release keypair, in the two forms the tooling needs it.
 *
 * Used by the publishers, which have to sign. `scripts/check-updater-keys.cjs` holds
 * its own copy of the two `*KeyBody` readers because it is CommonJS and cannot
 * import this file; both paths call the same `tauri signer sign`, so a key one
 * accepts and the other refuses fails loudly at the CLI rather than silently
 * producing an unsigned release.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * The Tauri CLI's JS entry point, from node_modules so nothing needs a global install.
 *
 * Run through the current node rather than the `tauri` shim in node_modules/.bin:
 * that shim is a `.cmd` on Windows, which cannot be executed without a shell, and
 * cmd re-parses whatever command line it is handed. The JS entry takes the same
 * arguments and needs no shell and no quoting.
 */
export const tauriCliPath = (repoRoot) =>
  path.join(repoRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');

/**
 * Run the Tauri CLI.
 *
 * It is the only thing that can sign: `tauri signer sign` is the same command
 * `tauri build` runs for updater artifacts, and the Rust minisign crate behind it
 * rejects the empty-password key format the `minisign` CLI writes.
 */
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

/**
 * The public key in the form `plugins.updater.pubkey` expects.
 *
 * `verify_signature()` in tauri-plugin-updater base64-decodes that value and parses
 * the result with `minisign_verify::PublicKey::decode`, so the config holds the
 * **base64 of a whole PublicKeyBox** - the `untrusted comment:` line plus the key
 * line. `tauri signer generate` writes `updater.pub` in exactly that form already,
 * so it is used verbatim; a `minisign`-CLI key file is plain text and is encoded
 * first. Must stay in step with `publicKeyForConfig` in sync-updater-key.cjs.
 */
export function publicKeyBody(file) {
  return encodedBox(file);
}

/**
 * The secret key in the base64 form the Tauri CLI decodes.
 *
 * A key from `tauri signer generate` is already a single base64 blob. A minisign-CLI
 * key is plain text starting with an `untrusted comment:` header and must be encoded
 * first, or the CLI fails with
 * "failed to decode base64 secret key: Invalid symbol 32, offset 9" (offset 9 is the
 * space in that header).
 *
 * Never log the returned value.
 */
export function secretKeyBody(file) {
  return encodedBox(file);
}

function encodedBox(file) {
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (!raw) return null;
  return /^untrusted comment:/i.test(raw) ? Buffer.from(raw, 'utf-8').toString('base64') : raw;
}
