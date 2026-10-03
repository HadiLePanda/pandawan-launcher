/**
 * Every image published for the selected game, and which field is using it.
 *
 * This is the tab the URL boxes cannot replace. The field URL is only ever one of
 * these objects: objects are content-addressed, so a replaced banner leaves the
 * old one in place forever, and the operator needs to see that when cleaning up.
 * The bucket records no object-to-field mapping, so the server derives one from
 * the URLs the form holds.
 *
 * Deleting is the one action here that leaves the machine. It is offered only on
 * an object nothing references - an in-use one is labelled and its delete is
 * disabled - and the server re-checks every reference before it removes a key,
 * because artwork is content-addressed and a live catalog page points at these
 * URLs. The operator confirms with a window.confirm naming the object.
 *
 * Uploading is the other write. It is the SAME path the Metadata tab's picker
 * uses (`uploadArtwork` -> POST /api/art/upload): the server validates against
 * artwork.mjs, derives the object name from the bytes' hash, refuses a second
 * copy of bytes already on the bucket, and the operator confirms the file and the
 * object it becomes before anything is written.
 *
 * `useArtworkObjects` below is that read, factored out because this is where
 * "which images exist" is answered. The Metadata tab's MediaPicker picks from the
 * same listing, so the picker and this tab can never drift into offering
 * different sets of images.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Trash2, Upload } from 'lucide-react';

import { apiGet, apiPost, messageOf } from '@lib/api';
import { ARTWORK_ACCEPT, uploadArtwork } from '@lib/artwork';
import { ago, plural, updatedPhrase } from '@lib/format';
import type { ArtworkObject, ArtworkPayload, MetaPayload } from '@/types/api';

import { ImagePreview } from '@components/ImagePreview';
import { EmptyState, ErrorLine } from '@components/ui';
import { Button, Card, ErrorNote } from '@/panels/ui';

import type { GameTabProps } from './types';

/**
 * The field labels the server reports, and the fallbacks for `object.field` on a
 * tile. Spelled here because the listing's `field` is the metadata flag
 * ("icon-url"), which is not what a reader should be shown.
 */
export const FIELD_LABEL: Record<string, string> = {
  'icon-url': 'Icon URL',
  'banner-url': 'Banner URL',
};

/** The image fields, because the listing is marked against all of them at once. */
const IMAGE_FLAGS = ['icon-url', 'banner-url'] as const;

interface ArtworkListing {
  objects: ArtworkObject[];
  /** How old the listing is, from the server's cache headers. */
  ageMs: number | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Re-read the listing. `true` forces past the server's cache. */
  reload: (refresh?: boolean) => Promise<void>;
}

/**
 * The images in the bucket for one game and channel, and which field uses each.
 *
 * The server cannot mark the listing by itself: it learns which object a field
 * points at only from the URLs it is handed, so this reads the live metadata
 * first and passes those URLs on with the listing request.
 *
 * `field` and `value` are the one exception. A picker asking on behalf of a single
 * field marks that field's CURRENT value rather than the published one, because a
 * pick is not published yet and a picker that highlighted the published URL would
 * not mark the row the operator just clicked.
 */
export function useArtworkObjects({
  gameId,
  channel,
  field,
  value,
}: {
  gameId: string;
  channel: string;
  /** The field a picker is choosing for, when this is not a whole-bucket view. */
  field?: string;
  /** That field's current value. */
  value?: string;
}): ArtworkListing {
  const [objects, setObjects] = useState<ArtworkObject[]>([]);
  const [ageMs, setAgeMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The fetch, with no setState in it: a loader that reaches into component
  // state makes the effect below a synchronous setState, which the react-hooks
  // set-state-in-effect rule rejects for the cascading second render it causes.
  // Keeping the request separate is also what makes the two awaits honest - the
  // live URLs have to be fetched and awaited BEFORE /api/art is called, because
  // a blank URL marks nothing as in use and "nothing is in use" is the one answer
  // this must never give.
  const request = useCallback(
    async (refresh: boolean): Promise<{ objects: ArtworkObject[]; ageMs: number | null }> => {
      // The live URLs travel with the request so the server can mark which object
      // each field actually points at.
      const meta = await apiGet<MetaPayload>('/api/meta', {
        query: { gameId, channel },
      });
      if (meta.data.exists === false) return { objects: [], ageMs: null };

      const published = meta.data.fields ?? {};
      const values: Record<string, string> = {};
      for (const flag of IMAGE_FLAGS) values[flag] = published[flag]?.value ?? '';
      // Screenshots are marked too: an unmarked screenshot reads as unused and
      // would be offered for deletion while a live page still shows it.
      values['screenshots'] = published['screenshots']?.value ?? '';
      if (field) values[field] = value ?? '';

      const result = await apiGet<ArtworkPayload>('/api/art', {
        refresh,
        query: {
          gameId,
          channel,
          scope: 'game',
          ...values,
        },
      });
      return { objects: result.data.objects ?? [], ageMs: result.ageMs };
    },
    [channel, field, gameId, value]
  );

  const load = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const { objects: next, ageMs: nextAge } = await request(refresh);
        setObjects(next);
        setAgeMs(nextAge);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [request]
  );

  // The mount/dependency load is started through a resolved promise rather than
  // called directly, so the state updates happen in a callback after the effect
  // body rather than synchronously inside it. Same call, same await order, same
  // errors - only the render it lands on differs.
  useEffect(() => {
    void Promise.resolve().then(() => load(false));
  }, [load]);

  return { objects, ageMs, loading, refreshing, error, reload: load };
}

export function ArtworkTab({ gameId, channel }: GameTabProps) {
  const { objects, ageMs, loading, refreshing, error, reload } = useArtworkObjects({
    gameId,
    channel,
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The upload is the one action here that ADDS to the library rather than
  // removing from it. It is opt-in and confirmed inside uploadArtwork, which also
  // names the object it creates.
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadNote, setUploadNote] = useState('');

  const inUse = objects.filter((object) => object.inUse);
  const unused = objects.filter((object) => !object.inUse);

  async function upload(file: File) {
    setUploadError(null);
    setUploadNote('');
    setUploading(true);
    try {
      const result = await uploadArtwork({ gameId, channel, file });
      // Null means the operator cancelled the confirmation: nothing happened, so
      // there is nothing to report.
      if (!result) return;
      setUploadNote(
        result.duplicate
          ? `Already on the bucket as ${result.existingName ?? result.objectName}; nothing was uploaded.`
          : `Uploaded ${result.objectName}.`
      );
      // The server dropped /api/art on acceptance, so this re-read sees the new
      // object rather than the cached listing it replaced.
      await reload(true);
    } catch (err) {
      setUploadError(messageOf(err));
    } finally {
      setUploading(false);
    }
  }

  async function remove(object: ArtworkObject) {
    // Opt-in, and the confirmation names the exact object: an irreversible
    // delete must never be reachable without saying what it removes.
    if (
      !window.confirm(
        `Delete ${object.name} from the bucket? Its URL stops resolving and cannot be recovered.`
      )
    ) {
      return;
    }
    setBusyKey(object.key);
    setActionError(null);
    try {
      await apiPost('/api/art/delete', { key: object.key, confirm: true });
      await reload(true);
    } catch (err) {
      // The server refuses a referenced object with the fields that name it;
      // shown on the panel rather than swallowed.
      setActionError(messageOf(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[12px] text-ink-subtle">
          {plural(inUse.length, 'object')} in use, {unused.length} superseded.
          {updatedPhrase(ageMs) ? ` ${updatedPhrase(ageMs)}.` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* A hidden input driven by the button: the shared control kit has no
              styled file input, and a bare one is the platform's own chrome. */}
          <input
            ref={fileRef}
            type="file"
            accept={ARTWORK_ACCEPT}
            className="sr-only"
            disabled={uploading}
            aria-label={`Upload an artwork file to ${gameId} / ${channel}`}
            onChange={(event) => {
              const input = event.currentTarget;
              const file = input.files?.[0];
              // Cleared so choosing the same file twice still fires: this input is
              // uncontrolled and a browser does not re-report an unchanged pick.
              input.value = '';
              if (file) void upload(file);
            }}
          />
          <Button
            size="sm"
            busy={uploading}
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            aria-label={`Upload a new artwork file to ${gameId} / ${channel}`}
          >
            <Upload className="size-3.5" aria-hidden="true" />
            Upload
          </Button>
          <Button
            size="sm"
            onClick={() => void reload(true)}
            disabled={refreshing}
            aria-label="Re-list the artwork objects on the bucket"
          >
            <RefreshCw className={refreshing ? 'size-3.5 animate-spin' : 'size-3.5'} aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      {error ? <ErrorLine>{error}</ErrorLine> : null}
      {actionError ? <ErrorNote>{actionError}</ErrorNote> : null}
      {uploadError ? <ErrorNote>{uploadError}</ErrorNote> : null}
      {uploadNote ? <p className="m-0 mb-3 text-[12px] text-ink-subtle">{uploadNote}</p> : null}

      {loading ? (
        <p className="text-[12.5px] text-ink-subtle">Listing objects&hellip;</p>
      ) : !objects.length ? (
        <EmptyState title="No artwork is published for this game and channel yet.">
          Use Upload above to add an icon, banner or screenshot.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          {/* Newest first, which is the server's sort order: the picture a player
              sees today leads the list. */}
          {objects.map((object) => (
            <ArtworkCard
              key={object.key}
              object={object}
              busy={busyKey === object.key}
              onDelete={() => void remove(object)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function ArtworkCard({
  object,
  busy,
  onDelete,
}: {
  object: ArtworkObject;
  busy: boolean;
  onDelete: () => void;
}) {
  return (
    <div
      className={[
        'flex items-center gap-3 rounded-sm border border-edge bg-surface-2 p-2',
        // Dimmed, not hidden: a superseded image still costs storage. The label
        // carries the meaning, since opacity alone fails for a colour-blind reader.
        object.inUse ? '' : 'opacity-60',
      ].join(' ')}
    >
      <div className="flex h-12 w-[72px] shrink-0 items-center justify-center overflow-hidden rounded border border-edge-strong bg-surface-3">
        <ImagePreview
          url={object.url}
          alt={object.name}
          // Contain, not cover: cropping a wide banner removes the part being
          // identified.
          className="size-full object-contain"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[11.5px] text-ink" title={object.name}>
          {object.name}
        </div>
        <div className="mt-0.5 text-[11px] text-ink-subtle">
          {[object.size, ago(object.lastModified)].filter(Boolean).join(' · ')}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[11px]">
          {object.inUse ? (
            <span className="text-accent">
              used by {FIELD_LABEL[object.field ?? ''] ?? object.field}
            </span>
          ) : (
            <span className="text-ink-subtle">not referenced by any field</span>
          )}
          <a
            href={object.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${object.name} on the CDN in a new tab`}
            className="ml-auto shrink-0 text-ink-subtle transition-colors hover:text-ink"
          >
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
          {/* An in-use object cannot be deleted, and says so rather than offering
              an action the server would refuse. */}
          <Button
            size="sm"
            iconOnly
            variant={object.inUse ? 'quiet' : 'danger'}
            disabled={object.inUse || busy}
            busy={busy}
            onClick={onDelete}
            title={
              object.inUse
                ? 'In use - remove it from the field first'
                : `Delete ${object.name} from the bucket`
            }
            aria-label={
              object.inUse
                ? `${object.name} is in use and cannot be deleted`
                : `Delete ${object.name} from the bucket`
            }
          >
            <Trash2 className="size-3" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
