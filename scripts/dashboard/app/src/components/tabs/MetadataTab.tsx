/**
 * Edit a published game's presentation without touching the build.
 *
 * The contract implemented here is not invented: the field list, the
 * catalog-beats-manifest precedence and the absent/empty distinction all come
 * from the server. See scripts/lib/metadata-fields.mjs (FIELDS, IMAGE_FIELDS)
 * and scripts/lib/game-metadata.mjs (readGameMetadata), which backs /api/meta.
 *
 * The hard requirement is that a pending change is unmistakable. An operator
 * about to overwrite a published display name has to see, without reading
 * anything, which fields are about to change - so a changed field gets an accent
 * left border, a tinted surface, a tinted control, and the word "changed". The
 * word is not decoration: colour alone would leave the state invisible to a
 * colour-blind reader.
 *
 * The game and channel arrive as props and are never editable here. Typing an id
 * into a metadata form was the failure mode this whole redesign removes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';

import { streamScript } from '@lib/api';
import { plural } from '@lib/format';
import { DRAFT_KEYS } from '@lib/storage';
import { draftNoteText, useDraft } from '@/hooks/useDraft';
import type { MetaField } from '@/types/api';

import { DiffReview } from '@components/DiffReview';
import { ActionRow, DirtyBadge, DirtyBar, ErrorLine, Log, WarnLine } from '@components/ui';

import { ImageFieldControl } from './ImageFieldControl';
import type { GameTabProps } from './types';
import {
  buildPayload,
  diffRows,
  FIELD_ORDER,
  IMAGE_INPUTS,
  imagePath,
  isImageDirty,
  useDirtyFlags,
  useMetaState,
} from './useMetaState';

/** Where each displayed value came from. The answer to "why is this filled in?" */
const SOURCE_TEXT: Record<string, string> = {
  catalog: 'from catalog',
  manifest: 'inherited from manifest',
  empty: 'not set',
};

function MetaFieldRow({
  gameId,
  channel,
  flag,
  field,
  value,
  dirty,
  isImage,
  path,
  onChange,
  onPathChange,
  onRevert,
}: {
  gameId: string;
  channel: string;
  /** The metadata flag, e.g. 'icon-url'. */
  flag: string;
  field: MetaField;
  value: string;
  dirty: boolean;
  /** True for the two fields that also accept an upload. */
  isImage: boolean;
  path: string;
  onChange: (next: string) => void;
  onPathChange: (next: string) => void;
  onRevert: () => void;
}) {
  return (
    <div
      className={[
        'rounded-sm border border-l-[3px] px-3 py-2 transition-colors',
        dirty ? 'border-accent/30 border-l-accent bg-accent/[0.07]' : 'border-edge bg-surface-2',
      ].join(' ')}
    >
      <div className="mb-1 flex min-h-[22px] items-center justify-between gap-3">
        <div className="flex min-w-0 flex-row items-center gap-2 text-[12px] font-semibold text-ink-muted">
          <span className="truncate">{field.label}</span>
          <DirtyBadge count={dirty ? 1 : 0} />
        </div>
        {/* Where the value came from: the catalog, the manifest, or nothing. */}
        <span className="shrink-0 whitespace-nowrap text-[11px] font-normal text-ink-subtle">
          {SOURCE_TEXT[field.source] ?? field.source}
        </span>
        {dirty && (
          <button
            type="button"
            onClick={onRevert}
            title={`Undo the change to ${field.label}`}
            aria-label={`Undo the change to ${field.label}`}
            className="shrink-0 rounded-sm border border-edge-strong bg-transparent p-1 text-ink-subtle transition-colors hover:border-ink-subtle hover:text-ink"
          >
            <Undo2 className="size-3" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <input
          type="text"
          value={value}
          // An image field's URL is chosen from the bucket picker below, never
          // typed: a URL box invites a paste that the bucket cannot vouch for,
          // and the picker is already showing every object that URL could name.
          // It stays on screen because it is what the launcher resolves, but
          // read-only - and the picker reports a value the bucket does not list.
          onChange={
            isImage
              ? undefined
              : (event) => {
                  onChange(event.target.value);
                }
          }
          readOnly={isImage}
          placeholder={
            isImage ? 'not set - pick an image below' : field.list ? 'comma separated' : undefined
          }
          aria-label={isImage ? `${field.label} (set by picking an image below)` : field.label}
          // The control itself takes the accent: the row is tinted, but the thing
          // being edited is a box, and a tinted box is what the eye lands on.
          //
          // dw-input is mono, which is right for the two URL fields but wrong for
          // the rest: a display name and a description are prose, and prose set in
          // mono is the inconsistency this overrides.
          className={`dw-input ${isImage ? 'font-mono' : 'font-sans'} ${
            dirty ? 'border-accent/45' : ''
          } ${isImage ? 'cursor-default text-ink-muted' : ''}`}
        />

        {isImage && (
          <ImageFieldControl
            gameId={gameId}
            channel={channel}
            flag={flag}
            label={field.label}
            value={value}
            onChange={onChange}
            path={path}
            onPathChange={onPathChange}
          />
        )}
      </div>
    </div>
  );
}

/** Show what would confuse the operator, before they publish rather than after. */
function MetaWarnings({
  hasManifest,
  channelMismatch,
  publishedChannel,
  channel,
  hasCatalogEntry,
  inheritedLabels,
}: {
  hasManifest: boolean;
  channelMismatch: boolean;
  publishedChannel: string | null;
  channel: string;
  hasCatalogEntry: boolean;
  inheritedLabels: string[];
}) {
  const warnings: string[] = [];

  if (!hasManifest) {
    warnings.push(
      'No manifest for this channel. The launcher will only see what the catalog says, so a value that exists only in a manifest cannot be recovered here.'
    );
  }
  if (channelMismatch) {
    warnings.push(
      `The catalog entry is on "${publishedChannel}", not "${channel}". The launcher reads the entry's own channel, so this edit will not appear until that channel is resolved.`
    );
  }
  if (inheritedLabels.length) {
    warnings.push(
      hasCatalogEntry
        ? `Inherited from the manifest, so the catalog does not own them yet: ${inheritedLabels.join(', ')}.`
        : `No catalog entry, so every value below is inherited from the manifest: ${inheritedLabels.join(', ')}.`
    );
  }

  if (!warnings.length) return null;
  return (
    <div>
      {warnings.map((text) => (
        <WarnLine key={text}>{text}</WarnLine>
      ))}
    </div>
  );
}

export function MetadataTab({ gameId, channel, onPublished }: GameTabProps) {
  const {
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
    reload,
  } = useMetaState(gameId, channel);

  const [dryRun, setDryRun] = useState(true);
  const [log, setLog] = useState('');
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  // Which target the draft has already been adopted for. A ref, not state: it
  // gates a one-shot side effect and must not itself cause a render.
  const adopted = useRef('');

  const dirtyFlags = useDirtyFlags(original, values, FIELD_ORDER);
  const rows = useMemo(
    () => diffRows(original, values, dirtyFlags),
    [original, values, dirtyFlags]
  );
  const target = `${gameId} / ${channel}`;
  const draftKey = exists ? DRAFT_KEYS.meta(gameId, channel) : '';

  // A draft from an earlier session is laid over the LOADED values, so an edit
  // interrupted by a reload resumes instead of starting over. The baseline stays
  // the loaded value, not the draft: the diff's "before" has to be what is
  // actually published, or the review would describe the wrong replacement. The
  // note is what stops the restored form reading as live data.
  //
  // The hook owns the adoption pass so the note and the values land together -
  // see the note on `onAdopt` in useDraft for what happens if they are split.
  // `adopted` here is only the post-publish reset: after a real publish the draft
  // must not be adopted again for the same target.
  useEffect(() => {
    if (loading || !exists) return;
    if (adopted.current === draftKey) return;
    adopted.current = draftKey;
  }, [draftKey, exists, loading]);

  const draft = useDraft({
    key: draftKey,
    target,
    dirty: dirtyFlags.length > 0,
    meta: { gameId, channel },
    values: () => values,
    onAdopt: applyDraft,
  });

  // Reverting is a discard: the operator asked for the form to go back to what is
  // published, so the stored copy goes with it. `useDraft` deliberately does not
  // clear the note on its own when the form becomes clean, because that pass also
  // runs on the commit after a restore - and a note that vanished one frame after
  // appearing would leave a restored edit looking like live data.
  const discardDraft = useCallback(() => {
    draft.discard();
    revertAll();
  }, [draft, revertAll]);

  const doPublish = async () => {
    if (!dirtyFlags.length) return;
    setPublishing(true);
    setPublishError(null);
    setLog('');

    const noun = dirtyFlags.length === 1 ? 'change' : 'changes';
    if (
      !dryRun &&
      !window.confirm(
        `Publish ${dirtyFlags.length} metadata ${noun}? Players will see them immediately.`
      )
    ) {
      setPublishing(false);
      return;
    }

    const code = await streamScript(
      '/api/meta/publish',
      buildPayload({ gameId, channel, dryRun, original, values, flags: dirtyFlags }),
      (chunk) => setLog((prev) => prev + chunk)
    );
    setPublishing(false);

    if (dryRun || code !== 0) {
      // A failed or previewed run leaves the edit alone on purpose: the operator's
      // typing is still the only copy of what they meant, and reloading over it
      // would discard the work on exactly the failure they need to read.
      if (code !== 0) {
        setPublishError(`Publishing failed with exit code ${code}. Your edit is still here.`);
      }
      return;
    }

    // A real publish starts from the bucket again, so the draft it leaves behind
    // would resurrect values that are now live and show as a phantom edit.
    draft.discard();
    adopted.current = draftKey;
    await reload();
    onPublished();
  };

  if (loading) {
    return <p className="text-[12.5px] text-ink-subtle">Loading {target}&hellip;</p>;
  }

  if (error) {
    return <ErrorLine>{error}</ErrorLine>;
  }

  if (!exists) {
    return (
      <div className="rounded-lg border border-dashed border-edge-strong px-5 py-8">
        <strong className="text-sm font-semibold">
          {target} is not published yet, so there is nothing to edit.
        </strong>
        <p className="mx-0 mt-1 max-w-lg text-[12.5px] text-ink-subtle">
          Nothing is published for this game on this channel. Publish a build from the Builds tab to
          create the catalog entry and the manifest.
        </p>
      </div>
    );
  }

  const stagedFiles = Object.values(IMAGE_INPUTS).filter((key) => String(values[key] ?? '').trim());
  const inheritedLabels = FIELD_ORDER.filter((flag) => original[flag]?.inherited).map(
    (flag) => original[flag]?.label ?? flag
  );

  // The review summary names what happens on publish, which depends on whether
  // preview-only is ticked. The rows below do not change either way.
  const summary = [
    dryRun
      ? `${plural(rows.length, 'field')} would be sent in preview only. Nothing is published until you untick Preview only.`
      : `${plural(rows.length, 'field')} will be published to ${target}. Unticking Preview only and publishing writes to the bucket.`,
    stagedFiles.length
      ? `${plural(stagedFiles.length, 'artwork file')} will upload on publish.`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {draft.dirty && (
        <DirtyBar>
          <span>{plural(dirtyFlags.length, 'field')} changed and not published yet.</span>
        </DirtyBar>
      )}

      {draft.restored && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-accent/30 bg-accent/[0.07] px-3 py-2 text-[11.5px] leading-[1.5] text-ink-subtle">
          <span>{draftNoteText(draft.restored)}</span>
          <button
            type="button"
            onClick={discardDraft}
            className="shrink-0 border-none bg-none p-0 text-[11.5px] text-ink-muted underline decoration-edge-strong underline-offset-2 transition-colors hover:text-accent hover:decoration-current"
          >
            Discard draft
          </button>
        </div>
      )}

      <MetaWarnings
        hasManifest={payload?.hasManifest ?? false}
        channelMismatch={Boolean(payload?.channelMismatch)}
        publishedChannel={payload?.publishedChannel ?? null}
        channel={channel}
        hasCatalogEntry={Boolean(payload?.hasCatalogEntry)}
        inheritedLabels={inheritedLabels}
      />

      <div className="mt-3 flex flex-col gap-2">
        {FIELD_ORDER.map((flag) => {
          const field = original[flag];
          // The server merges whatever the contract declares; a flag it does not
          // know about is skipped rather than rendered as a nameless input.
          if (!field) return null;
          return (
            <MetaFieldRow
              key={flag}
              gameId={gameId}
              channel={channel}
              flag={flag}
              field={field}
              value={values[flag] ?? ''}
              dirty={isImageDirty(original, values, flag)}
              isImage={flag in IMAGE_INPUTS}
              path={imagePath(values, flag)}
              onChange={(next) => setValue(flag, next)}
              onPathChange={(next) =>
                setValue(IMAGE_INPUTS[flag as keyof typeof IMAGE_INPUTS], next)
              }
              onRevert={() => revert(flag)}
            />
          );
        })}
      </div>

      <DiffReview rows={rows} summary={summary} target={target} />

      <ActionRow>
        <label className="mr-auto flex cursor-pointer flex-row items-center gap-2 text-[12px] text-ink-subtle">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(event) => setDryRun(event.target.checked)}
            className="size-[15px] accent-[var(--color-warn)]"
          />
          Preview only
        </label>

        <button type="button" onClick={discardDraft} className="dw-button">
          Revert all
        </button>

        <button
          type="button"
          onClick={() => void doPublish()}
          disabled={!dirtyFlags.length || publishing}
          className="dw-button dw-button-primary"
        >
          {publishing ? 'publishing…' : 'Publish metadata'}
        </button>
      </ActionRow>

      {publishError && <ErrorLine>{publishError}</ErrorLine>}

      {log && <Log lines={log} />}
    </>
  );
}
