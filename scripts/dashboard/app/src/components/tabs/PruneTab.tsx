/**
 * Delete all but the newest builds for the selected game and channel.
 *
 * The one destructive verb in the tool, so it is marked: the panel carries an
 * amber "destructive" badge (colour paired with a word), the submit button is
 * deliberately NOT filled red, and the real delete is behind a toggle that also
 * changes what the button says.
 *
 * A destructive button stays unfilled on purpose. It is an armed action sitting
 * next to a preview-only checkbox, and filling it red would give it the same
 * visual weight as the primary button it outranks the moment the checkbox is
 * ticked - which is exactly when the operator needs the two distinguishable.
 *
 * --dry-run is the server's default and a real run needs confirm: true, because
 * the script's own prompt reads a keystroke from a console this stream cannot
 * reach. That is why the toggle is named for the consequence rather than for the
 * flag.
 */

import { useState } from 'react';

import { streamScript } from '@lib/api';
import { plural } from '@lib/format';

import { ActionRow, ErrorLine, Log } from '@components/ui';
import { Badge, Button, Card, Field, TextInput } from '@/panels/ui';

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
      <Card>
        <Badge tone="warn">destructive</Badge>
        {/* The one line here that stops a mistake: what survives the delete. */}
        <p className="mt-2 max-w-2xl text-[12px] text-ink-subtle">
          Deletes build directories from the bucket. Versions the manifest currently points at are
          never deleted, so whatever players are downloading survives.
        </p>

        <div className="mt-4 max-w-[220px]">
          <Field
            label="Builds to keep"
            htmlFor="prune-keep"
            error={!keepValid ? '--keep must be a positive integer.' : undefined}
          >
            <TextInput
              id="prune-keep"
              inputMode="numeric"
              className="font-mono"
              value={keep}
              onChange={(event) => setKeep(event.target.value)}
            />
          </Field>
        </div>

        {error ? <ErrorLine>{error}</ErrorLine> : null}

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

          <Button
            variant={confirmed ? 'danger' : 'secondary'}
            onClick={() => void run()}
            disabled={!keepValid || running}
            busy={running}
          >
            {confirmed ? `Delete all but ${keepNumber || '…'}` : 'Preview prune'}
          </Button>
        </ActionRow>

        {!confirmed ? (
          <p className="mt-2 text-right text-[11.5px] text-ink-subtle">
            {plural(keepNumber || 0, 'build', 'builds')} will be kept. Nothing is deleted until
            &ldquo;Delete for real&rdquo; is ticked.
          </p>
        ) : null}
      </Card>

      {log ? <Log lines={log} /> : null}
    </>
  );
}
