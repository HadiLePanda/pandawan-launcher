import { describe, it, expect } from 'vitest';
import { planPrune, readActiveVersion, readPinnedVersions } from '../../scripts/lib/prune-plan.mjs';

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

describe('planPrune on a per-platform channel', () => {
  const PINNED = [
    key('0.4.0/misspell.exe'),
    key('0.4.0/UnityPlayer.dll'),
    key('0.3.9/misspell.exe'),
    key('0.3.8/misspell.exe'),
    key('0.3.7/misspell.exe'),
  ];

  it('protects every platform pin, not only the newest', () => {
    // Windows on 0.4.0, macOS still on 0.3.9. Deleting 0.3.9 would not remove
    // history, it would remove macOS's game entirely.
    const plan = planPrune(PINNED, PREFIX, 1, ['0.4.0', '0.3.9']);
    expect(plan.doomed.map(([v]) => v)).not.toContain('0.3.9');
    expect(plan.protectedVersions.has('0.3.9')).toBe(true);
  });

  it('still accepts a single string for a single-platform channel', () => {
    const plan = planPrune(PINNED, PREFIX, 1, '0.4.0');
    expect(plan.doomed.map(([v]) => v)).not.toContain('0.4.0');
  });
});

describe('planPrune --older-than', () => {
  const now = Date.parse('2026-03-01T00:00:00.000Z');
  const at = (version, modified) => ({
    key: `${PREFIX}/${version}/game.exe`,
    lastModified: modified,
  });

  const AGED = [
    at('0.4.0', '2026-01-01T00:00:00.000Z'),
    at('0.3.0', '2026-01-01T00:00:00.000Z'),
    at('0.2.0', '2026-02-27T00:00:00.000Z'),
  ];

  it('deletes an old build that keep-N would otherwise spare', () => {
    // keep:1 protects only 0.4.0; the age rule is what reaches 0.3.0.
    const plan = planPrune(AGED, PREFIX, 1, null, { olderThanDays: 7, now });
    expect(plan.doomed.map(([v]) => v)).toEqual(['0.3.0']);
  });

  it('leaves a recent build alone even outside keep-N', () => {
    const plan = planPrune(AGED, PREFIX, 1, null, { olderThanDays: 7, now });
    expect(plan.doomed.map(([v]) => v)).not.toContain('0.2.0');
  });

  it('never age-deletes a pinned version', () => {
    const plan = planPrune(AGED, PREFIX, 1, ['0.4.0'], { olderThanDays: 7, now });
    expect(plan.doomed.map(([v]) => v)).not.toContain('0.4.0');
  });

  it('reports what the age rule skipped instead of dropping it silently', () => {
    const plan = planPrune(AGED, PREFIX, 1, null, { olderThanDays: 7, now });
    expect(plan.skippedAsYoung).toContain('0.2.0');
  });

  it('never age-deletes a build it cannot date', () => {
    const plan = planPrune([key('0.4.0/a'), key('0.3.0/a')], PREFIX, 1, null, {
      olderThanDays: 7,
      now,
    });
    // Without a timestamp the age rule cannot judge it, so it is kept rather than
    // guessed at: a missing date must never become a deletion.
    expect(plan.doomed.map(([v]) => v)).toEqual([]);
  });
});

describe('readPinnedVersions', () => {
  it('reads one version per platform', () => {
    expect(
      readPinnedVersions('{"windows":{"version":"0.4.0"},"macos":{"version":"0.3.9"}}')
    ).toEqual({ windows: '0.4.0', macos: '0.3.9' });
  });

  it('returns null on junk or missing input, and an empty map for a flat manifest', () => {
    // Null means "protect nothing", which planPrune handles by keeping the newest.
    expect(readPinnedVersions('nope')).toBeNull();
    expect(readPinnedVersions('{"version":"0.4.0"}')).toEqual({});
    expect(readPinnedVersions(null)).toBeNull();
  });
});
