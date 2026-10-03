/**
 * Upload another build of the selected game.
 *
 * The game and channel are locked to the selection - there is nothing to retype.
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
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { streamScript } from '@lib/api';
import { suggestNextBuild, suggestNextVersion } from '@lib/version';
import { PLATFORMS } from '@/types/api';

import { ActionRow, ErrorLine, Log, Panel, Section } from '@components/ui';

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
  const [log, setLog] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  /**
   * Reset the form when the SELECTION changes, not just on mount.
   *
   * All seven fields are set in one effect rather than at their declarations, so
   * the form cannot paint halfway between the old game's version and the new
   * one - a mixed pair that never existed in the data.
   *
   * The reset guard is the other half. Without it the effect also ran when
   * `suggestedVersion` changed after a publish, which would wipe whatever the
   * operator was in the middle of typing. Comparing the selection against the
   * last one it saw means this fires only on a genuine game change.
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
    // Carrying the previous game's paths over would publish THIS game's files
    // from another game's folder, so they are always cleared on a new selection.
    setPlatformDirs({ windows: '', macos: '', linux: '' });
    setInputDir('');
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

  const publish = async () => {
    if (missing.length) return;
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

    const code = await streamScript('/api/publish', { args }, (chunk) =>
      setLog((prev) => prev + chunk)
    );
    setRunning(false);
    if (code !== 0) {
      setError(`publish-game exited with code ${code}. Nothing was published.`);
      return;
    }
    onPublished();
  };

  return (
    <>
      <Section title={`Publish a build - ${gameId} / ${channel}`}>
        <Panel>
          <p className="m-0 text-[12.5px] text-ink-subtle">
            {scope.version ? (
              <>
                Suggested next version <strong className="text-ink">{suggestedVersion}</strong> from
                what is live ({scope.version}).
                {suggestedBuild !== null && (
                  <> Build {suggestedBuild}, one past the highest counter on any platform.</>
                )}
              </>
            ) : (
              'Nothing is published on this channel yet. CI decides the first version number - type it in.'
            )}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Version" value={version} onChange={setVersion} placeholder="0.4.1" mono />
            <Field
              label="Build number"
              value={buildNumber}
              onChange={setBuildNumber}
              placeholder="103"
              mono
            />
            <Field
              label="Executable"
              value={executable}
              onChange={setExecutable}
              placeholder={`${gameId}.exe`}
              mono
            />
            <Field
              label="Input directory"
              value={inputDir}
              onChange={setInputDir}
              placeholder="C:\\Builds\\out"
              mono
            />
          </div>

          {/* The platform group is a set-in from the fields above it, so it is
              recessed and inset rather than carrying another full-weight panel. */}
          <fieldset className="mt-5 rounded-sm border border-edge bg-black/20 px-4 py-4">
            <legend className="px-2 text-[12px] text-ink-muted">Platform directories</legend>
            {/* One sentence, because it is the reason to distrust the field: a
                prefill here would publish this game's files from another game's
                folder. */}
            <p className="mt-0 text-[11.5px] text-ink-subtle">
              Local build output, so they cannot be inferred and start empty every time.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-3">
              {PLATFORMS.map((platform) => (
                <Field
                  key={platform}
                  label={PLATFORM_LABEL[platform] ?? platform}
                  value={platformDirs[platform] ?? ''}
                  onChange={(next) => setPlatformDirs((prev) => ({ ...prev, [platform]: next }))}
                  placeholder="(unused)"
                  mono
                />
              ))}
            </div>
          </fieldset>

          {missing.length > 0 && (
            <p className="mt-3 text-[12px] text-ink-subtle">Still needed: {missing.join(', ')}.</p>
          )}

          {error && <ErrorLine>{error}</ErrorLine>}

          <ActionRow>
            <button
              type="button"
              onClick={() => void publish()}
              disabled={missing.length > 0 || running}
              className="dw-button dw-button-primary"
            >
              {running ? 'uploading…' : 'Publish build'}
            </button>
          </ActionRow>
        </Panel>
      </Section>

      {log && <Log lines={log} />}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  /** True when the value is a literal code token (a version, a build number, a
      path) and so belongs in mono; false for an ordinary typed label. */
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-ink-muted">
      {label}
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={`dw-input ${mono ? 'font-mono' : 'font-sans'}`}
      />
    </label>
  );
}
