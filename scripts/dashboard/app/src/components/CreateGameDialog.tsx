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

import { ActionRow, ErrorLine, Log } from '@components/ui';
import { Button, Card, Field, Select, TextArea, TextInput } from '@/panels/ui';
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
    <Card>
      <h2 className="dw-eyebrow m-0">New game</h2>
      <p className="mt-2 max-w-2xl text-[12px] text-ink-subtle">
        Creates a catalog entry so the launcher can list a game whose build is not on the bucket
        yet.
      </p>
      <p className="mt-2 max-w-2xl rounded-sm border-l-[3px] border-warn bg-warn/10 px-3 py-2 text-[12px] leading-[1.5] text-warn">
        The publisher refuses a game with no manifest, so if this reports a missing manifest the
        entry already has a build on the bucket - edit its metadata instead.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field
          label="Game id"
          required
          htmlFor="create-id"
          error={gameId.trim() ? idError : undefined}
        >
          <TextInput
            id="create-id"
            className="font-mono"
            value={gameId}
            placeholder="example-game"
            aria-invalid={idError ? true : undefined}
            onChange={(event) => setGameId(event.target.value)}
          />
        </Field>

        <Field label="Channel" required htmlFor="create-channel">
          {/* The real contract list, not a hand-typed copy: this select cannot
              offer a channel publish-metadata.mjs would reject. */}
          <Select
            id="create-channel"
            value={channel}
            onChange={(event) => setChannel(event.target.value as KnownChannel)}
          >
            {KNOWN_CHANNELS.map((one) => (
              <option key={one} value={one}>
                {one}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Display name" htmlFor="create-name">
          <TextInput
            id="create-name"
            value={name}
            placeholder={gameId.trim() || 'Example Game'}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <Field label="Developer" htmlFor="create-developer">
          <TextInput
            id="create-developer"
            value={developer}
            placeholder="Pandawan Corp"
            onChange={(event) => setDeveloper(event.target.value)}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Description" htmlFor="create-description">
            <TextArea
              id="create-description"
              value={description}
              rows={2}
              placeholder="One line about what the game is."
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </div>
      </div>

      {error ? <ErrorLine>{error}</ErrorLine> : null}

      <ActionRow>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => void create()}
          busy={running}
          disabled={Boolean(idError) || running}
        >
          Create game
        </Button>
      </ActionRow>

      {log ? <Log lines={log} /> : null}
    </Card>
  );
}
