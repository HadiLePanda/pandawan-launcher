const { spawn } = require('node:child_process');
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const projectRoot = resolve(__dirname, '..');
const secretKeyPath = resolve(projectRoot, 'src-tauri', '.secrets', 'updater.key');
const isWindows = process.platform === 'win32';

function run(command, args, options) {
  // On Windows, spawn the command through cmd.exe so .cmd binaries in
  // node_modules/.bin resolve without needing shell: true.
  if (isWindows) {
    return spawn('cmd', ['/c', command, ...args], options);
  }
  return spawn(command, args, options);
}

const sync = run('node', [resolve(__dirname, 'sync-updater-key.cjs')], {
  cwd: projectRoot,
  stdio: 'inherit',
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

  const build = run('tauri', ['build'], {
    cwd: resolve(projectRoot, 'src-tauri'),
    stdio: 'inherit',
    env: {
      ...process.env,
      TAURI_SIGNING_PRIVATE_KEY: privateKey,
    },
  });

  build.on('close', (buildCode) => {
    process.exit(buildCode ?? 0);
  });
});
