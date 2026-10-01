import { describe, it, expect } from 'vitest';
import { planPrune, readActiveVersion } from '../../scripts/lib/prune-plan.mjs';

const PREFIX = 'games/misspell/alpha';
const key = (rest) => `${PREFIX}/${rest}`;

const BUILDS = [
  key('0.4.0/UnityPlayer.dll'),
  key('0.4.0/misspell.exe'),
  key('0.3.0/misspell.exe'),
  key('0.2.0/misspell.exe'),
  key('0.1.0/misspell.exe'),
];

describe('planPrune', () => {
  it('keeps the newest N builds and marks the rest for deletion', () => {
    const plan = planPrune(BUILDS, PREFIX, 2, '0.4.0');
    expect(plan.all.map(([v]) => v)).toEqual(['0.4.0', '0.3.0', '0.2.0', '0.1.0']);
    expect(plan.doomed.map(([v]) => v)).toEqual(['0.2.0', '0.1.0']);
  });

  it('never deletes the version the manifest points at, even when old', () => {
    // The manifest can name a build outside the keep window after a rollback.
    // Deleting it breaks every install in progress, which is the one failure this
    // whole function exists to prevent.
    const plan = planPrune(BUILDS, PREFIX, 1, '0.1.0');
    expect(plan.doomed.map(([v]) => v)).not.toContain('0.1.0');
    expect(plan.protectedVersions.has('0.1.0')).toBe(true);
  });

  it('keeps only the newest build when the manifest cannot be read', () => {
    const plan = planPrune(BUILDS, PREFIX, 1, null);
    expect(plan.doomed.map(([v]) => v)).toEqual(['0.3.0', '0.2.0', '0.1.0']);
    expect(plan.doomed.map(([v]) => v)).not.toContain('0.4.0');
  });

  it('never treats a Unity folder as a build', () => {
    // D3D12 contains a 3 and a 1; MonoBleedingEdge and misspell_Data are not
    // versions. Reading either as deletable would wipe live files.
    const withEngineDirs = [
      ...BUILDS,
      key('D3D12/D3D12Core.dll'),
      key('MonoBleedingEdge/etc/'),
      key('misspell_Data/globalgamemanagers'),
      key('latest.json'),
      key('manifest.json'),
    ];

    const plan = planPrune(withEngineDirs, PREFIX, 1, '0.4.0');

    expect(plan.all.map(([v]) => v)).toEqual(['0.4.0', '0.3.0', '0.2.0', '0.1.0']);
    expect(plan.doomed.map(([v]) => v)).not.toContain('D3D12');
  });

  it('never lists the live manifest as a flat leftover', () => {
    // A recursive delete of the channel prefix would take manifest.json with it
    // and break every install.
    const flat = [
      key('manifest.json'),
      key('latest.json'),
      key('D3D12/D3D12Core.dll'),
      key('0.4.0/misspell.exe'),
    ];

    const plan = planPrune(flat, PREFIX, 1, '0.4.0');

    expect(plan.flatLeftovers).not.toContain(key('manifest.json'));
    expect(plan.flatLeftovers).toContain(key('D3D12/D3D12Core.dll'));
    expect(plan.flatLeftovers).toContain(key('latest.json'));
  });

  it('orders versions numerically, not lexically', () => {
    const versions = [key('0.9.0/a'), key('0.10.0/a'), key('0.4.0/a')];
    const plan = planPrune(versions, PREFIX, 1, null);
    // Lexical ordering would put 0.9.0 above 0.10.0 and delete the newer build.
    expect(plan.all[0][0]).toBe('0.10.0');
  });

  it('deletes nothing when there is only the active build', () => {
    const plan = planPrune([key('0.4.0/a')], PREFIX, 3, '0.4.0');
    expect(plan.doomed).toEqual([]);
  });
});

describe('readActiveVersion', () => {
  it('reads the version from manifest JSON', () => {
    expect(readActiveVersion('{"version":"0.4.0"}')).toBe('0.4.0');
  });

  it('returns null rather than throwing on junk or missing input', () => {
    // A malformed manifest must degrade to "keep the newest", never to a crash
    // that skips the prune entirely with no explanation.
    expect(readActiveVersion('not json')).toBeNull();
    expect(readActiveVersion('{}')).toBeNull();
    expect(readActiveVersion(null)).toBeNull();
  });
});
