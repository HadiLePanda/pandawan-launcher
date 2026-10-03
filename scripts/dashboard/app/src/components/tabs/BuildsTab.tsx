/**
 * Publish another build of the selected game.
 *
 * The game and channel are locked to the selection - there is nothing to retype.
 *
 * The header is the ladder, in the Launcher releases panel's arrangement: the
 * channel, the version live on it, and each platform's version and build, so the
 * everyday question ("what is players' current build, and what is next?") is
 * answered before the form rather than assembled from it. The suggestion beside
 * the Version and Build controls is one click to apply.
 *
 * The prefill is the part worth reading. The version is suggested from what is
 * live and the build number from the highest counter any platform is on, both
 * using the numeric-per-component comparison rather than a string sort - a plain
 * sort puts 0.4.10 before 0.4.9 and would suggest republishing an existing
 * build. See suggestNextVersion / suggestNextBuild in @lib/version.
 *
 * Platform directories are left EMPTY on purpose. They describe local build
 * output and cannot be inferred; carrying the previous game's paths over would
 * publish this game's files from another game's folder.
 *
 * Publishing is a real upload, so dry run is the default: `--dry-run` generates
 * the manifest and reports what it would send, running the same validation and
 * comparison the real path does, and only the writes are gated behind unticking
 * Preview plus a confirm.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { streamScript } from '@lib/api';
import { platformDot, platformHue } from '@lib/platform-hue';
import { suggestNextBuild, suggestNextVersion } from '@lib/version';
import { PLATFORMS } from '@/types/api';

import { ActionRow, EmptyState, ErrorLine, Log } from '@components/ui';
import { Button, Card, Field, TextInput } from '@/panels/ui';

import { Rung, Tally } from '@/panels/ladder';
import type { GameTabProps } from './types';

const PLATFORM_LABEL: Record<string, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

export function BuildsTab({ gameId, channel, scope, onPublished }: GameTabProps) {
  // Suggested from the scope on every render of the form's initial state, so
  // switching games always recomputes. Applying the suggestion only when the
  // field is empty would leave the number just used in place after a publish and
  // offer the same version again.
  const suggestedVersion = useMemo(() => suggestNextVersion(scope.version), [scope.version]);
  const suggestedBuild = useMemo(
    () => suggestNextBuild(Object.values(scope.latest)),
    [scope.latest]
  );

  const [version, setVersion] = useState(suggestedVersion);
  const [buildNumber, setBuildNumber] = useState(
    suggestedBuild === null ? '' : String(suggestedBuild)
  );
  const [executable, setExecutable] = useState(`${gameId}.exe`);
  const [inputDir, setInputDir] = useState('');
  const [platformDirs, setPlatformDirs] = useState<Record<string, string>>({
    windows: '',
    macos: '',
    linux: '',
  });
  const [dryRun, setDryRun] = useState(true);
  const [log, setLog] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  /**
   * Reset the form when the SELECTION changes, not just on mount.
   *
   * All the fields are set in one effect rather than at their declarations, so
   * the form cannot paint halfway between the old game's version and the new
   * one - a mixed pair that never existed in the data. The reset guard is the
   * other half: without it the effect also ran when `suggestedVersion` changed
   * after a publish, which would wipe whatever the operator was mid-way through.
   */
  const selection = `${gameId} ${channel}`;
  const resetRef = useRef(selection);
  useEffect(() => {
    if (resetRef.current === selection) return;
    resetRef.current = selection;
    setVersion(suggestedVersion);
    setBuildNumber(suggestedBuild === null ? '' : String(suggestedBuild));
    setExecutable(`${gameId}.exe`);
    // Platform directories describe local build output and cannot be inferred.
    setPlatformDirs({ windows: '', macos: '', linux: '' });
    setInputDir('');
    // A new selection must not inherit an armed real publish.
    setDryRun(true);
    setLog('');
    setError(null);
  }, [selection, suggestedVersion, suggestedBuild, gameId]);

  const missing: string[] = [];
  if (!version.trim()) missing.push('a version');
  if (!buildNumber.trim()) missing.push('a build number');
  if (!executable.trim()) missing.push('an executable name');
  if (!inputDir.trim() && !PLATFORMS.some((p) => platformDirs[p]?.trim())) {
    missing.push('an input directory or at least one platform directory');
  }

  // The manifest key this publish would write, shown beside the button so the
  // target is on screen before the press rather than in the log after it.
  const target = `games/${gameId}/${channel}/${version.trim() || '…'}/manifest.json`;

  const publish = async () => {
    if (missing.length) return;

    if (
      !dryRun &&
      !window.confirm(
        `Publish ${gameId} ${version.trim()} (build ${buildNumber.trim()}) to ${channel}? ` +
          'Players will be offered this build immediately.'
      )
    ) {
      return;
    }

    setRunning(true);
    setError(null);
    setLog('');

    // Args cross as an array and go to spawn without a shell, so nothing typed
    // into this form can become a command.
    const args = [
      '--game-id',
      gameId,
      '--channel',
      channel,
      '--version',
      version.trim(),
      '--build-number',
      buildNumber.trim(),
      '--executable',
      executable.trim(),
      '--input-dir',
      inputDir.trim(),
    ];
    for (const platform of PLATFORMS) {
      const dir = platformDirs[platform]?.trim();
      if (dir) args.push('--platform', `${platform}=${dir}`);
    }
    // The server's publisher reads --dry-run and writes nothing without it.
    if (dryRun) args.push('--dry-run');

    const code = await streamScript('/api/publish', { args }, (chunk) =>
      setLog((prev) => prev + chunk)
    );
    setRunning(false);
    if (code !== 0) {
      setError(`publish-game exited with code ${code}. Nothing was published.`);
      return;
    }
    // A preview leaves the form alone; only a real publish re-reads the bucket.
    if (!dryRun) onPublished();
  };

  const platforms = Object.entries(scope.latest);

  // The game header above already lists every platform's version and build, so a
  // rung here is only worth the ink when it DISAGREES with the channel's live
  // version - a platform left behind by a partial publish is the exception, and
  // that is the case the operator needs to see. Repeating the identical rungs
  // 20px below themselves is the nesting this page is being cleaned of.
  const diverged = platforms.filter(
    ([, entry]) => scope.version && entry.version !== scope.version
  );

  return (
    <Card>
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-edge pb-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-5 gap-y-1">
          <Rung label="channel" value={channel} dot="bg-accent" tone="text-accent" />
          <Rung
            label="live"
            value={scope.version || 'none'}
            dot="bg-ink-faint"
            tone={scope.version ? 'text-ink' : 'text-ink-subtle'}
          />
          {diverged.map(([platform, entry]) => (
            <Rung
              key={platform}
              label={`${platform} behind`}
              value={`${entry.version} #${entry.build}`}
              dot={platformDot(platform)}
              tone={platformHue(platform)}
            />
          ))}
        </div>
        {suggestedBuild !== null ? <Tally value={suggestedBuild} label="next build" /> : null}
      </header>

      {!scope.version && !platforms.length ? (
        <EmptyState title="Nothing is published on this channel yet">
          CI decides the first version number - type it in and publish the first build.
        </EmptyState>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field
          label="Version"
          required
          htmlFor="build-version"
          action={
            suggestedVersion && suggestedVersion !== version ? (
              <button
                type="button"
                onClick={() => setVersion(suggestedVersion)}
                title={`Use the suggested next version, ${suggestedVersion}`}
                className="border-none bg-none p-0 text-[11px] text-ink-subtle underline underline-offset-2 hover:text-ink"
              >
                use {suggestedVersion}
              </button>
            ) : undefined
          }
        >
          <TextInput
            id="build-version"
            className="font-mono"
            value={version}
            placeholder="0.4.1"
            onChange={(event) => setVersion(event.target.value)}
          />
        </Field>

        <Field
          label="Build number"
          required
          htmlFor="build-number"
          action={
            suggestedBuild !== null && String(suggestedBuild) !== buildNumber ? (
              <button
                type="button"
                onClick={() => setBuildNumber(String(suggestedBuild))}
                title={`Use the next build number, ${suggestedBuild}`}
                className="border-none bg-none p-0 text-[11px] text-ink-subtle underline underline-offset-2 hover:text-ink"
              >
                use {suggestedBuild}
              </button>
            ) : undefined
          }
        >
          <TextInput
            id="build-number"
            className="font-mono"
            value={buildNumber}
            placeholder="103"
            onChange={(event) => setBuildNumber(event.target.value)}
          />
        </Field>

        <Field label="Executable" required htmlFor="build-executable">
          <TextInput
            id="build-executable"
            className="font-mono"
            value={executable}
            placeholder={`${gameId}.exe`}
            onChange={(event) => setExecutable(event.target.value)}
          />
        </Field>

        <Field label="Input directory" htmlFor="build-input">
          <TextInput
            id="build-input"
            className="font-mono"
            value={inputDir}
            placeholder="C:\\Builds\\out"
            onChange={(event) => setInputDir(event.target.value)}
          />
        </Field>
      </div>

      {/* The platform group is a set-in from the fields above it, so it is
          recessed and inset rather than carrying another full-weight panel. */}
      <fieldset className="mt-4 rounded-sm border border-edge bg-black/20 px-4 py-3">
        <legend className="px-2 text-[12px] text-ink-muted">Platform directories</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {PLATFORMS.map((platform) => (
            <Field
              key={platform}
              label={PLATFORM_LABEL[platform] ?? platform}
              htmlFor={`build-${platform}`}
            >
              <TextInput
                id={`build-${platform}`}
                className="font-mono"
                value={platformDirs[platform] ?? ''}
                placeholder="(unused)"
                onChange={(event) =>
                  setPlatformDirs((prev) => ({ ...prev, [platform]: event.target.value }))
                }
              />
            </Field>
          ))}
        </div>
      </fieldset>

      {missing.length > 0 && !running ? (
        <p className="mt-3 text-[12px] text-ink-subtle">Still needed: {missing.join(', ')}.</p>
      ) : null}

      {error ? <ErrorLine>{error}</ErrorLine> : null}

      <ActionRow>
        <label className="mr-auto flex cursor-pointer flex-row items-center gap-2 text-[12px] text-ink-subtle">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(event) => setDryRun(event.target.checked)}
            className="size-[15px] accent-[var(--color-warn)]"
          />
          Preview only (dry run)
        </label>
        {/* The value the action produces, so the target is on screen before the
            button is pressed rather than in the log after it. */}
        <code className="mr-2 truncate font-mono text-[11px]" title={target}>
          {target}
        </code>
        <Button
          variant="primary"
          onClick={() => void publish()}
          busy={running}
          disabled={missing.length > 0 || running}
        >
          {dryRun ? 'Preview build' : 'Publish build'}
        </Button>
      </ActionRow>

      {log ? <Log lines={log} /> : null}
    </Card>
  );
}
