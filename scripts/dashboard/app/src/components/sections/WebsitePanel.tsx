/**
 * The Website section: the public download page.
 *
 * The site is a SEPARATE REPOSITORY (pandawan-launcher-site, a sibling checkout)
 * deployed to Cloudflare Pages. Two facts about it are worth stating before
 * anything else, because together they explain why this section exists at all:
 *
 *   1. The page's CONTENT is not in the site repo. It comes from R2, in
 *      `launcher/downloads.json`, which publish-launcher.mjs writes on every
 *      launcher publish and the site proxies through a Pages Function. So
 *      publishing a launcher version changes what the site SHOWS, with no
 *      redeploy - the site's own files are almost never what is stale.
 *   2. The site's CODE does live in its repo, and only a deploy changes it.
 *
 * So the panel leads with WHAT THE SITE CURRENTLY SHOWS - the live downloads.json
 * as real artifact rows, because a raw JSON dump answers "what is in the file"
 * rather than "what would a person download" - and puts last published next to
 * last deployed so an operator can see at a glance whether the two are in step.
 *
 * NOTHING HERE EDITS THE SITE REPO, and nothing deploys without an explicit
 * confirm. `present: false` is a NORMAL state: it is a sibling checkout a
 * developer may simply not have, so the path is shown and the write verbs are
 * disabled, rather than the page reporting a failure.
 *
 * ============================================================================
 * ENDPOINT SHAPES (GET /api/website, POST /api/website/{verify,deploy})
 * ============================================================================
 *
 * The types below are written defensively: every field the panel would
 * otherwise trust is checked before it is rendered:
 *
 *   present      boolean  the site repo is checked out at `path`
 *   path         string   absolute path that was checked
 *   git          the rules in scripts/lib/website-status.mjs:
 *                  { branch, commit, subject, dirty, changedFiles, ahead, remote }
 *                or null when there is no repo to describe
 *   pages        { available: false, reason } when wrangler could not be used,
 *                otherwise { deployments: [...], latest, error } in the shape
 *                parsePagesDeployments returns
 *   downloads    either the parsed downloads.json - accepted BOTH as
 *                summariseDownloads' `{ version, platforms: [...] }` and as the
 *                raw `{ version, platforms: { windows: [{label,url}] } }`, so
 *                the panel does not care which one the server chose to send -
 *                or { error } when the document could not be read.
 *                Entries may carry `resolves` when the server checked the URL;
 *                this panel never claims a URL resolves unless something told it
 *                so, and offers a check of its own for when nothing did.
 *   lastPublished  ISO string, when downloads.json was last written - i.e. the
 *                last launcher publish, NOT the last deploy.
 *
 * An entry with no `url` is skipped rather than rendered as a broken download.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  Rocket,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import { apiGet } from '@/lib/api';
import { ago } from '@/lib/format';
import { platformHue } from '@lib/platform-hue';
import { DataAge } from '@components/ui';
import { usePublisherStream, verdictLine } from '@/panels';

/** One artifact the site offers, after normalisation. */
interface SiteArtifact {
  label: string | null;
  url: string;
  filename: string | null;
  extension: string;
  /** The server's own HEAD check, when it did one. Null means "not checked". */
  resolves: boolean | null;
}

interface SitePlatform {
  platform: string;
  name: string;
  /** True when the document lists nothing for this platform. */
  empty: boolean;
  /** The artifact the page's Download button leads with. */
  preferred: SiteArtifact | null;
  /** The rest of the group: what the page's dropdown offers. */
  alternatives: SiteArtifact[];
  /** True when no entry carried the label the page prefers and it fell back. */
  fallback: boolean;
}

interface SiteGit {
  branch: string | null;
  commit: string | null;
  subject: string | null;
  dirty: boolean;
  changedFiles: number;
  ahead: number | null;
  remote: string | null;
}

interface SiteDeployment {
  id: string;
  environment: string | null;
  branch: string | null;
  /** Short commit the deployment was built from - comparable with git.commit. */
  source: string | null;
  url: string | null;
  status: string | null;
}

interface PagesInfo {
  available: boolean;
  reason?: string | null;
  deployments: SiteDeployment[];
  latest: SiteDeployment | null;
  error?: string | null;
}

interface WebsiteStatus {
  present: boolean;
  path: string;
  /** The Pages project name the server checked, so the panel need not hard-code it. */
  project: string | null;
  git: SiteGit | null;
  pages: PagesInfo;
  downloads: { error?: string | null } | { version: string | null; platforms: SitePlatform[] };
  lastPublished: string | null;
}

type Load =
  | { state: 'loading' }
  | { state: 'ready'; data: WebsiteStatus; ageMs: number | null }
  | { state: 'error'; message: string };

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The filename at the end of a URL, decoded, or null. Guarded: a bad escape throws. */
function filenameOf(url: string): string | null {
  const withoutQuery = url.split('?')[0] ?? '';
  const withoutFragment = withoutQuery.split('#')[0] ?? '';
  const last = withoutFragment.split('/').filter(Boolean).pop();
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function extensionOf(url: string): string {
  const name = filenameOf(url);
  if (!name) return '';
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/**
 * One entry of a downloads group, or null if it is not something a person could
 * click. Anything without a usable URL is skipped rather than rendered: a row
 * that says "Download" and goes nowhere is worse than no row.
 */
function artifactOf(raw: unknown): SiteArtifact | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const url = str(item.url);
  if (!url) return null;
  const explicitFilename = str(item.filename);
  return {
    label: str(item.label),
    url,
    filename: explicitFilename ?? filenameOf(url),
    extension: str(item.extension) ?? extensionOf(url),
    resolves: typeof item.resolves === 'boolean' ? item.resolves : null,
  };
}

/** A platform group, from either document shape. */
function platformFrom(id: string, raw: unknown, name: string, fallbackHint: string): SitePlatform {
  // Shape C, and the one the server actually sends: summariseDownloads emits a
  // `{ preferred, alternatives }` record per platform, having already applied the
  // site's PREFERRED-label rule and any HEAD check. Handled first because the two
  // array shapes are what a raw downloads.json looks like, and neither of those
  // is what arrives over HTTP.
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    if ('preferred' in record || 'alternatives' in record || 'empty' in record) {
      const preferred = artifactOf(record.preferred);
      const alternatives = Array.isArray(record.alternatives)
        ? record.alternatives
            .map(artifactOf)
            .filter((entry): entry is SiteArtifact => entry !== null)
        : [];
      // `empty` is the server's own verdict; a missing `preferred` with a
      // non-empty count would otherwise read as "nothing published" when the
      // truth is "published but every entry was unusable".
      if (!preferred) {
        return {
          platform: id,
          name,
          empty: true,
          preferred: null,
          alternatives,
          fallback: false,
        };
      }
      return {
        platform: id,
        name,
        empty: false,
        preferred,
        alternatives,
        // The server reports the renamed-label case per PLATFORM, not per
        // artifact - summariseDownloads puts it on the platform record because it
        // is a property of "no entry carried the expected label", which is a fact
        // about the set rather than about one file.
        fallback: record.fallback === true,
      };
    }
  }

  // Shape A: the array form summariseDownloads produces.
  if (Array.isArray(raw)) {
    const wanted = fallbackHint;
    const all = raw.map(artifactOf).filter((a): a is SiteArtifact => a !== null);
    if (all.length === 0) {
      return {
        platform: id,
        name,
        empty: true,
        preferred: null,
        alternatives: [],
        fallback: false,
      };
    }
    const index = wanted ? all.findIndex((entry) => entry.label === wanted) : -1;
    // `all` is non-empty here, and noUncheckedIndexedAccess cannot see that, so
    // the head is named rather than asserted.
    const head = all[0] as SiteArtifact;
    const chosen = index === -1 ? head : (all[index] ?? head);
    return {
      platform: id,
      name,
      empty: false,
      preferred: chosen,
      alternatives: all.filter((entry) => entry !== chosen),
      fallback: index === -1,
    };
  }

  // Shape B: the raw downloads.json, `{ platforms: { windows: [...] } }`.
  const entries = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!entries) {
    return { platform: id, name, empty: true, preferred: null, alternatives: [], fallback: false };
  }
  return platformFrom(id, Array.isArray(entries.items) ? entries.items : [], name, fallbackHint);
}

/** The labels the site leads with, per platform. Mirrors SITE_PREFERRED. */
const PREFERRED: Record<string, string> = {
  windows: 'MSI installer',
  macos: 'Disk image',
  linux: 'Debian / Ubuntu',
};

const PLATFORM_NAMES: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

const PLATFORM_ORDER = ['windows', 'macos', 'linux'];

/**
 * The downloads document as platform rows.
 *
 * Both shapes are accepted on purpose - see the header. Raw `platforms` is a
 * MAP of id to array; the summarised form is an ARRAY of objects that already
 * carry a display name. Distinguishing them by shape rather than by a field is
 * what lets the panel survive either server implementation.
 */
function parseDownloads(downloads: unknown): {
  version: string | null;
  platforms: SitePlatform[];
  error: string | null;
} {
  if (!downloads || typeof downloads !== 'object') {
    return { version: null, platforms: [], error: null };
  }
  const doc = downloads as Record<string, unknown>;
  if (str(doc.error)) return { version: null, platforms: [], error: str(doc.error) };

  const version = str(doc.version);
  const raw = doc.platforms;

  if (Array.isArray(raw)) {
    const platforms: SitePlatform[] = [];
    for (const [index, entry] of raw.entries()) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      const id = str(item.platform) ?? str(item.id) ?? `platform-${index}`;
      platforms.push(
        platformFrom(id, entry, str(item.name) ?? PLATFORM_NAMES[id] ?? id, PREFERRED[id] ?? '')
      );
    }
    return { version, platforms: orderPlatforms(platforms), error: null };
  }

  if (raw && typeof raw === 'object') {
    const map = raw as Record<string, unknown>;
    const ids = [
      ...PLATFORM_ORDER.filter((id) => id in map),
      ...Object.keys(map)
        .filter((id) => !PLATFORM_ORDER.includes(id))
        .sort(),
    ];
    const platforms = ids.map((id) =>
      platformFrom(id, map[id], PLATFORM_NAMES[id] ?? id, PREFERRED[id] ?? '')
    );
    return { version, platforms: orderPlatforms(platforms), error: null };
  }

  // A document with no `platforms` at all is not an error - an empty one is a
  // page with nothing on it, and that is what the site would render.
  return { version, platforms: [], error: null };
}

function orderPlatforms(platforms: SitePlatform[]): SitePlatform[] {
  return [...platforms].sort((a, b) => {
    const ai = PLATFORM_ORDER.indexOf(a.platform);
    const bi = PLATFORM_ORDER.indexOf(b.platform);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.name.localeCompare(b.name);
  });
}

function parseGit(raw: unknown): SiteGit | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  return {
    branch: str(g.branch),
    commit: str(g.commit),
    subject: str(g.subject),
    dirty: g.dirty === true,
    changedFiles: num(g.changedFiles) ?? (g.dirty === true ? 1 : 0),
    ahead: num(g.ahead),
    remote: str(g.remote),
  };
}

function parseDeployment(raw: unknown): SiteDeployment | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const id = str(d.id) ?? str(d.Id);
  if (!id) return null;
  return {
    id,
    environment: str(d.environment) ?? str(d.Environment),
    branch: str(d.branch) ?? str(d.Branch),
    source: str(d.source) ?? str(d.Source),
    url: str(d.url) ?? str(d.Deployment),
    status: str(d.status) ?? str(d.Status),
  };
}

function parsePages(raw: unknown): PagesInfo {
  if (!raw || typeof raw !== 'object') {
    return {
      available: false,
      reason: 'the server sent no Pages information',
      deployments: [],
      latest: null,
    };
  }
  const p = raw as Record<string, unknown>;
  if (p.available === false) {
    return {
      available: false,
      reason: str(p.reason) ?? 'wrangler is not available on this machine',
      deployments: [],
      latest: null,
    };
  }
  const list = Array.isArray(p.deployments) ? p.deployments : [];
  const deployments = list.map(parseDeployment).filter((d): d is SiteDeployment => d !== null);
  const latest = parseDeployment(p.latest) ?? deployments[0] ?? null;
  return { available: true, deployments, latest, error: str(p.error) };
}

function parseStatus(raw: unknown): WebsiteStatus {
  const doc = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    present: doc.present === true,
    path: str(doc.path) ?? '',
    project: str(doc.project),
    git: parseGit(doc.git),
    pages: parsePages(doc.pages),
    downloads: (doc.downloads ?? {}) as WebsiteStatus['downloads'],
    lastPublished: str(doc.lastPublished),
  };
}

export function WebsitePanel() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const verify = usePublisherStream();
  const deploy = usePublisherStream();
  const [armed, setArmed] = useState(false);

  // `force` is what ?refresh=1 means. The first load deliberately does NOT force
  // it: /api/website shells out to git and wrangler and makes a HEAD request per
  // artifact, and it is cached for an hour precisely so opening this tab does not
  // re-run wrangler. Only the Refresh button (and a refresh after a write) pays
  // for a real read.
  const request = useCallback(async (force: boolean) => {
    const { data, ageMs } = await apiGet<unknown>('/api/website', { refresh: force });
    return { data: parseStatus(data), ageMs };
  }, []);

  const refresh = useCallback(
    async (force = false) => {
      // Keep what is already on screen while re-reading rather than blanking it
      // to a spinner; a refresh is not a reason to lose the page being read.
      setLoad((current) => (current.state === 'ready' ? current : { state: 'loading' }));
      setRefreshing(force);
      try {
        const result = await request(force);
        setLoad({ state: 'ready', data: result.data, ageMs: result.ageMs });
      } catch (err) {
        setLoad({ state: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        setRefreshing(false);
      }
    },
    [request]
  );

  // Started through a resolved promise rather than called directly, so the state
  // update lands in a callback after the effect body instead of synchronously
  // inside it.
  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const data = load.state === 'ready' ? load.data : null;
  const downloads = data ? parseDownloads(data.downloads) : null;

  const busy = verify.busy || deploy.busy;

  async function runDeploy() {
    // Two gates, and the first is not optional code: `armed` exists so the
    // consequence is read before the button is live, and `confirm` because the
    // endpoint refuses anything else. Deploying replaces the LIVE PUBLIC SITE.
    if (!armed) return;
    const ok = window.confirm(
      'Deploy the website now?\n\nThis replaces the live public site at its published address. ' +
        'Anyone loading it in the next minute gets this build.'
    );
    if (!ok) {
      setArmed(false);
      return;
    }
    setArmed(false);
    await deploy.start('/api/website/deploy', { confirm: true });
    await refresh(true);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* The page header's Refresh re-reads the inventory, which is not what this
          section shows, so this section brings its own. It re-reads the site
          repo, the live Pages deployments and downloads.json - and only when it
          is pressed, because a silent re-read would replace the download rows
          while someone is deciding whether to deploy. */}
      <div className="flex items-center justify-end gap-3">
        {load.state === 'ready' ? (
          <DataAge ageMs={load.ageMs} cache={null} refreshing={refreshing} />
        ) : null}
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={load.state === 'loading' || refreshing || busy}
          aria-label="Re-read the website repo, the live Pages deployments and downloads.json"
          title="Re-read the site repo and the live downloads.json. Nothing here refreshes on its own."
          className="dw-button"
        >
          <RefreshCw
            className={`size-3.5 ${refreshing || load.state === 'loading' ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Refresh
        </button>
      </div>
      {load.state === 'loading' ? (
        <p className="flex items-center gap-2 text-[12.5px] text-ink-subtle">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Reading&hellip;
        </p>
      ) : null}

      {load.state === 'error' ? (
        <p
          role="alert"
          className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger"
        >
          <AlertTriangle className="mr-1.5 inline size-3.5 -translate-y-px" aria-hidden="true" />
          Could not read the website status: {load.message}
        </p>
      ) : null}

      {data ? (
        <>
          <SiteRepo status={data} />

          {downloads ? (
            <WhatTheSiteShows
              downloads={downloads}
              lastPublished={data.lastPublished}
              deployedAt={data.pages.latest?.status ?? null}
            />
          ) : null}

          <Pages status={data} />

          <Actions
            present={data.present}
            armed={armed}
            setArmed={setArmed}
            busy={busy}
            verify={verify}
            deploy={deploy}
            onDeploy={() => void runDeploy()}
          />
        </>
      ) : null}
    </div>
  );
}

/** Is the site repo on this machine, and what state is it in? */
function SiteRepo({ status }: { status: WebsiteStatus }) {
  const git = status.git;

  return (
    <section aria-label="Site repository" className="rounded-lg border border-edge bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-edge px-5 py-3">
        <h2 className="m-0 flex items-center gap-2 text-[13.5px] font-semibold">
          <Globe className="size-3.5 text-ink-subtle" aria-hidden="true" />
          Site repository
        </h2>
        <span className="font-mono text-[11.5px] text-ink-faint">{status.path || '—'}</span>
      </header>

      <div className="px-5 py-4">
        {!status.present ? (
          // A calm, factual state, not a failure: a sibling checkout a developer
          // may simply not have. It names the path that was checked, because the
          // usual mistake is a clone next to the wrong parent folder, and the
          // write verbs below are disabled rather than shown as errors.
          <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
            <span className="font-semibold text-ink">site repo not found at</span>
            <span className="font-mono text-ink-subtle">
              {status.path || `../${status.project ?? 'pandawan-launcher-site'}`}
            </span>
          </p>
        ) : git ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-1.5 text-[12.5px]">
              <dt className="text-ink-subtle">Branch</dt>
              <dd className="m-0 font-mono text-ink">{git.branch ?? 'unknown'}</dd>

              <dt className="text-ink-subtle">Commit</dt>
              <dd className="m-0 truncate font-mono text-ink">
                {git.commit ? git.commit.slice(0, 12) : 'unknown'}
                {git.subject ? (
                  <span className="ml-2 font-sans text-ink-subtle">{git.subject}</span>
                ) : null}
              </dd>

              <dt className="text-ink-subtle">Working tree</dt>
              <dd className="m-0">
                {git.dirty ? (
                  <span className="flex items-center gap-1.5 text-warn">
                    <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
                    <strong className="font-semibold">Uncommitted changes</strong>
                    <span className="text-ink-subtle">
                      {git.changedFiles} file{git.changedFiles === 1 ? '' : 's'}
                    </span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-accent">
                    <CheckCircle2 className="size-3 shrink-0" aria-hidden="true" />
                    <strong className="font-semibold">Clean</strong>
                  </span>
                )}
              </dd>

              <dt className="text-ink-subtle">Unpushed</dt>
              <dd className="m-0">
                {git.ahead === null ? (
                  <span className="text-ink-subtle">no upstream</span>
                ) : git.ahead > 0 ? (
                  <span className="text-warn">
                    <strong className="font-semibold">
                      {git.ahead} commit{git.ahead === 1 ? '' : 's'}
                    </strong>{' '}
                    not pushed{git.remote ? ` to ${git.remote}` : ''}
                  </span>
                ) : (
                  <span className="text-accent">in step with {git.remote ?? 'remote'}</span>
                )}
              </dd>
            </dl>
          </>
        ) : (
          // The repo is there but git said nothing about it: a word, not a
          // sentence about git having said nothing.
          <p className="m-0 text-[12.5px] text-ink-subtle">no git data</p>
        )}
      </div>
    </section>
  );
}

/** The one thing this panel exists to show: what a visitor to the site gets. */
function WhatTheSiteShows({
  downloads,
  lastPublished,
  deployedAt,
}: {
  downloads: { version: string | null; platforms: SitePlatform[]; error: string | null };
  lastPublished: string | null;
  /** The deployed site's own age, e.g. "1 day ago", as wrangler reports it. */
  deployedAt: string | null;
}) {
  return (
    <section
      aria-label="What the site currently shows"
      className="rounded-lg border border-edge bg-surface"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-edge px-5 py-3">
        <h2 className="m-0 text-[13.5px] font-semibold">
          What the site currently shows
          <span className="ml-2 font-mono text-[11px] font-normal text-ink-subtle">
            launcher/downloads.json
          </span>
        </h2>
        {/* The version is the biggest thing in its cell; everything else is a
            qualifier. Same hierarchy as the rail and the game header. */}
        <span className="font-mono text-[17px] tracking-[-0.01em] text-ink">
          {downloads.version ?? '—'}
        </span>
      </header>

      <div className="px-5 py-4">
        {downloads.error ? (
          <p className="m-0 rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-[12.5px] text-danger">
            downloads.json could not be read: {downloads.error}
          </p>
        ) : downloads.platforms.length === 0 ? (
          <p className="m-0 text-[12.5px] text-ink-subtle">No platforms listed</p>
        ) : (
          <ul className="flex flex-col">
            {downloads.platforms.map((platform) => (
              <li key={platform.platform} className="border-t border-edge first:border-t-0">
                <PlatformRow platform={platform} />
              </li>
            ))}
          </ul>
        )}

        {/* The coupling, as two timestamps side by side: lastPublished dates the
            FILE in R2 (the last launcher publish), deployedAt is the site's own
            deploy - which is why the two can disagree without either being
            wrong. A launcher publish changes what the page SHOWS; only a deploy
            changes its code. */}
        <div className="m-0 mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-edge pt-3 text-[12px]">
          <span className="flex items-baseline gap-1.5">
            <span className="text-ink-subtle">downloads last published</span>
            <span className="text-ink">{lastPublished ? ago(lastPublished) : 'never'}</span>
          </span>
          <span className="flex items-baseline gap-1.5">
            <span className="text-ink-subtle">site last deployed</span>
            <span className="text-ink">{deployedAt ?? 'unknown'}</span>
          </span>
        </div>
      </div>
    </section>
  );
}

/** One platform: the artifact its button leads with, and what else is offered. */
function PlatformRow({ platform }: { platform: SitePlatform }) {
  const tone = platformHue(platform.platform);

  return (
    <div className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`flex items-center gap-1.5 text-[12.5px] font-semibold ${tone}`}>
          <span className="size-1.5 shrink-0 rounded-[1px] bg-current" aria-hidden="true" />
          {platform.name}
        </span>
        {platform.fallback ? (
          <span className="rounded-sm border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-warn">
            label renamed
          </span>
        ) : null}
      </div>

      {platform.empty || !platform.preferred ? (
        // Reported, not omitted: the site renders this card as "Not available yet",
        // so an absent platform IS something the page is showing.
        <p className="m-0 text-[12.5px] text-ink-subtle">Not available yet</p>
      ) : (
        <ArtifactRow artifact={platform.preferred} lead />
      )}

      {platform.alternatives.length > 0 ? (
        <div className="mt-1 flex flex-col gap-0.5 border-l border-edge pl-3">
          <span className="text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
            also in the dropdown
          </span>
          {platform.alternatives.map((artifact, index) => (
            <ArtifactRow key={`${artifact.url}-${index}`} artifact={artifact} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One real artifact row: what it is called, the file it downloads, and whether
 * the URL resolves. Never a URL in a text box - the operator needs the filename
 * and the state, and the link is there for the times they need it.
 */
function ArtifactRow({ artifact, lead = false }: { artifact: SiteArtifact; lead?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span
        className={['shrink-0 text-[12px]', lead ? 'font-medium text-ink' : 'text-ink-subtle'].join(
          ' '
        )}
      >
        {artifact.label ?? artifact.filename ?? 'download'}
      </span>

      <a
        href={artifact.url}
        target="_blank"
        rel="noreferrer noopener"
        className={[
          'font-mono text-[12px] underline underline-offset-2',
          lead ? 'text-accent hover:text-accent-hover' : 'text-ink-muted hover:text-ink',
        ].join(' ')}
      >
        {artifact.filename ?? artifact.url}
      </a>

      {artifact.extension ? (
        <span className="font-mono text-[11px] text-ink-faint">{artifact.extension}</span>
      ) : null}

      {/* Resolution is a claim about the world, so it is never asserted from
          nothing: null means the server did not check, and says so. */}
      {artifact.resolves === true ? (
        <span className="flex items-center gap-1 text-[11px] text-accent">
          <CheckCircle2 className="size-3 shrink-0" aria-hidden="true" />
          URL resolves
        </span>
      ) : artifact.resolves === false ? (
        <span className="flex items-center gap-1 text-[11px] text-danger">
          <XCircle className="size-3 shrink-0" aria-hidden="true" />
          URL did not resolve
        </span>
      ) : (
        <span
          className="text-[11px] text-ink-faint"
          title="The server did not report whether this URL resolves. Open it to check."
        >
          not checked
        </span>
      )}

      <a
        href={artifact.url}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={`Open ${artifact.filename ?? 'the download'} in a new tab`}
        title="Open in a new tab"
        className="text-ink-faint hover:text-ink-muted"
      >
        <ExternalLink className="size-3" aria-hidden="true" />
      </a>
    </div>
  );
}

/** What Cloudflare Pages says is deployed. */
function Pages({ status }: { status: WebsiteStatus }) {
  const pages = status.pages;
  const latest = pages.latest;
  const checkout = status.git?.commit ?? null;
  const deployed = latest?.source ?? null;
  const matches = Boolean(deployed && checkout && deployed.slice(0, 12) === checkout.slice(0, 12));

  return (
    <section aria-label="Deployed site" className="rounded-lg border border-edge bg-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-edge px-5 py-3">
        <h2 className="m-0 text-[13.5px] font-semibold">
          Deployed site
          <span className="ml-2 font-normal text-ink-subtle">Cloudflare Pages</span>
        </h2>
        {latest?.url ? (
          <a
            href={latest.url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-1 text-[11.5px] text-ink-subtle underline underline-offset-2 hover:text-ink"
          >
            <ExternalLink className="size-3" aria-hidden="true" />
            open the live address
          </a>
        ) : null}
      </header>

      <div className="px-5 py-4 text-[12.5px]">
        {!pages.available ? (
          // Also calm. wrangler is a dev dependency of another repo, and its
          // absence says nothing about the site being up. The server's reason is
          // the whole answer, so it is shown rather than re-described.
          <p className="m-0 flex flex-wrap items-baseline gap-x-3 text-ink-subtle">
            <strong className="font-semibold text-ink-muted">Deployment state unknown</strong>
            <span>{pages.reason ?? 'wrangler is not available here.'}</span>
          </p>
        ) : latest ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-[15px] text-ink">
                {deployed ? deployed.slice(0, 12) : 'unknown build'}
              </span>
              {latest.environment ? (
                <span className="rounded-sm border border-edge bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-ink-subtle">
                  {latest.environment}
                </span>
              ) : null}
              {latest.status ? (
                <span className="text-[11px] text-ink-faint">{latest.status}</span>
              ) : null}
            </div>

            <p className="m-0 mt-2 flex flex-wrap items-baseline gap-x-3 text-ink-subtle">
              <span>{latest.branch ? `from ${latest.branch}` : 'branch unknown'}</span>
              {latest.id ? (
                <span className="font-mono text-[11.5px] text-ink-faint">{latest.id}</span>
              ) : null}
            </p>

            {/* The comparison an operator actually wants: does what is live
                match what is checked out. Everything else on this page is about
                the DATA, which is in R2 and needs no deploy. The two SHAs are
                shown side by side so the verdict needs no sentence. */}
            {matches ? (
              <p className="m-0 mt-2 flex items-center gap-1.5 text-accent">
                <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                <strong className="font-semibold">Live matches the checkout.</strong>
              </p>
            ) : (
              <p className="m-0 mt-2 flex items-start gap-1.5 text-warn">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <strong className="font-semibold">Live is not the checkout.</strong>
                  <span className="font-mono text-[12px]">{deployed ?? 'unknown'}</span>
                  <span className="text-ink-subtle">live</span>
                  <span className="font-mono text-[12px]">{checkout ?? 'unknown'}</span>
                  <span className="text-ink-subtle">checkout</span>
                </span>
              </p>
            )}
          </>
        ) : (
          <p className="m-0 text-ink-subtle">no deployments</p>
        )}
      </div>
    </section>
  );
}

/** Verify, and the one action here that reaches the public internet. */
function Actions({
  present,
  armed,
  setArmed,
  busy,
  verify,
  deploy,
  onDeploy,
}: {
  present: boolean;
  armed: boolean;
  setArmed: (armed: boolean) => void;
  busy: boolean;
  verify: ReturnType<typeof usePublisherStream>;
  deploy: ReturnType<typeof usePublisherStream>;
  onDeploy: () => void;
}) {
  return (
    <section aria-label="Website actions" className="rounded-lg border border-edge bg-surface">
      <header className="border-b border-edge px-5 py-3">
        <h2 className="m-0 text-[13.5px] font-semibold">Actions</h2>
      </header>

      <div className="flex flex-col gap-5 px-5 py-4">
        <div>
          {/* No lede. The button names the verb; a paragraph here only restated
              what "Verify the site" already says. */}
          <h3 className="m-0 flex items-center gap-2 text-[12.5px] font-semibold text-ink">
            <ShieldCheck className="size-3.5 text-ink-subtle" aria-hidden="true" />
            Verify
          </h3>
          <button
            type="button"
            onClick={() => void verify.start('/api/website/verify', {})}
            disabled={!present || busy}
            title={present ? 'Run the site repo verify script' : 'site repo not found'}
            className="dw-button mt-2.5"
          >
            {verify.busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-3.5" aria-hidden="true" />
            )}
            Verify the site
          </button>
          <Stream stream={verify} label="Website verify output" />
        </div>

        {/* Deliberately the most heavily marked control in the app. Deploying
            replaces the live public site, so it is separated from Verify, it is
            never armed by default, and arming it is a separate act from firing
            it.

            THE ONE SENTENCE ON THIS PAGE is the arming checkbox below: it names
            the LIVE PUBLIC SITE, which is the exception the prose budget allows,
            because the alternative is a destructive action whose only other
            warning is a native confirm. The heading and the button are labels,
            not a second telling of it. */}
        <div className="rounded-md border border-warn/35 bg-warn/[0.06] px-4 py-3.5">
          <h3 className="m-0 flex items-center gap-2 text-[12.5px] font-semibold text-warn">
            <CloudUpload className="size-3.5" aria-hidden="true" />
            Deploy
          </h3>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[12.5px] text-ink">
              <input
                type="checkbox"
                checked={armed}
                disabled={!present || busy}
                onChange={(event) => setArmed(event.target.checked)}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              I understand this replaces the live site
            </label>

            <button
              type="button"
              onClick={onDeploy}
              disabled={!armed || !present || busy}
              title={
                present
                  ? armed
                    ? 'Deploy to Cloudflare Pages'
                    : 'Tick the box above first'
                  : 'site repo not found'
              }
              className="dw-button"
            >
              {deploy.busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Rocket className="size-3.5" aria-hidden="true" />
              )}
              Deploy to the live site
            </button>

            {armed ? (
              <button
                type="button"
                onClick={() => setArmed(false)}
                className="border-none bg-none p-0 text-[12px] text-ink-subtle underline underline-offset-2 hover:text-ink"
              >
                cancel
              </button>
            ) : null}
          </div>

          <Stream stream={deploy} label="Website deploy output" />
        </div>
      </div>
    </section>
  );
}

/** A streamed run's output and its verdict. Nothing renders until one starts. */
function Stream({
  stream,
  label,
}: {
  stream: ReturnType<typeof usePublisherStream>;
  label: string;
}) {
  if (stream.verdict.state === 'idle') return null;
  const line = verdictLine(stream.verdict);
  return (
    <div className="mt-3">
      <pre className="dw-log" aria-label={label} aria-live="polite" tabIndex={0}>
        {stream.log}
      </pre>
      {line ? <p className={`m-0 mt-1 text-[12px] font-medium ${line.tone}`}>{line.text}</p> : null}
    </div>
  );
}
