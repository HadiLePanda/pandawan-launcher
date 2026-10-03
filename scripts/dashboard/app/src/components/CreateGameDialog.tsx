/**
 * Create a catalog entry for a game that has no build yet.
 *
 * This is the "create" of CRUD, and deliberately NOT a publish form: publishing
 * uploads gigabytes of game files, while creating an entry writes one JSON object
 * into catalog.json so the launcher can list a game whose build is not on the
 * bucket yet - an unreleased title, a game being prepared for a playtest, a
 * placeholder so the launcher's channel switching has something to switch
 * between.
 *
 * It POSTs to /api/meta/publish, which writes the catalog entry and the manifest
 * for a game with no build, and refuses when there is no manifest at all - the
 * honest answer here, which is why the dialog says so up front rather than
 * failing after the operator has typed everything.
 *
 * The channel list is the real CHANNELS from the field contract, mirrored once in
 * @types/api, so this form cannot offer a channel the publisher would reject.
 */

import { useMemo, useState } from 'react';

import { streamScript } from '@lib/api';
import { KNOWN_CHANNELS, type KnownChannel } from '@/types/api';
import { scopeKey } from '@lib/games';

import { ActionRow, ErrorLine, Log, Panel } from '@components/ui';
import { useSession } from '@store/session';

/** What the dialog needs from the shell after a successful create. */
export function CreateGameDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** Given the new scope key so the shell can select it immediately. */
  onCreated: (key: string) => void;
}) {
  const select = useSession((state) => state.select);

  const [gameId, setGameId] = useState('');
  const [channel, setChannel] = useState<KnownChannel>('alpha');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [developer, setDeveloper] = useState('');
  const [log, setLog] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // A game id becomes a path segment (`games/<id>/<channel>`), so the publisher
  // and the CDN both treat it as a name rather than as free text. Rejecting a
  // space or a slash here is what stops a typo from creating a game nobody can
  // ever select again.
  const idError = useMemo(() => {
    const trimmed = gameId.trim();
    if (!trimmed) return 'A game id is required.';
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(trimmed)) {
      return 'Letters, digits, dot, dash and underscore only - it becomes a URL path.';
    }
    return null;
  }, [gameId]);

  const create = async () => {
    if (idError) return;
    setRunning(true);
    setError(null);
    setLog('');

    const payload: Record<string, string | boolean> = {
      gameId: gameId.trim(),
      channel,
      dryRun: false,
      name: name.trim() || gameId.trim(),
    };
    if (description.trim()) payload['description'] = description.trim();
    if (developer.trim()) payload['developer'] = developer.trim();

    const code = await streamScript('/api/meta/publish', payload, (chunk) =>
      setLog((prev) => prev + chunk)
    );
    setRunning(false);

    if (code !== 0) {
      // The entry keeps whatever it was, so the typed values stay on screen - this
      // is exactly the failure the operator needs to read, and wiping the form
      // would throw their typing away with it.
      setError('The catalog entry was not created. The server said:');
      return;
    }

    // Select it straight away, so the operator lands on the game they just made
    // rather than back at a rail that does not know about it yet.
    select(gameId.trim(), channel);
    onCreated(scopeKey(gameId.trim(), channel));
    onClose();
  };

  return (
    <Panel>
      <h2 className="dw-eyebrow m-0">New game</h2>
      <p className="mt-2 max-w-2xl text-[12.5px] leading-[1.6] text-ink-muted">
        Creates a catalog entry so the launcher can list a game. It does not upload a build and does
        not create the channel directory on the bucket - publish a build from its Builds tab once
        the binaries exist.
      </p>
      <p className="mt-2 max-w-2xl rounded-sm border-l-[3px] border-warn bg-warn/10 px-3 py-2 text-[12px] leading-[1.5] text-warn">
        The publisher refuses a game with no manifest, so if this reports a missing manifest that
        means the entry already has a build on the bucket and you should edit its metadata instead.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-ink-muted">
          Game id
          <input
            type="text"
            value={gameId}
            onChange={(event) => setGameId(event.target.value)}
            placeholder="pandawan-rising"
            aria-invalid={idError ? true : undefined}
            className="dw-input"
          />
        </label>

        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-ink-muted">
          Channel
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value as KnownChannel)}
            // A channel is a categorical value, not code: mono would set a status
            // word in the code face. Only the game id below stays mono.
            className="dw-input font-sans"
          >
            {/* The real contract list, not a hand-typed copy: this select cannot
                offer a channel publish-metadata.mjs would reject. */}
            {KNOWN_CHANNELS.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-ink-muted">
          Display name
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={gameId.trim() || 'Pandawan Rising'}
            className="dw-input font-sans"
          />
        </label>

        <label className="flex min-w-0 flex-col gap-1.5 text-[12px] text-ink-muted">
          Developer
          <input
            type="text"
            value={developer}
            onChange={(event) => setDeveloper(event.target.value)}
            placeholder="Pandawan Corp"
            className="dw-input font-sans"
          />
        </label>

        <label className="col-span-2 flex min-w-0 flex-col gap-1.5 text-[12px] text-ink-muted">
          Description
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            placeholder="One line about what the game is."
            className="dw-input resize-y font-sans"
          />
        </label>
      </div>

      {idError && gameId.trim() && <ErrorLine>{idError}</ErrorLine>}
      {error && <ErrorLine>{error}</ErrorLine>}

      <ActionRow>
        <button type="button" onClick={onClose} className="dw-button">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void create()}
          disabled={Boolean(idError) || running}
          className="dw-button dw-button-primary"
        >
          {running ? 'creating…' : 'Create game'}
        </button>
      </ActionRow>

      {log && <Log lines={log} />}
    </Panel>
  );
}
