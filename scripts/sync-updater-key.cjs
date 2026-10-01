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

async function main() {
  if (!fs.existsSync(pubKeyPath)) {
    console.error(`Missing public key file: ${pubKeyPath}`);
    console.error('Generate one with: minisign -G -s <secret.key> -p src-tauri/updater.pub');
    process.exit(1);
  }

  const pubKeyFile = fs.readFileSync(pubKeyPath, 'utf-8').trim().split(/\r?\n/);
  if (pubKeyFile.length < 2 || !pubKeyFile[1]) {
    console.error(`Invalid public key file: ${pubKeyPath}`);
    process.exit(1);
  }

  const pubKey = pubKeyFile[1].trim();

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
