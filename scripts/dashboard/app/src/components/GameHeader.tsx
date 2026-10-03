/**
 * The selected game's header.
 *
 * Names the game, says how old the data is, and holds the Refresh control. The
 * age is the footnote and the version is the headline, which is the same
 * hierarchy the inventory grid uses - established here so the rail, the header
 * and a tab all rank the same value the same way.
 */

import { RefreshCw } from 'lucide-react';

import { channelToneClasses } from '@/panels/channel-tone';
import { ago, STATUS_TEXT } from '@lib/format';
import { platformDot, platformHue } from '@lib/platform-hue';
import { behindVersion, type GameScope } from '@lib/games';
import { DataAge } from '@components/ui';
import type { CacheState } from '@lib/api';
import { PLATFORMS, type Platform } from '@app-types/api';

const PLATFORM_LABEL: Record<string, string> = {
  windows: 'windows',
  macos: 'mac',
  linux: 'linux',
};

/**
 * Per-platform versions, shown as a compact strip.
 *
 * The platforms line up across the row so a version can be compared by eye. Each
 * carries its own hue - they differ in lightness as well as in hue, so the
 * columns stay separable without reading the labels - and the one that is BEHIND
 * is dimmed and struck, because the row's own amber edge already carries the
 * attention and the job here is to name which platform is behind.
 */
function PlatformStrip({ latest, behind }: { latest: GameScope['latest']; behind: string | null }) {
  const names = PLATFORMS.filter((p) => p in latest);
  const extra = Object.keys(latest).filter((p) => !(PLATFORMS as readonly string[]).includes(p));
  const all = [...names, ...extra];

  if (!all.length) {
    return <span className="text-[12px] text-ink-subtle">nothing published on this channel</span>;
  }

  return (
    <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      {all.map((platform) => {
        const entry = latest[platform];
        if (!entry) return null;
        const isBehind = behind !== null && entry.version === behind;
        return (
          <span key={platform} className="flex items-baseline gap-1.5">
            <span
              className={`size-1.5 shrink-0 self-center rounded-[1px] ${platformDot(platform)}`}
              aria-hidden="true"
            />
            <span className="text-[11px] text-ink-subtle">
              {PLATFORM_LABEL[platform] ?? platform}
            </span>
            <span
              className={[
                'font-mono text-[15px] tracking-[-0.01em] whitespace-nowrap',
                isBehind
                  ? 'text-ink-faint line-through decoration-warn decoration-[1px]'
                  : PLATFORMS.includes(platform as Platform)
                    ? platformHue(platform)
                    : 'text-ink',
              ].join(' ')}
            >
              {entry.version}
            </span>
            <span className="text-[11px] text-ink-faint tabular-nums">#{entry.build}</span>
            {isBehind && <span className="text-[11px] text-warn">behind</span>}
          </span>
        );
      })}
    </span>
  );
}

export function GameHeader({
  scope,
  ageMs,
  cache,
  refreshing,
  onRefresh,
}: {
  scope: GameScope | null;
  ageMs: number | null;
  cache: CacheState;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-edge px-8 pb-4 pt-5">
      <div className="min-w-0">
        {scope ? (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="m-0 text-[21px] font-semibold tracking-[-0.02em]">{scope.gameId}</h1>
              <span
                className={[
                  'rounded-sm border px-2 py-0.5 text-[11px]',
                  channelToneClasses(scope.channel),
                ].join(' ')}
              >
                {scope.channel}
              </span>
              <span
                className={[
                  'text-[12px]',
                  scope.status === 'drifted' ? 'text-warn' : 'text-ink-subtle',
                ].join(' ')}
              >
                {STATUS_TEXT[scope.status]}
                {scope.updated && scope.status !== 'empty' && (
                  <span className="text-ink-faint"> · {ago(scope.updated)}</span>
                )}
              </span>
            </div>
            <div className="mt-2">
              <PlatformStrip latest={scope.latest} behind={behindVersion(scope.latest)} />
            </div>
          </>
        ) : (
          <h1 className="m-0 text-[21px] font-semibold tracking-[-0.02em] text-ink-subtle">
            No game selected
          </h1>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 pt-1">
        <DataAge ageMs={ageMs} cache={cache} refreshing={refreshing} />
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh the game list and data from the bucket"
          title="Re-read the bucket. Nothing refreshes on its own."
          className="dw-button"
        >
          <RefreshCw
            className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Refresh
        </button>
      </div>
    </header>
  );
}
