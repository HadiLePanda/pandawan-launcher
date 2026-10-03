import { describe, it, expect } from 'vitest';

import {
  SITE_PREFERRED,
  SITE_PLATFORM_NAMES,
  SITE_PLATFORMS,
  artifactExtension,
  artifactFilename,
  parseAheadCount,
  parseGitRemote,
  parsePagesDeployments,
  parsePorcelain,
  siteGitSummary,
  siteMissingMessage,
  summariseDownloads,
} from './website-status.mjs';

const CDN = 'https://pub-789d1bb0f3da4a99ae1024d53ea305d3.r2.dev/launcher';

// The document publish-launcher.mjs actually wrote for 0.1.0, trimmed to what
// the panel reads. This is the shape the site renders, so a summary that
// disagrees with it would have the panel offering a different file than the page.
const DOWNLOADS_0_1_0 = {
  version: '0.1.0',
  platforms: {
    windows: [
      { label: 'MSI installer', url: `${CDN}/Pandawan.Launcher_0.1.0_x64_en-US.msi` },
      { label: 'EXE installer', url: `${CDN}/Pandawan.Launcher_0.1.0_x64-setup.exe` },
    ],
    macos: [
      { label: 'Disk image', url: `${CDN}/Pandawan.Launcher_0.1.0_universal.dmg` },
      { label: 'App archive', url: `${CDN}/Pandawan.Launcher_0.1.0_universal.app.tar.gz` },
    ],
    linux: [
      { label: 'Debian / Ubuntu', url: `${CDN}/Pandawan.Launcher_0.1.0_amd64.deb` },
      { label: 'Fedora / RHEL', url: `${CDN}/Pandawan.Launcher-0.1.0-1.x86_64.rpm` },
    ],
  },
};

describe('artifactFilename', () => {
  it('takes and decodes the last path segment', () => {
    expect(artifactFilename(`${CDN}/Pandawan.Launcher_0.1.0_x64%20en-US.msi`)).toBe(
      'Pandawan.Launcher_0.1.0_x64 en-US.msi'
    );
  });

  it('drops a query string or fragment before splitting', () => {
    expect(artifactFilename('https://cdn.test/a/setup.exe?token=x')).toBe('setup.exe');
    expect(artifactFilename('https://cdn.test/a/setup.exe#frag')).toBe('setup.exe');
  });

  it('ignores a trailing slash rather than reporting nothing', () => {
    expect(artifactFilename('https://cdn.test/launcher/')).toBe('launcher');
  });

  it('returns the raw segment when the escape is malformed instead of throwing', () => {
    // A status panel must not die because one URL in the document is odd.
    expect(artifactFilename('https://cdn.test/100%-bad.msi')).toBe('100%-bad.msi');
  });

  it('has no filename for a missing or empty url', () => {
    expect(artifactFilename('')).toBeNull();
    expect(artifactFilename(null)).toBeNull();
    expect(artifactFilename(42)).toBeNull();
  });
});

describe('artifactExtension', () => {
  it('lowercases the extension', () => {
    expect(artifactExtension(`${CDN}/App.DMG`)).toBe('.dmg');
    expect(artifactExtension(`${CDN}/universal.app.tar.gz`)).toBe('.gz');
  });

  it('reports no extension for a dotfile or an extensionless name', () => {
    expect(artifactExtension('https://cdn.test/latest')).toBe('');
    expect(artifactExtension('https://cdn.test/.sig')).toBe('');
  });
});

describe('summariseDownloads', () => {
  it('picks the preferred artifact for every platform', () => {
    const summary = summariseDownloads(DOWNLOADS_0_1_0);
    expect(summary.version).toBe('0.1.0');
    expect(summary.platforms.map((p) => p.platform)).toEqual(['windows', 'macos', 'linux']);
    for (const platform of summary.platforms) {
      expect(platform.empty).toBe(false);
      expect(platform.preferred.label).toBe(SITE_PREFERRED[platform.platform]);
      expect(platform.preferred.fallback).toBe(false);
    }
    expect(summary.platforms[0].preferred.filename).toBe('Pandawan.Launcher_0.1.0_x64_en-US.msi');
    expect(summary.platforms[0].preferred.extension).toBe('.msi');
  });

  it('lists the remaining downloads as alternatives, in document order', () => {
    const summary = summariseDownloads(DOWNLOADS_0_1_0);
    expect(summary.platforms[0].alternatives.map((a) => a.label)).toEqual(['EXE installer']);
    expect(summary.platforms[1].alternatives.map((a) => a.extension)).toEqual(['.gz']);
  });

  it('falls back to the first entry and says so when no label matches', () => {
    // Exactly what a renamed label in the publisher looks like. The page falls
    // back to items[0], so the panel must too - and must flag it rather than
    // reporting a "preferred" artifact nobody chose.
    const doc = {
      version: '0.2.0',
      platforms: {
        windows: [
          { label: 'EXE Setup', url: `${CDN}/setup.exe` },
          { label: 'MSI Setup', url: `${CDN}/setup.msi` },
        ],
      },
    };
    const [windows] = summariseDownloads(doc).platforms;
    expect(windows.preferred.label).toBe('EXE Setup');
    expect(windows.preferred.fallback).toBe(true);
    // The .msi is still offered, as an alternative rather than as the lead.
    expect(windows.alternatives.map((a) => a.extension)).toEqual(['.msi']);
  });

  it('prefers the labelled entry wherever it sits, not merely the first one', () => {
    // The site matches on `label`, so a group whose preferred entry is not first
    // still leads with it. Reading position instead of label would have the panel
    // reporting a different file than the Download button serves.
    const doc = {
      version: '0.2.0',
      platforms: {
        windows: [
          { label: 'EXE installer', url: `${CDN}/setup.exe` },
          { label: 'MSI installer', url: `${CDN}/setup.msi` },
        ],
      },
    };
    const [windows] = summariseDownloads(doc).platforms;
    expect(windows.preferred.label).toBe('MSI installer');
    expect(windows.preferred.fallback).toBe(false);
    expect(windows.alternatives.map((a) => a.label)).toEqual(['EXE installer']);
  });

  it('reports a platform with no downloads instead of omitting it', () => {
    // The site renders this card as "Not available yet", so it is something the
    // page is showing and the panel has to be able to say.
    const summary = summariseDownloads({ version: '0.1.0', platforms: { linux: [] } });
    const platforms = Object.fromEntries(summary.platforms.map((p) => [p.platform, p]));
    expect(platforms.windows.empty).toBe(true);
    expect(platforms.windows.preferred).toBeNull();
    expect(platforms.linux.empty).toBe(true);
  });

  it('never marks an empty platform as a fallback', () => {
    for (const platform of summariseDownloads({ platforms: { windows: [] } }).platforms) {
      if (platform.empty) expect(platform.preferred).toBeNull();
    }
  });

  it('keeps an unlisted platform id instead of hiding what the page renders', () => {
    const summary = summariseDownloads({
      version: '0.1.0',
      platforms: { windows: [{ label: 'MSI installer', url: `${CDN}/a.msi` }], freebsd: [] },
    });
    expect(summary.platforms.map((p) => p.platform)).toEqual([
      'windows',
      'macos',
      'linux',
      'freebsd',
    ]);
    const freebsd = summary.platforms.at(-1);
    expect(freebsd.name).toBe('freebsd');
    expect(freebsd.empty).toBe(true);
  });

  it('skips entries with no url rather than rendering an empty button', () => {
    const summary = summariseDownloads({
      version: '0.1.0',
      platforms: {
        windows: [{ label: 'MSI installer' }, null, { label: 'X', url: `${CDN}/a.exe` }],
      },
    });
    const [windows] = summary.platforms;
    expect(windows.count).toBe(1);
    expect(windows.preferred.filename).toBe('a.exe');
  });

  it('survives a document that is not shaped like one', () => {
    for (const doc of [null, undefined, 7, 'text', [], { version: '1' }, { platforms: 'nope' }]) {
      const summary = summariseDownloads(doc);
      expect(Array.isArray(summary.platforms)).toBe(true);
      expect(summary.version === null || typeof summary.version === 'string').toBe(true);
    }
    expect(summariseDownloads({ version: '  0.1.0  ' }).version).toBe('0.1.0');
  });

  it('names the platforms the way the site does', () => {
    expect(SITE_PLATFORM_NAMES.macos).toBe('macOS');
    expect(SITE_PLATFORMS).toEqual(['windows', 'macos', 'linux']);
  });
});

describe('parsePorcelain', () => {
  it('is clean for empty output', () => {
    expect(parsePorcelain('')).toEqual({ dirty: false, changedFiles: 0 });
    expect(parsePorcelain(undefined)).toEqual({ dirty: false, changedFiles: 0 });
  });

  it('is dirty for one untracked file as well as for a modification', () => {
    expect(parsePorcelain('?? run-website.bat')).toEqual({ dirty: true, changedFiles: 1 });
    expect(parsePorcelain(' M app.js\n?? local.log')).toEqual({ dirty: true, changedFiles: 2 });
  });
});

describe('parseAheadCount', () => {
  it('takes the right-hand number of --left-right --count', () => {
    // "<behind>\t<ahead>": the ahead count is the second column.
    expect(parseAheadCount('0\t0')).toBe(0);
    expect(parseAheadCount('3\t7')).toBe(7);
    expect(parseAheadCount('0\n5')).toBe(5);
  });

  it('is null when there is no upstream, rather than zero', () => {
    // rev-list fails without @{upstream}. Reporting 0 would claim the checkout is
    // in step with a remote that does not exist.
    expect(parseAheadCount('')).toBeNull();
    expect(parseAheadCount("fatal: ambiguous argument '@{upstream}'")).toBeNull();
    expect(parseAheadCount('nonsense')).toBeNull();
  });
});

describe('parseGitRemote', () => {
  it('prefers the first remote, as git prints them', () => {
    expect(parseGitRemote('origin\thttps://github.com/HadiLePanda/site.git (fetch)\n')).toBe(
      'https://github.com/HadiLePanda/site.git'
    );
  });

  it('is null with no remote configured', () => {
    expect(parseGitRemote('')).toBeNull();
  });
});

describe('siteGitSummary', () => {
  it('assembles the facts the status row shows', () => {
    const summary = siteGitSummary({
      porcelain: '',
      branch: 'main',
      commit: '5fae695',
      subject: 'docs: correct the README',
      ahead: 0,
      remote: 'https://github.com/HadiLePanda/site.git',
    });
    expect(summary).toEqual({
      branch: 'main',
      commit: '5fae695',
      subject: 'docs: correct the README',
      dirty: false,
      changedFiles: 0,
      ahead: 0,
      remote: 'https://github.com/HadiLePanda/site.git',
    });
  });

  it('keeps "no upstream" distinguishable from "in step"', () => {
    expect(siteGitSummary({ porcelain: '', ahead: null }).ahead).toBeNull();
    expect(siteGitSummary({ porcelain: '', ahead: 0 }).ahead).toBe(0);
  });

  it('reports missing facts as null, not as a blank string', () => {
    const summary = siteGitSummary();
    expect(summary).toEqual({
      branch: null,
      commit: null,
      subject: null,
      dirty: false,
      changedFiles: 0,
      ahead: null,
      remote: null,
    });
  });

  it('counts a dirty tree from the porcelain it is given', () => {
    expect(siteGitSummary({ porcelain: '?? run-website.bat' }).changedFiles).toBe(1);
  });
});

describe('parsePagesDeployments', () => {
  // One real entry from `wrangler pages deployment list --project-name
  // pandawan-launcher-site --json`, field names and all.
  const WRANGLER_JSON = JSON.stringify(
    [
      {
        Id: 'd47b8714-f9a3-4479-b383-5f13369b0101',
        Environment: 'Production',
        Branch: 'main',
        Source: '5fae695',
        Deployment: 'https://d47b8714.pandawan-launcher-site.pages.dev',
        Status: '1 day ago',
        Build: 'https://dash.cloudflare.com/acct/pages/view/pandawan-launcher-site/d47b8714',
      },
    ],
    null,
    2
  );

  it('hoists the newest deployment and keeps the short sha', () => {
    // Source is what answers "is what is live the same as what is checked out",
    // which is the fact that makes a deploy decision obvious.
    const { deployments, latest, error } = parsePagesDeployments(WRANGLER_JSON);
    expect(error).toBeNull();
    expect(deployments).toHaveLength(1);
    expect(latest.source).toBe('5fae695');
    expect(latest.environment).toBe('Production');
    expect(latest.url).toBe('https://d47b8714.pandawan-launcher-site.pages.dev');
  });

  it('recovers a list printed behind a banner or a warning', () => {
    // wrangler suppresses its banner for --json, but an older build or a logged
    // warning in front of the array would otherwise read as "no Cloudflare CLI".
    const noisy = `▲ [WARNING] Using legacy config\n${WRANGLER_JSON}`;
    expect(parsePagesDeployments(noisy).latest.source).toBe('5fae695');
  });

  it('treats no deployments as an empty list, not an error', () => {
    // A project that has never been deployed is a real state worth showing.
    expect(parsePagesDeployments('[]')).toEqual({ deployments: [], latest: null, error: null });
  });

  it('reports the reason when the output is not a deployment list', () => {
    // wrangler's own first line, not a parser message: it is the part an
    // operator can act on, and it does not echo the whole error page.
    expect(parsePagesDeployments('error: not logged in').error).toBe(
      'wrangler printed something that is not a deployment list: error: not logged in'
    );
    expect(parsePagesDeployments('{ not json }').error).toMatch(/not a deployment list/);
  });

  it('caps a very long unreadable line', () => {
    const error = parsePagesDeployments(`error: ${'x'.repeat(5000)}`).error;
    expect(error.length).toBeLessThan(300);
    expect(error.endsWith('...')).toBe(true);
  });

  it('treats empty output as an empty list', () => {
    expect(parsePagesDeployments('   ')).toEqual({ deployments: [], latest: null, error: null });
  });

  it('drops entries with no id rather than showing a blank row', () => {
    const { deployments } = parsePagesDeployments(
      JSON.stringify([{ Branch: 'main' }, { Id: 'a' }])
    );
    expect(deployments.map((d) => d.id)).toEqual(['a']);
  });

  it('rejects a JSON document that is not an array', () => {
    // A future wrangler that returns an object must read as unreadable, not as a
    // project with zero deployments.
    expect(parsePagesDeployments('{"result":[]}').error).toMatch(/not a deployment list/);
  });
});

describe('siteMissingMessage', () => {
  it('names the path that was checked', () => {
    // The real failure is nearly always a clone beside the wrong parent folder,
    // so the path is the part of the message that fixes it.
    const message = siteMissingMessage('C:\\code\\pandawan-launcher-site');
    expect(message).toContain('C:\\code\\pandawan-launcher-site');
    expect(message).toContain('../pandawan-launcher-site');
  });
});
