#!/usr/bin/env node
/**
 * Sync the minisign public key from src-tauri/updater.pub into
 * src-tauri/tauri.conf.json so there is a single source of truth.
 *
 * Also syncs the updater endpoint from TAURI_UPDATER_ENDPOINT so a deployment
 * can be repointed without hand-editing the config. The endpoint is the static
 * JSON the Tauri updater polls, e.g.
 *   https://cdn.example.com/launcher/latest.json
 * which must match the file the release workflow publishes.
 *
 * Run automatically before tauri:dev and tauri:build.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const pubKeyPath = path.join(repoRoot, 'src-tauri', 'updater.pub');
const configPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');

/**
 * Read the public key in the exact form `plugins.updater.pubkey` expects.
 *
 * `verify_signature()` in tauri-plugin-updater does `base64_to_string(pub_key)`
 * followed by `minisign_verify::PublicKey::decode(..)`, so the configured value is
 * the base64 of a **whole minisign PublicKeyBox** - the `untrusted comment:` line
 * plus the key line.
 *
 * `tauri signer generate` writes `updater.pub` in exactly that form already (a
 * single base64 blob), so the file content is used verbatim. A key written by the
 * `minisign` CLI is plain text and has to be base64-encoded first.
 *
 * Using the inner raw key line instead - the obvious-looking choice - decodes to
 * 42 bytes of key material that `PublicKey::decode` cannot read, and every update
 * fails verification at runtime. `minisign_verify::PublicKey::from_base64` *does*
 * accept the raw key, which makes this easy to get backwards; the plugin does not
 * use that function. See test_inner_key_line_is_not_a_valid_config_pubkey.
 */
function publicKeyForConfig(file) {
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (!raw) throw new Error(`public key file is empty: ${file}`);

  // A tauri-generated key is a single base64 blob encoding the whole box; a
  // minisign-CLI key is plain text and must be encoded first.
  const encoded = /^untrusted comment:/i.test(raw)
    ? Buffer.from(raw, 'utf-8').toString('base64')
    : raw;

  // Reproduce the updater's own parse (verify_signature() in tauri-plugin-updater
  // does base64_to_string then PublicKey::decode) so a bad key fails here instead
  // of on every player's machine.
  const box = Buffer.from(encoded, 'base64').toString('utf-8');
  const lines = box
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2 || !/^untrusted comment:/i.test(lines[0])) {
    throw new Error(
      `${file} does not contain a minisign PublicKeyBox ` +
        '(expected an "untrusted comment:" line followed by a base64 key line, ' +
        'base64-encoded as a whole)'
    );
  }
  return encoded;
}

async function main() {
  if (!fs.existsSync(pubKeyPath)) {
    console.error(`Missing public key file: ${pubKeyPath}`);
    console.error(
      'Generate one with: npm run tauri signer generate -w src-tauri/.secrets/updater.key'
    );
    process.exit(1);
  }

  let pubKey;
  try {
    pubKey = publicKeyForConfig(pubKeyPath);
  } catch (err) {
    console.error(`Invalid public key file: ${pubKeyPath}\n  ${err.message}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  config.plugins = config.plugins || {};
  config.plugins.updater = config.plugins.updater || {};
  config.plugins.updater.pubkey = pubKey;

  // Repoint the updater when the environment asks for it. Unset locally, the
  // endpoint committed in tauri.conf.json is left alone.
  //
  // Note this only ever writes; it does not restore the previous value. An
  // override is meant for a build/CI run, so reset the committed endpoint with
  // git if you point it at a scratch host.
  const endpoint = process.env.TAURI_UPDATER_ENDPOINT;
  if (endpoint) {
    config.plugins.updater.endpoints = [endpoint];
    console.log(`Updater endpoint set to: ${endpoint}`);
  }

  // Format with Prettier so this script cannot leave tauri.conf.json in a state
  // that fails `npm run format:check` in CI. Writing raw JSON.stringify output
  // expands arrays onto multiple lines, which Prettier then collapses again.
  const prettier = require('prettier');
  const formatted = await prettier.format(JSON.stringify(config, null, 2) + '\n', {
    ...(await prettier.resolveConfig(configPath)),
    filepath: configPath,
  });

  const current = fs.readFileSync(configPath, 'utf-8');
  if (current === formatted) {
    console.log(`Updater public key already up to date in ${configPath}`);
    return;
  }

  fs.writeFileSync(configPath, formatted);
  console.log(`Synced updater public key into ${configPath}`);
}

main().catch((err) => {
  console.error(`Failed to sync updater public key: ${err}`);
  process.exit(1);
});
