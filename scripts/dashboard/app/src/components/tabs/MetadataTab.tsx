/**
 * Edit a published game's presentation without touching the build.
 *
 * The contract implemented here is not invented: the field list, the
 * catalog-beats-manifest precedence and the absent/empty distinction all come
 * from the server. See scripts/lib/metadata-fields.mjs (FIELDS, IMAGE_FIELDS)
 * and scripts/lib/game-metadata.mjs (readGameMetadata), which backs /api/meta.
 *
 * Each field is rendered by the shared FieldControl, which picks the control from
 * the contract's own flags (list / image / long) - so this tab and the Catalog
 * panel can no longer disagree about how a field behaves. The tab keeps the three
 * things FieldControl has no opinion about: where each value came from, the
 * per-field undo, and the artwork FILE upload, which is the one route a browser
 * cannot express as a value and so cannot live in a presentational control.
 *
 * The hard requirement is that a pending change is unmistakable. An operator
 * about to overwrite a published display name has to see, without reading
 * anything, which fields are about to change - so a changed field gets an accent
 * left border, a tinted surface, and the word "changed" beside its label. The
 * word is not decoration: colour alone would leave the state invisible to a
 * colour-blind reader.
 *
 * The game and channel arrive as props and are never editable here. Typing an id
 * into a metadata form was the failure mode this whole redesign removes.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Info, Undo2 } from 'lucide-react';

import { streamScript } from '@lib/api';
import { previewUrlFor, releasePreviewUrl, stageArtwork } from '@lib/artwork';
import { plural } from '@lib/format';
import { DRAFT_KEYS } from '@lib/storage';
import { KNOWN_CHANNELS, PLATFORMS, type ArtworkObject, type MetaFieldSpec } from '@/types/api';
import { draftNoteText, useDraft } from '@/hooks/useDraft';

import { FieldControl, type FieldSpec } from '@/panels/FieldControl';
import { MediaPicker } from '@/panels/MediaPicker';
import { Badge, Button, Field } from '@/panels/ui';

import { DiffReview } from '@components/DiffReview';
import { ActionRow, DirtyBar, EmptyState, ErrorLine, Log } from '@components/ui';

import { useArtworkObjects } from './ArtworkTab';
import type { GameTabProps } from './types';
import {
  buildPayload,
  diffRows,
  IMAGE_INPUTS,
  isImageDirty,
  type MetaFieldView,
  useDirtyFlags,
  useMetaState,
} from './useMetaState';

/**
 * The one provenance worth stamping on a field: the catalog exists but this
 * value came from the manifest instead, so an edit here does not reach a
 * published catalog entry. "from catalog" is the default and "not set" is
 * already visible in the empty control, so neither is rendered - an always-on
 * badge on every field is noise that hides the exception.
 */
const INHERITED_TEXT = 'from manifest';

/**
 * The chips the contract offers for its two enumerated list fields. Genre and
 * screenshots are free-form, so they get none. The values mirror
 * scripts/lib/metadata-fields.mjs (CHANNELS) and the launcher's platform set.
 */
const SUGGESTIONS: Record<string, string[]> = {
  'supported-platforms': [...PLATFORMS],
  'available-channels': [...KNOWN_CHANNELS],
};

/**
 * Which column a field belongs to. Media holds the images; everything else is
 * Identity, so a field added to the server contract lands in Identity without a
 * client change rather than disappearing from the form.
 */
const MEDIA_FLAGS = new Set(['icon-url', 'banner-url', 'screenshots']);

/** The presentational spec FieldControl renders from, straight off the served contract. */
function specFor(spec: MetaFieldSpec): FieldSpec {
  return {
    flag: spec.flag,
    label: spec.label,
    list: spec.list,
    long: spec.long,
  };
}

/**
 * A small info affordance, so an explanation does not sit in the form as prose.
 *
 * Revealed on hover (the native `title`) and on click/tap (the toggle), because
 * a hover-only note is unreachable by touch and a click-only one is invisible
 * until it is needed.
 */
function InfoNote({ note }: { note: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        title={note}
        aria-label={`More: ${note}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="border-none bg-none p-0 text-ink-subtle transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action"
      >
        <Info aria-hidden size={13} />
      </button>
      {open ? (
        <span
          role="note"
          className="absolute top-5 left-0 z-10 w-64 rounded-sm border border-edge bg-surface-3 px-2 py-1.5 text-[11.5px] leading-[1.5] text-ink-muted shadow-lg"
        >
          {note}
        </span>
      ) : null}
    </span>
  );
}

/** One labelled column of the form. The heading is what makes the grouping scan. */
function MetadataGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function MetaFieldRow({
  spec,
  field,
  value,
  artworks,
  dirty,
  showInherited,
  onChange,
  onPathChange,
  onRevert,
}: {
  /** The served contract entry: names the control and its label. */
  spec: MetaFieldSpec;
  field: MetaFieldView;
  value: string;
  artworks: ArtworkObject[];
  dirty: boolean;
  /** True only when the value is inherited from the manifest under a catalog entry. */
  showInherited: boolean;
  onChange: (next: string) => void;
  onPathChange: (next: string) => void;
  onRevert: () => void;
}) {
  const flag = spec.flag;
  const isImage = spec.image;
  const isScreenshots = flag === 'screenshots';
  const isMedia = isImage || isScreenshots;
  // The staged file's blob and name, held here so the row shows the chosen
  // picture before the upload rewrites the URL on publish.
  const [stagedPreview, setStagedPreview] = useState('');
  const [stagedName, setStagedName] = useState('');
  const previewRef = useRef('');

  // Release the blob when the field goes away. A picked file is already held by
  // the browser, so keeping the handle alive for the life of the form leaks.
  useEffect(() => {
    const ref = previewRef;
    return () => {
      if (ref.current) releasePreviewUrl(ref.current);
    };
  }, []);

  // A value that is a bucket key resolves to its object's URL for display; the
  // saved value stays the raw key. Falls back to the server's preview for a
  // published URL the listing cannot name.
  const picked = artworks.find((object) => object.key === value.trim());
  const previewUrl = isImage ? stagedPreview || picked?.url || field.previewUrl : undefined;
  const noun = isScreenshots ? 'screenshot' : field.label.replace(/\s*URL$/i, '').toLowerCase();

  const clearStaged = () => {
    setStagedPreview('');
    setStagedName('');
    if (previewRef.current) releasePreviewUrl(previewRef.current);
    previewRef.current = '';
    onPathChange('');
  };

  const handleChange = (next: string) => {
    // Choosing a library image supersedes a staged upload, which would otherwise
    // win on publish and make the visible choice a lie.
    if (isImage) clearStaged();
    onChange(next);
  };

  const handleUpload = async (file: File) => {
    if (previewRef.current) releasePreviewUrl(previewRef.current);
    const blob = previewUrlFor(file);
    previewRef.current = blob;
    setStagedPreview(blob);
    setStagedName(file.name);
    // Staging the file IS choosing it: the path makes the field dirty and the
    // publish uploads the bytes and rewrites the URL. The one upload path.
    const staged = await stageArtwork(file);
    onPathChange(staged.localPath);
  };

  return (
    <div
      className={[
        'rounded-sm border border-l-[3px] px-3 py-2 transition-colors',
        dirty ? 'border-accent/30 border-l-accent bg-accent/[0.07]' : 'border-edge bg-surface-2',
      ].join(' ')}
    >
      <div className="mb-1 flex min-h-[22px] items-center justify-between gap-3">
        {showInherited ? <Badge tone="warn">{INHERITED_TEXT}</Badge> : <span />}
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

      {isMedia ? (
        <Field
          label={
            <span className="flex items-center gap-1.5">
              {spec.label}
              {dirty ? <Badge tone="info">changed</Badge> : null}
            </span>
          }
          htmlFor={`meta-field-${flag}`}
        >
          <MediaPicker
            id={`meta-field-${flag}`}
            value={value}
            objects={artworks}
            onChange={handleChange}
            noun={noun}
            multiple={isScreenshots}
            previewUrl={previewUrl}
            stagedName={stagedName}
            onUpload={isImage ? handleUpload : undefined}
          />
        </Field>
      ) : (
        <FieldControl
          field={specFor(spec)}
          id={`meta-field-${flag}`}
          value={value}
          onChange={handleChange}
          suggestions={SUGGESTIONS[flag]}
          changed={dirty}
        />
      )}
    </div>
  );
}

/**
 * The conditions that stop an edit from reaching a catalog entry, collapsed to
 * a word each. The sentence that explains *why* lives behind the info icon, so
 * the form scans as fields rather than as prose.
 */
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
  const words: string[] = [];
  const notes: string[] = [];

  if (!hasManifest) {
    words.push('no manifest');
    notes.push('No manifest for this channel: the launcher sees only what the catalog says.');
  }
  if (channelMismatch) {
    words.push('channel mismatch');
    notes.push(
      `The catalog entry is on "${publishedChannel}", not "${channel}", so this edit will not appear until that channel is resolved.`
    );
  }
  if (inheritedLabels.length && !hasCatalogEntry) {
    words.push('manifest only');
    notes.push(
      `No catalog entry, so every value below is inherited from the manifest: ${inheritedLabels.join(', ')}.`
    );
  }

  if (!words.length) return null;
  return (
    <p className="mb-3 flex items-center gap-2 text-[11.5px] text-warn">
      <AlertTriangle aria-hidden size={13} className="shrink-0" />
      <span className="font-medium">{words.join(' · ')}</span>
      <InfoNote note={notes.join(' ')} />
    </p>
  );
}

export function MetadataTab({ gameId, channel, onPublished }: GameTabProps) {
  const {
    payload,
    original,
    values,
    fieldSpec,
    exists,
    loading,
    error,
    setValue,
    revert,
    revertAll,
    applyDraft,
    reload,
  } = useMetaState(gameId, channel);

  // One listing for both image fields. The shared control marks the chosen tile
  // itself, so a single bucket read is enough and the two pickers cannot drift
  // into offering different sets of images.
  const artworks = useArtworkObjects({ gameId, channel });

  const [dryRun, setDryRun] = useState(true);
  const [log, setLog] = useState('');
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  // Which target the draft has already been adopted for. A ref, not state: it
  // gates a one-shot side effect and must not itself cause a render.
  const adopted = useRef('');

  const order = useMemo(() => fieldSpec.map((spec) => spec.flag), [fieldSpec]);
  const dirtyFlags = useDirtyFlags(original, values, order);
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
      <EmptyState title={`${target} is not published yet`}>
        Publish a build from the Builds tab to create the catalog entry and the manifest.
      </EmptyState>
    );
  }

  const stagedFiles = Object.values(IMAGE_INPUTS).filter((key) => String(values[key] ?? '').trim());
  const inheritedLabels = fieldSpec
    .filter((spec) => original[spec.flag]?.inherited)
    .map((spec) => original[spec.flag]?.label ?? spec.flag);

  const mediaFields = fieldSpec.filter((spec) => MEDIA_FLAGS.has(spec.flag));
  const identityFields = fieldSpec.filter((spec) => !MEDIA_FLAGS.has(spec.flag));

  const renderField = (spec: MetaFieldSpec) => {
    const field = original[spec.flag];
    // The server ships the contract; a flag it does not also resolve a current
    // value for is skipped rather than rendered as a nameless input.
    if (!field) return null;
    return (
      <MetaFieldRow
        key={spec.flag}
        spec={spec}
        field={field}
        value={values[spec.flag] ?? ''}
        artworks={artworks.objects}
        dirty={isImageDirty(original, values, spec.flag)}
        showInherited={Boolean(payload?.hasCatalogEntry) && field.source === 'manifest'}
        onChange={(next) => setValue(spec.flag, next)}
        onPathChange={(next) =>
          setValue(IMAGE_INPUTS[spec.flag as keyof typeof IMAGE_INPUTS], next)
        }
        onRevert={() => revert(spec.flag)}
      />
    );
  };

  // Only what the summary cannot already read off the review: which staged
  // files upload, and that publishing is a preview. The review header already
  // names the target and the count, and the Preview toggle sits below it.
  const summary = stagedFiles.length
    ? `${plural(stagedFiles.length, 'artwork file')} will upload on publish.`
    : '';

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

      <div className="mt-3 grid items-start gap-4 lg:grid-cols-2">
        <MetadataGroup title="Identity">{identityFields.map(renderField)}</MetadataGroup>

        <MetadataGroup title="Media">
          {mediaFields.length ? (
            mediaFields.map(renderField)
          ) : (
            <p className="text-[12.5px] text-ink-subtle">No media fields in the contract.</p>
          )}
        </MetadataGroup>
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

        <Button onClick={discardDraft}>Revert all</Button>

        <Button
          variant="primary"
          onClick={() => void doPublish()}
          disabled={!dirtyFlags.length || publishing}
          busy={publishing}
        >
          Publish metadata
        </Button>
      </ActionRow>

      {publishError && <ErrorLine>{publishError}</ErrorLine>}

      {log && <Log lines={log} />}
    </>
  );
}
