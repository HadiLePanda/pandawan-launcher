#!/usr/bin/env node
/**
 * Check (or bootstrap) the minisign keypair that signs launcher updates.
 *
 *   npm run keys:check      verify the keypair and that the public key is synced
 *   npm run keys:generate   generate one, but only if none exists
 *
 * The public key is committed and the secret key is gitignored, so they are easy
 * to lose or overwrite. Regenerating invalidates every bundle already signed, so
 * --generate refuses when a secret key is present.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const os = require('os');

const repoRoot = path.resolve(__dirname, '..');
const secretKeyPath = path.join(repoRoot, 'src-tauri', '.secrets', 'updater.key');
const publicKeyPath = path.join(repoRoot, 'src-tauri', 'updater.pub');
const configPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');

const MINISIGN_HINT =
  'minisign not found. Install it with:\n' +
  '  winget install jedisct1.minisign\n' +
  'or see https://jedisct1.github.io/minisign/';

function findMinisign() {
  for (const candidate of ['minisign', 'minisign.exe']) {
    if (!spawnSync(candidate, ['-v'], { stdio: 'ignore' }).error) return candidate;
  }
  return null;
}

function publicKeyBody(file) {
  const lines = fs.readFileSync(file, 'utf-8').trim().split(/\r?\n/);
  return lines[1] ? lines[1].trim() : null;
}

function main() {
  const shouldGenerate = process.argv.includes('--generate');
  const minisign = findMinisign();

  const hasSecret = fs.existsSync(secretKeyPath);
  const hasPublic = fs.existsSync(publicKeyPath);

  if (shouldGenerate) {
    if (!minisign) {
      console.error(MINISIGN_HINT);
      process.exit(1);
    }
    if (hasSecret) {
      // Refuse: overwriting the secret key would break every previously
      // signed release, and the new public key would no longer match the
      // one players' launchers already trust.
      console.error(
        'A secret key already exists at:\n' +
          `  ${path.relative(repoRoot, secretKeyPath)}\n` +
          'Refusing to overwrite it. Regenerating invalidates every bundle\n' +
          'signed with the current key.\n' +
          'If you truly need a new keypair, back up that file first, then run\n' +
          'minisign -G -W -f -s src-tauri/.secrets/updater.key -p src-tauri/updater.pub'
      );
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(secretKeyPath), { recursive: true });
    console.log('Generating a new minisign keypair...');

    // Tauri does not accept the raw minisign file in TAURI_SIGNING_PRIVATE_KEY.
    // It base64-decodes the value, and the file's first line is
    // "untrusted comment: ..." — the space at offset 9 fails with
    // "Invalid symbol 32", signing is skipped without error, and the release
    // ships with no .sig and no latest.json. CI then reports
    // "Signature not found for the updater JSON. Skipping upload".
    const encoded = fs.readFileSync(secretKeyPath).toString('base64').trim();
    console.log('\nSet the CI secret with the base64 form, not the raw file:');
    console.log(
      "  node -e \"process.stdout.write(require('fs').readFileSync('" +
        path.relative(repoRoot, secretKeyPath).replace(/\\/g, '/') +
        "').toString('base64'))\" | gh secret set TAURI_SIGNING_PRIVATE_KEY"
    );
    void encoded;

    const res = spawnSync(minisign, ['-G', '-W', '-s', secretKeyPath, '-p', publicKeyPath], {
      stdio: 'inherit',
    });
    if (res.status !== 0) process.exit(res.status ?? 1);
    console.log('\nKeypair created. Syncing the public key into tauri.conf.json...');
    return syncIntoConfig();
  }

  if (!hasSecret && !hasPublic) {
    console.error('No keypair found.');
    console.error('Run `npm run keys:generate` to create one.');
    process.exit(1);
  }

  if (!hasSecret) {
    console.error(`Missing secret key: ${path.relative(repoRoot, secretKeyPath)}`);
    console.error('It is gitignored, so a fresh clone will not have it.');
    console.error('Copy it from your backup, or run `npm run keys:generate` if');
    console.error('no release has shipped yet (old signatures will stop working).');
    process.exit(1);
  }

  console.log('Secret key present:', path.relative(repoRoot, secretKeyPath));

  if (!hasPublic) {
    console.log('Public key missing; deriving it from the secret key...');
    if (!minisign) {
      console.error(MINISIGN_HINT);
      process.exit(1);
    }
    const res = spawnSync(minisign, ['-R', '-W', '-s', secretKeyPath, '-p', publicKeyPath], {
      stdio: 'inherit',
    });
    if (res.status !== 0) process.exit(res.status ?? 1);
  }

  // The secret key can derive a public key; that is the authoritative check
  // that the committed public key still matches the signing key.
  if (minisign) {
    const derivedPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ms-')), 'd.pub');
    const res = spawnSync(minisign, ['-R', '-W', '-s', secretKeyPath, '-p', derivedPath], {
      stdio: 'ignore',
    });
    if (res.status !== 0) {
      console.error('Could not read the secret key (wrong password, or corrupt).');
      process.exit(1);
    }
    const derived = publicKeyBody(derivedPath);
    const committed = publicKeyBody(publicKeyPath);
    fs.rmSync(path.dirname(derivedPath), { recursive: true, force: true });

    if (derived !== committed) {
      console.error('MISMATCH: the public key does not match the secret key.');
      console.error('  derived:  ', derived);
      console.error('  committed:', committed);
      console.error('Run `npm run sync:updater-key` after fixing updater.pub.');
      process.exit(1);
    }
    console.log('Keypair OK: updater.pub matches the secret key.');
  } else {
    console.warn('minisign not found; skipped the keypair verification.');
    console.warn(MINISIGN_HINT);
  }

  // Confirm the public key actually reached the Tauri config.
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const configured = config.plugins?.updater?.pubkey;
  if (configured !== publicKeyBody(publicKeyPath)) {
    console.log('Public key is not synced into tauri.conf.json yet; syncing...');
    return syncIntoConfig();
  }
  console.log('updater.pub is synced into tauri.conf.json.');
}

function syncIntoConfig() {
  const res = spawnSync(process.execPath, [path.join(__dirname, 'sync-updater-key.cjs')], {
    stdio: 'inherit',
  });
  process.exit(res.status ?? 0);
}

main();
