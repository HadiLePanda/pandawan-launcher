#!/usr/bin/env node
/**
 * Sync the minisign public key from src-tauri/updater.pub into
 * src-tauri/tauri.conf.json so there is a single source of truth.
 *
 * Run automatically before tauri:dev and tauri:build.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const pubKeyPath = path.join(repoRoot, 'src-tauri', 'updater.pub');
const configPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');

function main() {
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

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`Synced updater public key into ${configPath}`);
}

main();
