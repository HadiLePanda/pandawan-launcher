/**
 * Every image published for the selected game, and which field is using it.
 *
 * This is the tab the URL boxes cannot replace. The field URL is only ever one of
 * these objects: objects are content-addressed, so a replaced banner leaves the
 * old one in place forever, and the operator needs to see that when cleaning up.
 * The bucket records no object-to-field mapping, so the server derives one from
 * the URLs the form holds - which is why an object labelled "not referenced by
 * any field" is the answer to a question, not decoration. Those URLs are
 * therefore read from the live metadata here rather than passed in from the
 * editor, because an unsaved draft's URL would label the list with a field that
 * is not published yet.
 *
 * `useArtworkObjects` below is that read, factored out because this is where
 * "which images exist" is answered. The image fields on the Metadata tab pick
 * from the same listing through it, so the picker and this tab can never drift
 * into offering different sets of images.
 *
 * Nothing here is editable. The editor lives on the Metadata tab; this tab shows
 * what is actually on the bucket and what is actually in use.
 */

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';

import { apiGet } from '@lib/api';
import { ago, plural, updatedPhrase } from '@lib/format';
import type { ArtworkObject, ArtworkPayload, MetaPayload } from '@/types/api';

import { ImagePreview } from '@components/ImagePreview';
import { ActionRow, EmptyState, ErrorLine, Panel, Section } from '@components/ui';

import type { GameTabProps } from './types';

/**
 * The field labels the server reports, and the fallbacks for `object.field` on a
 * tile. Typed as a lookup because it is indexed with whatever flag is in hand.
 *
 * Exported for the image picker, which names the same fields. That is one more
 * non-component export from a file of components, hence a fast-refresh warning:
 * worth it here, because the alternative is a second copy of these labels.
 */
export const FIELD_LABEL: Record<string, string> = {
  'icon-url': 'Icon URL',
  'banner-url': 'Banner URL',
};

/** The image fields, because the listing is marked against all of them at once. */
const IMAGE_FLAGS = ['icon-url', 'banner-url'] as const;

export interface ArtworkListing {
  objects: ArtworkObject[];
  /** How old the listing is, from the server's cache headers. */
  ageMs: number | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** Re-read the listing. `true` forces past the server's cache. */
  reload: (refresh?: boolean) => void;
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

export function ArtworkTab({ gameId, channel, onPublished }: GameTabProps) {
  const { objects, ageMs, loading, refreshing, error, reload } = useArtworkObjects({
    gameId,
    channel,
  });

  const inUse = objects.filter((object) => object.inUse);
  const unused = objects.filter((object) => !object.inUse);

  return (
    <>
      <Section
        title={`On the bucket - ${gameId} / ${channel}`}
        actions={
          <button
            type="button"
            onClick={() => void reload(true)}
            disabled={refreshing}
            className="dw-button"
            aria-label="Re-list the artwork objects on the bucket"
          >
            <RefreshCw
              className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </button>
        }
      >
        {error && <ErrorLine>{error}</ErrorLine>}

        {loading ? (
          <p className="text-[12.5px] text-ink-subtle">Listing objects&hellip;</p>
        ) : !objects.length ? (
          <EmptyState title="No artwork is published for this game and channel yet.">
            Upload an icon or banner from the Metadata tab.
          </EmptyState>
        ) : (
          <>
            <p className="m-0 text-[12px] text-ink-subtle">
              {plural(inUse.length, 'object')} in use, {unused.length} superseded.
              {/* One footnote, not two sentences. `updatedPhrase` already reads
                  "updated 2 minutes", so prefixing it with a verb produced
                  "Listed updated 2 minutes". */}
              {updatedPhrase(ageMs) ? ` ${updatedPhrase(ageMs)}.` : ''}
            </p>

            <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
              {/* Newest first, which is the server's sort order: the picture a
                  player sees today leads the list. */}
              {objects.map((object) => (
                <ArtworkCard key={object.key} object={object} />
              ))}
            </div>
          </>
        )}
      </Section>

      <Panel>
        <ActionRow>
          <button
            type="button"
            onClick={onPublished}
            className="dw-button"
            title="Re-read the inventory so the rail and header reflect a publish"
          >
            Refresh inventory
          </button>
        </ActionRow>
      </Panel>
    </>
  );
}

function ArtworkCard({ object }: { object: ArtworkObject }) {
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
        </div>
      </div>
    </div>
  );
}
