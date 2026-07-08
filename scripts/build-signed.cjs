const { spawn } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const projectRoot = resolve(__dirname, '..');
const secretKeyPath = resolve(projectRoot, 'src-tauri', '.secrets', 'updater.key');

const sync = spawn('node', [resolve(__dirname, 'sync-updater-key.cjs')], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

sync.on('close', (code) => {
  if (code !== 0) {
    console.error('Failed to sync updater public key.');
    process.exit(code ?? 1);
  }

  if (!existsSync(secretKeyPath)) {
    console.error(
      `Missing updater secret key: ${secretKeyPath}\n` +
        'Place your minisign secret key at that path or set TAURI_SIGNING_PRIVATE_KEY.'
    );
    process.exit(1);
  }

  const privateKey = readFileSync(secretKeyPath, 'utf-8').trim();
  if (!privateKey) {
    console.error(`Updater secret key file is empty: ${secretKeyPath}`);
    process.exit(1);
  }

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
