/**
 * The metadata editor's state: what is published, what has been typed, and
 * exactly which of those differ.
 *
 * This is where the two load-bearing dirty rules live. Both were bugs once and
 * both are subtle enough that the reasoning is the point of the file:
 *
 *  1. AN EMPTIED LIST FIELD IS NOT A CHANGE. `genres` is stored as an array and
 *     edited as a comma string, which cannot express "no genres". The server
 *     skips an emptied list rather than writing [], because writing [] would
 *     erase the field. So reporting it as changed would promise an edit that then
 *     publishes nothing at all - the worst kind of lie, because the count says
 *     the edit is going out.
 *
 *  2. AN IMAGE CHANGED ONLY BY A STAGED FILE MUST NOT ALSO RESEND ITS URL. The
 *     upload rewrites the URL itself, so sending the unchanged one would make
 *     the server diff two identical values and report a change nobody made. The
 *     staged path is a real edit even though the URL box is untouched, so the
 *     field IS dirty - it just must not contribute its URL to the payload.
 *
 * `dirtyFlags` is the single source of truth for "what would this publish
 * change". The count, the diff review and the publish payload are all built from
 * that one list, so they cannot disagree.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { apiGet } from '@lib/api';
import { normaliseList } from '@lib/format';
import type { MetaField, MetaPayload } from '@/types/api';

import type { DiffRow } from '@components/DiffReview';

/** Image fields and the payload key the server reads each from. */
export const IMAGE_INPUTS = {
  'icon-url': 'iconFile',
  'banner-url': 'bannerFile',
} as const;

type ImageFlag = keyof typeof IMAGE_INPUTS;

/**
 * A metadata field plus the display-only preview URL the server adds for the two
 * image fields (`readGameMetadata` sets it; `value` is what gets saved).
 *
 * Declared here rather than in types/api.ts because it is the server's extra
 * field, not part of the shared `MetaField` shape the panel was typed against.
 */
export interface MetaFieldView extends MetaField {
  previewUrl?: string;
}

/**
 * The field order the form renders in.
 *
 * Mirrors the order of FIELDS in scripts/lib/metadata-fields.mjs. The API
 * returns fields as an object keyed by flag and carries no order, but a form
 * whose fields reshuffle between loads is unusable - so the sequence is pinned
 * here. Labels are NOT hardcoded: each field's own `label` from the response is
 * used, so a rename in the contract shows up without touching this file.
 */
export const FIELD_ORDER = [
  'name',
  'description',
  'developer',
  'genre',
  'icon-url',
  'banner-url',
  'screenshots',
  'supported-platforms',
  'available-channels',
] as const;

/** Everything the form needs, given the loaded payload. */
function initialValues(payload: MetaPayload): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [flag, field] of Object.entries(payload.fields ?? {})) {
    values[flag] = String(field.value ?? '');
  }
  // Reset to exactly what the server reported, never merged with the previous
  // load: a stale value left over from another game would look like a pending
  // edit and then get published.
  for (const key of Object.values(IMAGE_INPUTS)) values[key] = '';
  return values;
}

export function useMetaState(gameId: string, channel: string) {
  const [payload, setPayload] = useState<MetaPayload | null>(null);
  const [original, setOriginal] = useState<Record<string, MetaFieldView>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The request, with no setState in it. A loader that reaches into component
  // state makes the effect below a synchronous setState, which the react-hooks
  // set-state-in-effect rule rejects for the cascading second render it causes.
  const request = useCallback(async () => {
    const result = await apiGet<MetaPayload>('/api/meta', { query: { gameId, channel } });
    return {
      payload: result.data,
      original: result.data.fields ?? {},
      values: initialValues(result.data),
      exists: Boolean(result.data.exists),
    };
  }, [gameId, channel]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await request();
      setPayload(next.payload);
      setOriginal(next.original);
      setValues(next.values);
      setExists(next.exists);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPayload(null);
      setOriginal({});
      setValues({});
      setExists(false);
    } finally {
      setLoading(false);
    }
  }, [request]);

  // Started through a resolved promise rather than called directly, so the state
  // updates land in a callback after the effect body instead of synchronously
  // inside it. Same load, same error path - only the render it lands on differs.
  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const setValue = useCallback((flag: string, value: string) => {
    setValues((prev) => ({ ...prev, [flag]: value }));
  }, []);

  /** Reset one field to what is published, clearing any staged file with it. */
  const revert = useCallback(
    (flag: string) => {
      setValues((prev) => {
        const next = { ...prev, [flag]: String(original[flag]?.value ?? '') };
        for (const input of Object.values(IMAGE_INPUTS)) next[input] = '';
        return next;
      });
    },
    [original]
  );

  /** Discard everything and start again from the bucket. */
  const revertAll = useCallback(() => {
    setValues(initialValues(payload ?? ({ fields: {} } as MetaPayload)));
  }, [payload]);

  /** Restore a stored draft on top of the loaded values. */
  const applyDraft = useCallback((draft: Record<string, string>) => {
    setValues((prev) => {
      const next = { ...prev };
      for (const [flag, value] of Object.entries(draft)) {
        if (flag in next || Object.values(IMAGE_INPUTS).includes(flag as never)) {
          next[flag] = String(value ?? '');
        }
      }
      return next;
    });
  }, []);

  return {
    payload,
    original,
    values,
    exists,
    loading,
    error,
    setValue,
    revert,
    revertAll,
    applyDraft,
    reload: load,
  };
}

/** The staged local path for an image field, or '' when there is none. */
export function imagePath(values: Record<string, string>, flag: string): string {
  const key = IMAGE_INPUTS[flag as ImageFlag];
  if (!key) return '';
  return String(values[key] ?? '').trim();
}

/** A field is changed when its trimmed text differs from what was loaded. */
function isFieldDirty(
  original: Record<string, MetaField>,
  values: Record<string, string>,
  flag: string
): boolean {
  const field = original[flag];
  if (!field) return false;
  const now = values[flag] ?? '';
  if (field.list) {
    const next = normaliseList(now);
    const previous = normaliseList(field.value);
    // RULE 1. An emptied list is not reportable as a change.
    if (!next.length && previous.length) return false;
    return next.join(' ') !== previous.join(' ');
  }
  return now.trim() !== String(field.value ?? '').trim();
}

/**
 * Whether an image field counts as changed.
 *
 * A staged local path is a real edit even though the URL box beside it is
 * untouched, because the server uploads the file and rewrites the URL itself.
 * Without this the path would be silently dropped on publish, since
 * isFieldDirty only ever reads the URL text.
 */
export function isImageDirty(
  original: Record<string, MetaField>,
  values: Record<string, string>,
  flag: string
): boolean {
  if (!IMAGE_INPUTS[flag as ImageFlag]) return isFieldDirty(original, values, flag);
  return imagePath(values, flag) !== '' || isFieldDirty(original, values, flag);
}

/** The single source of truth for "what would this publish change". */
export function useDirtyFlags(
  original: Record<string, MetaField>,
  values: Record<string, string>,
  order: readonly string[]
): string[] {
  return useMemo(
    () => order.filter((flag) => original[flag] && isImageDirty(original, values, flag)),
    [original, values, order]
  );
}

/**
 * What a field is about to become, for the diff.
 *
 * An image field changed only by a staged file has no new URL yet - the upload
 * rewrites it - so showing the unchanged URL as the "after" would be a lie.
 */
function afterValue(
  original: Record<string, MetaField>,
  values: Record<string, string>,
  flag: string
): string {
  const field = original[flag];
  const value = values[flag] ?? '';
  if (IMAGE_INPUTS[flag as ImageFlag] && !isFieldDirty(original, values, flag)) {
    return `will upload from ${imagePath(values, flag)}`;
  }
  return field?.list ? normaliseList(value).join(', ') : value.trim();
}

/**
 * One before -> after row, or null when the field would not actually be sent.
 *
 * Returning null rather than rendering an empty row keeps the review honest
 * about the two rules the publish path also applies: an emptied list is skipped
 * by the server, and an image changed only by a staged file does not resend its
 * URL.
 */
export function diffRows(
  original: Record<string, MetaField>,
  values: Record<string, string>,
  flags: readonly string[]
): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const flag of flags) {
    const field = original[flag];
    if (!field) continue;
    const before = field.list
      ? normaliseList(field.value).join(', ')
      : String(field.value ?? '').trim();
    const after = afterValue(original, values, flag);
    if (before === after) continue;
    const isImage = Boolean(IMAGE_INPUTS[flag as ImageFlag]);
    rows.push({
      flag,
      label: field.label,
      before,
      after,
      // Cleared is called out in its own field rather than only by an empty
      // "after", because "no description" and "unchanged description" both render
      // as a blank column otherwise.
      cleared: !after && !isImage,
      // An image field's value is a URL (or a staged path): a literal identifier,
      // so it keeps mono. Every other metadata field is prose and is set in sans.
      mono: isImage,
    });
  }
  return rows;
}

/**
 * The publish payload.
 *
 * Only what changed is sent, because the server treats an absent key as "leave
 * whatever is published" - sending the whole form would silently overwrite
 * fields the operator never touched.
 */
export function buildPayload(options: {
  gameId: string;
  channel: string;
  dryRun: boolean;
  original: Record<string, MetaField>;
  values: Record<string, string>;
  flags: readonly string[];
}): Record<string, string | boolean> {
  const { gameId, channel, dryRun, original, values, flags } = options;
  const payload: Record<string, string | boolean> = { gameId, channel, dryRun };

  for (const flag of flags) {
    const field = original[flag];
    if (!field) continue;
    const value = values[flag] ?? '';
    // Absent vs empty is load-bearing on the server: an absent key leaves the
    // published value alone, an emptied text field clears it. An emptied list
    // field is never sent, because a comma list cannot express "no genres" and
    // writing [] would erase the field instead. isFieldDirty already refuses to
    // report an emptied list as changed, so that guard cannot be reached - it is
    // kept as the belt to that braces.
    if (value.trim() === '' && field.list) continue;
    // RULE 2. An image field that changed only because a file was staged must not
    // also resend its unchanged URL: the server would diff the two and report a
    // change the operator never made, and the upload rewrites the URL.
    if (IMAGE_INPUTS[flag as ImageFlag] && !isFieldDirty(original, values, flag)) continue;
    payload[flag] = field.list ? normaliseList(value).join(', ') : value.trim();
  }

  for (const key of Object.values(IMAGE_INPUTS)) {
    const path = String(values[key] ?? '').trim();
    if (path) payload[key] = path;
  }

  return payload;
}
