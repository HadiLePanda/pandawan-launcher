import { useCallback, useEffect, useState } from 'react';

import { apiGet } from '@lib/api';
import type { ArtworkObject, ArtworkPayload, MetaPayload } from '@/types/api';

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
