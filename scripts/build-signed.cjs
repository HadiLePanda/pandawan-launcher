#!/usr/bin/env node
/**
 * Build the Tauri app with the local minisign secret key.
 *
 * 1. Syncs the public key into tauri.conf.json.
 * 2. Locates the gitignored secret key.
 * 3. Runs `tauri build` with the signing key available to the Tauri CLI.
 *
 * Key format: the Tauri CLI base64-decodes TAURI_SIGNING_PRIVATE_KEY (or the file
 * named by TAURI_SIGNING_PRIVATE_KEY_PATH) before parsing it as a minisign
 * SecretKeyBox - see `secret_key()` in tauri-cli's helpers/updater_signature.rs.
 * `tauri signer generate` already writes the key base64-encoded, so the file is
 * passed through verbatim. A key produced by the `minisign` CLI is plain text and
 * must be re-encoded here, or the build fails with
 * "failed to decode base64 secret key: Invalid symbol 32, offset 9"
 * (offset 9 is the space in the `untrusted comment:` header).
 */

const { spawn } = require('child_process');
const { existsSync, readFileSync, readdirSync, statSync } = require('fs');
const { join, resolve } = require('path');

const projectRoot = resolve(__dirname, '..');
const secretKeyPath = resolve(projectRoot, 'src-tauri', '.secrets', 'updater.key');
const bundleDir = resolve(projectRoot, 'src-tauri', 'target', 'release', 'bundle');

/**
 * Resolve the Tauri CLI from node_modules.
 *
 * `tauri` is not installed globally, so relying on PATH only works when this
 * script is started through an npm script (which injects node_modules/.bin).
 * Running `node scripts/build-signed.cjs` directly would fail with ENOENT.
 */
function tauriBin() {
  const name = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';
  return resolve(projectRoot, 'node_modules', '.bin', name);
}

/**
 * Read the secret key in the base64 form the Tauri CLI expects.
 *
 * A tauri-generated key is already base64; a minisign-CLI key is plain text and
 * has to be encoded. Never log the returned value.
 */
function loadSigningKey(file) {
  const raw = readFileSync(file, 'utf-8').trim();
  if (!raw) throw new Error(`Updater secret key file is empty: ${file}`);
  return /^untrusted comment:/i.test(raw) ? Buffer.from(raw, 'utf-8').toString('base64') : raw;
}

// 1. Sync public key first.
const sync = spawn('node', [resolve(__dirname, 'sync-updater-key.cjs')], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

sync.on('close', (code) => {
  if (code !== 0) {
    console.error('Failed to sync updater public key.');
    process.exit(code ?? 1);
  }

  // 2. Ensure secret key exists.
  if (!existsSync(secretKeyPath)) {
    console.error(
      `Missing updater secret key: ${secretKeyPath}\n` +
        'Place your signing key at that path, or set TAURI_SIGNING_PRIVATE_KEY(_PATH).\n' +
        'Generate one with: npm run tauri signer generate -w src-tauri/.secrets/updater.key'
    );
    process.exit(1);
  }

  // 3. Read the secret key. The value is only ever passed to the child process;
  //    it is never logged or written anywhere.
  let privateKey;
  try {
    privateKey = loadSigningKey(secretKeyPath);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const env = {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: privateKey,
  };

  // The password must always be defined, even as an empty string. The Tauri CLI
  // reads it with clap's `env = "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"`; when the
  // variable is absent it falls back to prompting interactively, so the build hangs
  // at "Decrypting updater signing key, expect a prompt for password" forever with
  // no error. Keys from `npm run keys:generate` have no password, so this is ''.
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '';

  // 4. Run tauri build with the signing key.
  const build = spawn(tauriBin(), ['build'], {
    cwd: resolve(projectRoot, 'src-tauri'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });

  build.on('close', (buildCode) => {
    if (buildCode !== 0) process.exit(buildCode ?? 1);

    // `tauri build` reports success even when it could not sign: it just omits the
    // .sig files, and the release then ships with no updater manifest. Fail the
    // build instead, so an unsigned artifact is never mistaken for a good one.
    const sigs = findSignatureFiles(bundleDir);
    if (sigs.length === 0) {
      console.error(
        'The build finished but produced no .sig files under\n' +
          `  ${bundleDir}\n` +
          'So it is not updater-signable. Check that:\n' +
          '  - bundle.createUpdaterArtifacts is true in src-tauri/tauri.conf.json\n' +
          '  - src-tauri/.secrets/updater.key matches the committed src-tauri/updater.pub\n' +
          'Run `npm run keys:check` for a detailed diagnosis.'
      );
      process.exit(1);
    }

    console.log(`Signed ${sigs.length} updater artifact(s):`);
    for (const sig of sigs) console.log(`  ${sig}`);
    process.exit(0);
  });
});

/** Recursively collect the `.sig` files a signed bundle produces. */
function findSignatureFiles(dir) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...findSignatureFiles(full));
    } else if (entry.endsWith('.sig')) {
      found.push(full);
    }
  }
  return found;
}
