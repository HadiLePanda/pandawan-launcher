import { describe, it, expect } from 'vitest';

import { buildPublishArgv } from './publish-argv.mjs';

// The form used to send its own argv array and the server forwarded it, so a
// version or an executable name of `--dry-run` stopped being a value and became an
// option the UI never offered. These are the cases that used to smuggle.
describe('buildPublishArgv', () => {
  const full = {
    gameId: 'example-game',
    channel: 'stable',
    version: '1.2.3',
    buildNumber: '42',
    executable: 'Game.exe',
    inputDir: 'C:\\Builds\\game',
    platforms: { windows: 'C:\\Builds\\win' },
    dryRun: true,
  };

  it('builds the flags the publisher takes', () => {
    expect(buildPublishArgv(full)).toEqual({
      argv: [
        '--game-id=example-game',
        '--channel=stable',
        '--version=1.2.3',
        '--build-number=42',
        '--executable=Game.exe',
        '--input-dir=C:\\Builds\\game',
        '--platform=windows=C:\\Builds\\win',
        '--dry-run',
      ],
    });
  });

  it('leaves an empty field out rather than sending it empty', () => {
    // The publisher names what it needs; an empty --input-dir only hides which
    // field the form left blank.
    const { argv } = buildPublishArgv({ gameId: 'g', inputDir: '  ', platforms: {} });
    expect(argv).toEqual(['--game-id=g']);
  });

  it('refuses a value that would be read as a flag', () => {
    for (const field of ['gameId', 'version', 'executable', 'inputDir', 'buildNumber']) {
      const result = buildPublishArgv({ gameId: 'g', [field]: '--force' });
      expect(result, `${field} should be refused`).toEqual({
        error: `${field} must be a value, not a flag`,
      });
    }
  });

  it('refuses a platform directory that would be read as a flag', () => {
    expect(buildPublishArgv({ platforms: { windows: '--yes' } })).toEqual({
      error: 'windows must be a value, not a flag',
    });
    expect(buildPublishArgv({ platforms: { '--yes': 'C:\\Builds' } })).toEqual({
      error: '--yes must be a value, not a flag',
    });
  });

  it('keeps a value that merely starts with a dash', () => {
    // Only `--` is a flag to the parser, so a single dash is ordinary content.
    const { argv } = buildPublishArgv({ version: '-beta' });
    expect(argv).toEqual(['--version=-beta']);
  });

  it('omits --dry-run unless it was asked for', () => {
    const { argv } = buildPublishArgv({ gameId: 'g', dryRun: false });
    expect(argv).not.toContain('--dry-run');
  });

  it('takes a payload that is not an object', () => {
    expect(buildPublishArgv(undefined)).toEqual({ argv: [] });
  });
});
