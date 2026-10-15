import { describe, expect, it } from 'vitest';

import { cacheControlFor, manifestKeys, planResign } from './resign-plan.mjs';

const PREFIX = 'games/example-game/stable';

describe('manifestKeys', () => {
  it('finds the channel root and every version directory', () => {
    const keys = [
      `${PREFIX}/manifest.json`,
      `${PREFIX}/1.0.0/manifest.json`,
      `${PREFIX}/0.4.0/manifest.json`,
      `${PREFIX}/1.0.0/Game.exe`,
    ];
    expect(manifestKeys(keys, PREFIX)).toEqual([
      `${PREFIX}/0.4.0/manifest.json`,
      `${PREFIX}/1.0.0/manifest.json`,
      `${PREFIX}/manifest.json`,
    ]);
  });

  it('ignores a manifest nested inside a build', () => {
    const keys = [`${PREFIX}/1.0.0/Game_Data/manifest.json`, `${PREFIX}/D3D12/manifest.json`];
    expect(manifestKeys(keys, PREFIX)).toEqual([]);
  });

  it('reads the keys listKeysWithMeta returns', () => {
    const keys = [{ key: `${PREFIX}/manifest.json`, lastModified: '2026-01-01' }];
    expect(manifestKeys(keys, PREFIX)).toEqual([`${PREFIX}/manifest.json`]);
  });
});

describe('cacheControlFor', () => {
  it('leaves the channel root uncached and a version directory immutable', () => {
    expect(cacheControlFor(`${PREFIX}/manifest.json`, PREFIX)).toBe('no-cache');
    expect(cacheControlFor(`${PREFIX}/1.0.0/manifest.json`, PREFIX)).toBe('immutable');
  });
});

describe('planResign', () => {
  it('signs the manifests with no signature beside them', () => {
    const keys = [
      `${PREFIX}/manifest.json`,
      `${PREFIX}/1.0.0/manifest.json`,
      `${PREFIX}/1.0.0/manifest.json.sig`,
    ];
    const plan = planResign(keys, PREFIX);
    expect(plan.sign.map((entry) => entry.key)).toEqual([`${PREFIX}/manifest.json`]);
    expect(plan.skip.map((entry) => entry.key)).toEqual([`${PREFIX}/1.0.0/manifest.json`]);
  });

  it('re-signs everything under force', () => {
    const keys = [`${PREFIX}/manifest.json`, `${PREFIX}/manifest.json.sig`];
    const plan = planResign(keys, PREFIX, { force: true });
    expect(plan.sign.map((entry) => entry.key)).toEqual([`${PREFIX}/manifest.json`]);
    expect(plan.skip).toEqual([]);
  });
});
