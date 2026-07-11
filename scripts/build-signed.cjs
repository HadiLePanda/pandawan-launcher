#!/usr/bin/env node
/**
 * Build the Tauri app with the local minisign secret key.
 *
 * 1. Syncs the public key into tauri.conf.json.
 * 2. Loads the gitignored secret key.
 * 3. Runs `tauri build` with TAURI_SIGNING_PRIVATE_KEY set.
 */

const { spawn } = require('child_process');
const { readFileSync, existsSync } = require('fs');
const { resolve } = require('path');

const projectRoot = resolve(__dirname, '..');
const secretKeyPath = resolve(projectRoot, 'src-tauri', '.secrets', 'updater.key');

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
        'Place your minisign secret key at that path or set TAURI_SIGNING_PRIVATE_KEY.'
    );
    process.exit(1);
  }

  // 3. Read secret key and set env var.
  const privateKey = readFileSync(secretKeyPath, 'utf-8').trim();
  if (!privateKey) {
    console.error(`Updater secret key file is empty: ${secretKeyPath}`);
    process.exit(1);
  }

  // 4. Run tauri build with the signing key.
  const build = spawn('tauri', ['build'], {
    cwd: resolve(projectRoot, 'src-tauri'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: privateKey,
    },
  });

  build.on('close', (buildCode) => {
    process.exit(buildCode ?? 0);
  });
});
