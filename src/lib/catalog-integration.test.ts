/// <reference types="node" />
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(() => Promise.reject(new Error('No override file'))),
  writeTextFile: vi.fn(),
  BaseDirectory: { AppData: 'AppData', AppLocalData: 'AppLocalData' },
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: (url: string, init?: RequestInit) => globalThis.fetch(url, init),
}));

function serveExamples(): Promise<{ server: http.Server; origin: string }> {
  const examplesDir = path.resolve(import.meta.dirname, '../../examples');
  return new Promise((resolve, reject) => {
    const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
      const filePath = path.join(examplesDir, req.url ?? '');
      fs.readFile(filePath, (err: NodeJS.ErrnoException | null, data: Buffer) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

describe('catalog integration against local example server', () => {
  let server: http.Server;
  let origin: string;

  beforeAll(async () => {
    const started = await serveExamples();
    server = started.server;
    origin = started.origin;
    vi.stubEnv('VITE_CDN_ORIGIN', origin);
    vi.stubEnv('DEV', false);
  }, 10000);

  afterAll(() => {
    server?.close();
  });

  it('loads the remote catalog and resolves the example game manifest', async () => {
    const service = await import('./catalog-service');
    const result = await service.loadCatalog();

    expect(result.source).toBe('remote');
    expect(result.catalog.games.length).toBeGreaterThan(0);
    expect(result.catalog.games.some((g) => g.id === 'misspell')).toBe(true);
    expect(result.games.length).toBeGreaterThan(0);
    expect(result.games.some((g) => g.id === 'misspell')).toBe(true);
  });
});
