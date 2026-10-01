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
 *
 * Keys must be produced by `tauri signer generate`, not by the `minisign` CLI.
 * The Tauri CLI base64-decodes the key before parsing it, and the Rust minisign
 * crate it uses rejects the empty-password key format that `minisign -G` writes
 * ("Wrong password for that key"). See `secret_key()` in tauri-cli's
 * helpers/updater_signature.rs.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const secretKeyPath = path.join(repoRoot, 'src-tauri', '.secrets', 'updater.key');
const publicKeyPath = path.join(repoRoot, 'src-tauri', 'updater.pub');
const configPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');

/** Resolve the Tauri CLI from node_modules so no global install is needed. */
function tauriBin() {
  const name = process.platform === 'win32' ? 'tauri.cmd' : 'tauri';
  return path.join(repoRoot, 'node_modules', '.bin', name);
}

function runTauri(args, opts = {}) {
  return spawnSync(tauriBin(), args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
}

/**
 * Read the public key in the form `plugins.updater.pubkey` expects.
 *
 * `verify_signature()` in tauri-plugin-updater base64-decodes this value and then
 * parses the decoded text with `minisign_verify::PublicKey::decode`, so the config
 * holds the **base64 of a whole PublicKeyBox** - the `untrusted comment:` line plus
 * the key line.
 *
 * `tauri signer generate` writes `updater.pub` in exactly that form already, so it
 * is used verbatim. A `minisign`-CLI key file is plain text and must be encoded
 * first. Must stay in step with `publicKeyForConfig` in sync-updater-key.cjs.
 */
function publicKeyBody(file) {
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (!raw) return null;
  return /^untrusted comment:/i.test(raw) ? Buffer.from(raw, 'utf-8').toString('base64') : raw;
}

/**
 * Read the secret key in the base64 form the Tauri CLI decodes.
 *
 * A `tauri signer generate` key is already a single base64 blob. A minisign-CLI key
 * is plain text starting with an `untrusted comment:` header and must be encoded
 * first, otherwise the CLI fails with
 * "failed to decode base64 secret key: Invalid symbol 32, offset 9"
 * (offset 9 is the space in that header).
 *
 * Never log the returned value.
 */
function secretKeyBody(file) {
  const raw = fs.readFileSync(file, 'utf-8').trim();
  if (!raw) return null;
  return /^untrusted comment:/i.test(raw) ? Buffer.from(raw, 'utf-8').toString('base64') : raw;
}

/**
 * Confirm the Tauri CLI can actually sign with the secret key.
 *
 * This is the check that matters, and it uses only the documented tooling: the
 * same `tauri signer sign` command `tauri build` runs internally. A key in the
 * wrong format fails here with a precise error instead of silently producing an
 * unsigned release.
 *
 * Signature *verification* is deliberately not done here. The minisign CLI
 * rejects the untrusted comment Tauri writes ("Untrusted signature comment too
 * long" on minisign 0.12), so it cannot verify a Tauri signature at all. The
 * pubkey side is covered properly by src-tauri/tests/updater_signing_tests.rs,
 * which parses it with `minisign-verify` - the same crate the updater plugin
 * uses at runtime.
 */
function verifySigningWorks() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'keys-check-'));
  const probe = path.join(tmp, 'probe.bin');
  fs.writeFileSync(probe, 'pandawan updater signing check');

  const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY: secretKeyBody(secretKeyPath) };
  // Must always be defined: `tauri signer sign` reads the password via clap's
  // `env = "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"`, and when the variable is absent
  // it prompts interactively instead of failing. An explicit empty string is how
  // "this key has no password" is expressed, and it is what a password-less key
  // generated with `tauri signer generate --ci` expects.
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '';

  try {
    const signed = runTauri(['signer', 'sign', probe], {
      stdio: 'inherit',
      env,
      timeout: 60000,
      // Never inherit a TTY: if the password is wrong the CLI would prompt and hang.
      input: '',
    });
    if (signed.status !== 0 || !fs.existsSync(`${probe}.sig`)) {
      return {
        ok: false,
        detail:
          'the Tauri CLI could not sign with this secret key. It must be the base64 form ' +
          'written by `npm run tauri signer generate`, and TAURI_SIGNING_PRIVATE_KEY_PASSWORD ' +
          'must match the key if one was set',
      };
    }
    return { ok: true };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const shouldGenerate = process.argv.includes('--generate');

  const hasSecret = fs.existsSync(secretKeyPath);
  const hasPublic = fs.existsSync(publicKeyPath);

  if (shouldGenerate) {
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
          'npm run keys:generate'
      );
      process.exit(1);
    }

    fs.mkdirSync(path.dirname(secretKeyPath), { recursive: true });

    // `tauri signer generate` writes updater.key AND updater.key.pub, both
    // base64-encoded. The .pub is moved to src-tauri/updater.pub, the committed
    // location; the secret key stays in the gitignored .secrets directory.
    const res = runTauri(['signer', 'generate', '-w', secretKeyPath, '--ci']);
    if (res.status !== 0) process.exit(res.status ?? 1);

    const generatedPub = `${secretKeyPath}.pub`;
    if (!fs.existsSync(generatedPub)) {
      console.error(`Expected ${generatedPub} to exist after key generation.`);
      process.exit(1);
    }
    fs.copyFileSync(generatedPub, publicKeyPath);
    fs.rmSync(generatedPub);

    console.log('\nKeypair created. Syncing the public key into tauri.conf.json...');
    console.log(
      '\nSet the CI secrets from the base64 file contents (not the raw file):\n' +
        '  gh secret set TAURI_SIGNING_PRIVATE_KEY < src-tauri/.secrets/updater.key\n' +
        '  gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD  # only if the key has one'
    );
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

  if (!hasPublic) {
    // Deliberately not derived from the secret key: updater.pub is committed and
    // every installed launcher pins it, so it can only be restored from git.
    console.error(
      `Missing public key: ${path.relative(repoRoot, publicKeyPath)}\n` +
        'It is committed and every installed launcher trusts it, so it cannot be\n' +
        're-derived without invalidating existing installs.\n' +
        'Restore it with: git checkout -- src-tauri/updater.pub'
    );
    process.exit(1);
  }

  console.log('Secret key present:', path.relative(repoRoot, secretKeyPath));

  // Prove the Tauri CLI can sign with this key, using its own documented command.
  const signing = verifySigningWorks();
  if (!signing.ok) {
    console.error(`SIGNING CHECK FAILED: ${signing.detail}.`);
    console.error('The updater cannot publish or verify updates with this keypair.');
    console.error('If the key came from the `minisign` CLI, regenerate it with');
    console.error('`npm run keys:generate` (safe only if no release has shipped).');
    process.exit(1);
  }
  console.log('Signing check OK: the Tauri CLI signed a probe file with this key.');

  // Confirm the public key actually reached the Tauri config.
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  if (config.plugins?.updater?.pubkey !== publicKeyBody(publicKeyPath)) {
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
