import { mkdtempSync, writeFileSync } from 'node:fs';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSignedDocument } from './signed-document.mjs';

const URL = 'https://cdn.test/launcher/catalog.json';
const KEY_ID = Buffer.from('0102030405060708', 'hex');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');

function publicBox(key: KeyObject): string {
  const raw = key.export({ format: 'der', type: 'spki' }).subarray(-32);
  return [
    'untrusted comment: minisign public key: 0102030405060708',
    Buffer.concat([Buffer.from('Ed'), KEY_ID, raw]).toString('base64'),
  ].join('\n');
}

function signatureBox(key: KeyObject, data: Buffer): string {
  const digest = createHash('blake2b512').update(data).digest();
  return [
    'untrusted comment: signature from test key',
    Buffer.concat([Buffer.from('ED'), KEY_ID, sign(null, digest, key)]).toString('base64'),
    'trusted comment: test',
    Buffer.alloc(64).toString('base64'),
  ].join('\n');
}

function publicKeyFile(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'signed-doc-')), 'test.pub');
  writeFileSync(file, publicBox(publicKey));
  return file;
}

function response(status: number, body: string) {
  return { status, ok: status >= 200 && status < 300, text: async () => body };
}

function mockFetch(routes: Record<string, { status: number; body: string }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const hit = routes[url];
      return hit ? response(hit.status, hit.body) : response(404, '');
    })
  );
}

describe('reading a signed document', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const body = '{"version":"1.2.3"}';
  const signed = signatureBox(privateKey, Buffer.from(body));

  it('returns the text once the signature checks out', async () => {
    mockFetch({
      [URL]: { status: 200, body },
      [`${URL}.sig`]: { status: 200, body: signed },
    });

    await expect(fetchSignedDocument(URL, publicKeyFile())).resolves.toEqual({
      status: 'signed',
      text: body,
    });
  });

  it('refuses a document whose bytes do not match the signature', async () => {
    mockFetch({
      [URL]: { status: 200, body: '{"version":"9.9.9"}' },
      [`${URL}.sig`]: { status: 200, body: signed },
    });

    const result = await fetchSignedDocument(URL, publicKeyFile());
    expect(result.status).toBe('invalid');
  });

  it('reports a document published before signing existed as unsigned', async () => {
    mockFetch({ [URL]: { status: 200, body } });

    await expect(fetchSignedDocument(URL, publicKeyFile())).resolves.toEqual({
      status: 'unsigned',
      text: body,
    });
  });

  it('reports a missing document', async () => {
    mockFetch({});

    await expect(fetchSignedDocument(URL, publicKeyFile())).resolves.toEqual({
      status: 'missing',
    });
  });

  it('reports an HTTP failure on the document or its signature', async () => {
    mockFetch({ [URL]: { status: 500, body: '' } });
    expect((await fetchSignedDocument(URL, publicKeyFile())).status).toBe('error');

    mockFetch({
      [URL]: { status: 200, body },
      [`${URL}.sig`]: { status: 500, body: '' },
    });
    expect((await fetchSignedDocument(URL, publicKeyFile())).status).toBe('error');
  });
});
