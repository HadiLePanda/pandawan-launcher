import { describe, expect, it } from 'vitest';

import { manifestFiles, planUpload } from './upload-plan.mjs';

const platformManifest = (files) => ({ platforms: { windows: { files } } });

describe('upload plan', () => {
  it('uploads every file when nothing is published', () => {
    const plan = planUpload([{ path: 'a.dll', hash: '1' }], []);
    expect(plan.upload).toEqual(['a.dll']);
    expect(plan.skipped).toEqual([]);
  });

  it('skips a file the published manifest already lists with the same hash', () => {
    const files = [
      { path: 'a.dll', hash: '1' },
      { path: 'b.dll', hash: '2' },
    ];
    const plan = planUpload(files, [{ path: 'a.dll', hash: '1' }]);
    expect(plan.upload).toEqual(['b.dll']);
    expect(plan.skipped).toEqual(['a.dll']);
  });

  it('re-uploads a file whose bytes changed', () => {
    const plan = planUpload([{ path: 'a.dll', hash: 'new' }], [{ path: 'a.dll', hash: 'old' }]);
    expect(plan.upload).toEqual(['a.dll']);
  });

  it('uploads a file the published manifest does not mention', () => {
    const plan = planUpload([{ path: 'c.dll', hash: '3' }], [{ path: 'a.dll', hash: '1' }]);
    expect(plan.upload).toEqual(['c.dll']);
  });

  it('does not trust a published entry that has no hash', () => {
    // Skipping on a malformed entry would leave the file missing from the bucket.
    const plan = planUpload([{ path: 'a.dll', hash: '1' }], [{ path: 'a.dll' }]);
    expect(plan.upload).toEqual(['a.dll']);
  });
});

describe('manifest files', () => {
  it('reads the platform list', () => {
    expect(manifestFiles(platformManifest([{ path: 'a.dll' }]), 'windows')).toEqual([
      { path: 'a.dll' },
    ]);
    expect(manifestFiles(platformManifest([{ path: 'a.dll' }]), 'macos')).toEqual([]);
  });

  it('reads the flat list when no platform is given', () => {
    expect(manifestFiles({ files: [{ path: 'x' }] }, null)).toEqual([{ path: 'x' }]);
    expect(manifestFiles({ files: null }, null)).toEqual([]);
  });

  it('yields nothing for a manifest that does not exist', () => {
    expect(manifestFiles(null, 'windows')).toEqual([]);
  });
});
