/**
 * Delete all but the newest builds for the selected game and channel.
 *
 * The one destructive verb in the tool, so it is set apart and marked: the panel
 * carries an amber edge, the submit button is deliberately NOT filled red, and
 * the real delete is behind a toggle that also changes what the button says.
 *
 * A destructive button stays unfilled on purpose. It is an armed action sitting
 * next to a preview-only checkbox, and filling it red would give it the same
 * visual weight as the primary button it outranks the moment the checkbox is
 * ticked - which is exactly when the operator needs the two distinguishable. The
 * warn edge and the toggled submit rule carry the state instead, on the control
 * being clicked rather than in a permanent badge.
 *
 * --dry-run is the server's default and a real run needs confirm: true, because
 * the script's own prompt reads a keystroke from a console this stream cannot
 * reach. That is why the toggle is named for the consequence rather than for the
 * flag.
 */

import { useState } from 'react';

import { streamScript } from '@lib/api';
import { plural } from '@lib/format';

import { ActionRow, ErrorLine, Log, Panel, Section } from '@components/ui';

import type { GameTabProps } from './types';

/** How many builds the server keeps by default. */
const DEFAULT_KEEP = 3;

export function PruneTab({ gameId, channel, onPublished }: GameTabProps) {
  const [keep, setKeep] = useState(String(DEFAULT_KEEP));
  const [confirmed, setConfirmed] = useState(false);
  const [log, setLog] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const keepNumber = Number.parseInt(keep, 10);
  const keepValid = Number.isInteger(keepNumber) && keepNumber >= 1;

  const run = async () => {
    if (!keepValid) return;
    if (
      confirmed &&
      !window.confirm(
        `Permanently delete all but the newest ${keepNumber} builds of ${gameId} / ${channel}?`
      )
    ) {
      return;
    }

    setRunning(true);
    setError(null);
    setLog('');

    const code = await streamScript(
      '/api/prune',
      { gameId, channel, keep, confirm: confirmed },
      (chunk) => setLog((prev) => prev + chunk)
    );
    setRunning(false);

    if (code !== 0) {
      setError(`prune-builds exited with code ${code}.`);
      return;
    }

    // The toggle resets either way: leaving it armed means the next click on the
    // same button is a real delete, which is exactly the state it should never
    // be found in.
    setConfirmed(false);
    onPublished();
  };

  return (
    <>
      <Section title={`Prune builds - ${gameId} / ${channel}`}>
        <Panel tone="warn">
          <h2 className="dw-eyebrow m-0 text-warn">Destructive</h2>
          <p className="mt-2 max-w-2xl text-[12.5px] leading-[1.6] text-ink-muted">
            Deletes build directories from the bucket. Versions the manifest currently points at are
            never deleted, so whatever players are downloading survives.
          </p>

          <div className="mt-4 flex max-w-[220px] flex-col gap-1.5 text-[12px] text-ink-muted">
            <label htmlFor="prune-keep">Builds to keep</label>
            <input
              id="prune-keep"
              type="text"
              inputMode="numeric"
              value={keep}
              onChange={(event) => setKeep(event.target.value)}
              aria-describedby={keepValid ? undefined : 'prune-keep-error'}
              className="dw-input font-mono"
            />
          </div>

          {!keepValid && (
            <p id="prune-keep-error" className="mt-2 text-[12px] text-danger">
              --keep must be a positive integer.
            </p>
          )}

          {error && <ErrorLine>{error}</ErrorLine>}

          <ActionRow>
            <label className="mr-auto flex cursor-pointer flex-row items-center gap-2 text-[12px] text-ink-subtle">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="size-[15px] accent-[var(--color-warn)]"
              />
              Delete for real (otherwise a dry run)
            </label>

            <button
              type="button"
              onClick={() => void run()}
              disabled={!keepValid || running}
              className={[
                'dw-button dw-button-danger',
                // Arming the toggle changes the button it guards, so the
                // consequence is shown on the control being clicked rather than
                // described in a permanent badge.
                confirmed
                  ? 'border-transparent bg-warn font-semibold text-warn-ink hover:bg-warn hover:text-warn-ink'
                  : '',
              ].join(' ')}
            >
              {running
                ? 'working…'
                : confirmed
                  ? `Delete all but ${keepNumber || '…'}`
                  : 'Preview prune'}
            </button>
          </ActionRow>

          {!confirmed && (
            <p className="mt-2 text-right text-[11.5px] text-ink-subtle">
              {plural(keepNumber || 0, 'build', 'builds')} will be kept. Nothing is deleted until
              &ldquo;Delete for real&rdquo; is ticked.
            </p>
          )}
        </Panel>
      </Section>

      {log && <Log lines={log} />}
    </>
  );
}
