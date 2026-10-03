import { describe, it, expect } from 'vitest';

import { exitCodeFromDone } from './api';

// The catalog create/delete path used to send `{ ok: false, error }` with no
// `code`, and the client read that as exit code 0: a rejected publish rendered
// as "Finished with exit code 0".
describe('exitCodeFromDone', () => {
  it('reads a success frame', () => {
    expect(exitCodeFromDone('{"code":0}')).toBe(0);
    expect(exitCodeFromDone('{"ok":true,"code":0}')).toBe(0);
  });

  it('reads a failure frame', () => {
    expect(exitCodeFromDone('{"code":1}')).toBe(1);
    expect(exitCodeFromDone('{"ok":false,"code":1,"error":"upload failed"}')).toBe(1);
  });

  it('treats a codeless ok:false frame as failure', () => {
    expect(exitCodeFromDone('{"ok":false,"error":"upload failed"}')).toBe(1);
  });

  it('treats an empty or malformed frame as success, matching the old behaviour', () => {
    expect(exitCodeFromDone('')).toBe(0);
    expect(exitCodeFromDone('not json')).toBe(0);
    expect(exitCodeFromDone('null')).toBe(0);
  });
});
