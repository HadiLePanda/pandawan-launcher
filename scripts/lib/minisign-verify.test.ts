import { describe, it, expect } from 'vitest';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

import { verifySignedBytes } from './minisign-verify.mjs';

// A minisign box is key id + Ed25519 material. The id is arbitrary here.
const KEY_ID = Buffer.from('0102030405060708', 'hex');

function publicBox(publicKey: KeyObject): string {
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return [
    'untrusted comment: minisign public key: 0102030405060708',
    Buffer.concat([Buffer.from('Ed'), KEY_ID, raw]).toString('base64'),
  ].join('\n');
}

function signatureBox(
  privateKey: KeyObject,
  data: Buffer,
  { prehashed = true }: { prehashed?: boolean } = {}
): string {
  const algorithm = prehashed ? 'ED' : 'Ed';
  const message = prehashed ? createHash('blake2b512').update(data).digest() : data;
  return [
    'untrusted comment: signature from test key',
    Buffer.concat([Buffer.from(algorithm), KEY_ID, sign(null, message, privateKey)]).toString(
      'base64'
    ),
    'trusted comment: test',
    Buffer.alloc(64).toString('base64'),
  ].join('\n');
}

describe('minisign verification', () => {
  const data = Buffer.from('{"version":"1.2.3"}');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyText = publicBox(publicKey);

  it('accepts the prehashed form tauri writes', () => {
    expect(verifySignedBytes(data, signatureBox(privateKey, data), publicKeyText)).toBe(true);
  });

  it('accepts a legacy signature over the bytes themselves', () => {
    const signature = signatureBox(privateKey, data, { prehashed: false });
    expect(verifySignedBytes(data, signature, publicKeyText)).toBe(true);
  });

  it('rejects changed bytes', () => {
    const signature = signatureBox(privateKey, data);
    expect(verifySignedBytes(Buffer.from('{"version":"9.9.9"}'), signature, publicKeyText)).toBe(
      false
    );
  });

  it('rejects a signature from another key', () => {
    const other = generateKeyPairSync('ed25519');
    const signature = signatureBox(other.privateKey, data);
    expect(verifySignedBytes(data, signature, publicKeyText)).toBe(false);
  });

  it('accepts the base64-wrapped box form', () => {
    // This is what `tauri signer sign` writes next to a file.
    const signature = Buffer.from(signatureBox(privateKey, data), 'utf-8').toString('base64');
    const key = Buffer.from(publicKeyText, 'utf-8').toString('base64');
    expect(verifySignedBytes(data, signature, key)).toBe(true);
  });

  it('answers false instead of throwing on malformed input', () => {
    expect(verifySignedBytes(data, 'not base64!', 'nope')).toBe(false);
  });
});
