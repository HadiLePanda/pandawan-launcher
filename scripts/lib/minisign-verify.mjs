/**
 * Verifying a published document against the release key, from Node.
 *
 * The launcher verifies in Rust (`manifest_signature.rs`). The publishers need
 * the same check before they merge and re-sign what is already in the bucket:
 * without it, an entry an R2 writer planted is copied into a freshly signed
 * document, so the signature launders the attack instead of stopping it.
 *
 * `tauri signer` has no verify subcommand, so this reproduces what the
 * `minisign-verify` crate does: decode the base64 box the CLI writes, then check
 * the Ed25519 signature. A signature whose algorithm is `ED` covers the
 * BLAKE2b-512 prehash; `Ed` covers the bytes themselves.
 */

import { readFileSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';

/** DER prefix for an Ed25519 SubjectPublicKeyInfo. minisign stores the bare key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** A box is either base64-wrapped (what the CLI writes) or already plain text. */
function decodeBox(text) {
  const trimmed = String(text).trim();
  if (!trimmed) throw new Error('empty box');
  return /^untrusted comment:/i.test(trimmed)
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf-8');
}

function boxLines(box) {
  return box
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function decodePublicKey(publicKeyBox) {
  const keyLine = boxLines(decodeBox(publicKeyBox)).find(
    (line) => !/^untrusted comment:/i.test(line)
  );
  if (!keyLine) throw new Error('public key box has no key line');
  const bytes = Buffer.from(keyLine, 'base64');
  if (bytes.length !== 42) throw new Error(`public key is ${bytes.length} bytes, expected 42`);
  return {
    algorithm: bytes.subarray(0, 2).toString('latin1'),
    keyId: bytes.subarray(2, 10),
    key: bytes.subarray(10),
  };
}

export function decodeSignature(signatureBox) {
  // The first base64 line is the file signature; the second covers the trusted
  // comment and is not what this checks.
  const sigLine = boxLines(decodeBox(signatureBox)).find(
    (line) => !/^(untrusted|trusted) comment:/i.test(line)
  );
  if (!sigLine) throw new Error('signature box has no signature line');
  const bytes = Buffer.from(sigLine, 'base64');
  if (bytes.length !== 74) throw new Error(`signature is ${bytes.length} bytes, expected 74`);
  return {
    algorithm: bytes.subarray(0, 2).toString('latin1'),
    keyId: bytes.subarray(2, 10),
    signature: bytes.subarray(10),
  };
}

/** Whether `data` carries a valid signature from the holder of `publicKeyBox`. */
export function verifySignedBytes(data, signatureBox, publicKeyBox) {
  try {
    const publicKey = decodePublicKey(publicKeyBox);
    const signature = decodeSignature(signatureBox);
    if (publicKey.algorithm !== 'Ed' || !signature.keyId.equals(publicKey.keyId)) return false;
    if (signature.algorithm !== 'ED' && signature.algorithm !== 'Ed') return false;

    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey.key]),
      format: 'der',
      type: 'spki',
    });
    const message =
      signature.algorithm === 'ED'
        ? createHash('blake2b512').update(data).digest()
        : data;
    return verify(null, message, key, signature.signature);
  } catch {
    return false;
  }
}

/** Convenience for a file, the `.sig` beside it, and the pinned public key. */
export function verifySignedFile(filePath, signaturePath, publicKeyPath) {
  return verifySignedBytes(
    readFileSync(filePath),
    readFileSync(signaturePath, 'utf-8'),
    readFileSync(publicKeyPath, 'utf-8')
  );
}
