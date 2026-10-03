/**
 * The image field's control: a picker over the bucket, and an upload that
 * selects itself.
 *
 * One component for both the icon and the banner, because the pieces and the
 * rules behind them are identical. Two routes in, and nothing typed:
 *
 *   - the picker, which lists the images already on the bucket for this game and
 *     channel and sets the field's URL when one is clicked;
 *   - the file input, which posts the bytes to /api/art/stage and gets back a real
 *     path, because that is the only way a browser can hand over something the
 *     publisher can upload. See stageArtwork in @lib/artwork.
 *
 * A browser cannot report an absolute path from a file input, so the URL is
 * SHOWN, read-only and in mono - it is what ends up in catalog.json and an
 * operator sometimes needs to copy it - but never edited here.
 */

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { stageArtwork, previewUrlFor, releasePreviewUrl } from '@lib/artwork';
import type { ArtworkObject } from '@/types/api';

import { ImagePreview } from '@components/ImagePreview';
import { ErrorLine } from '@components/ui';

import { FIELD_LABEL, useArtworkObjects } from './ArtworkTab';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/**
 * Whether a stored URL points at this object.
 *
 * The same three forms scripts/lib/artwork.mjs accepts, mirrored because the
 * picker marks the tile it selected itself and cannot wait for a round trip that
 * would have the server mark it. A relative URL has no origin, so it can only
 * match by key.
 */
function references(value: string, object: ArtworkObject): boolean {
  const stored = value.trim();
  if (!stored) return false;
  return stored === object.url || stored === `/${object.key}` || stored.endsWith(`/${object.key}`);
}

/** The object name inside a URL the bucket listing does not contain. */
function nameFromUrl(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? url;
  return withoutQuery.split('/').pop() ?? withoutQuery;
}

/** The last segment of a local path - a staged file's own name. */
function nameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function ImageFieldControl({
  gameId,
  channel,
  /** The metadata flag, e.g. 'icon-url'. Which field this is. */
  flag,
  label,
  /** The current URL text. The text input itself belongs to the parent row. */
  value,
  onChange,
  /** The staged local path, and the setter for it. */
  path,
  onPathChange,
}: {
  gameId: string;
  channel: string;
  flag: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  path: string;
  onPathChange: (next: string) => void;
}) {
  // The listing is marked against this field's CURRENT value, so the tile the
  // operator just clicked highlights itself rather than the published URL.
  const listing = useArtworkObjects({ gameId, channel, field: flag, value });

  const [status, setStatus] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [staging, setStaging] = useState(false);
  const [localPreview, setLocalPreview] = useState('');
  const previewRef = useRef<string>('');

  // Release the blob when it is replaced. A picked file is already held by the
  // browser, so keeping the handle alive for the life of the form leaks memory
  // for nothing.
  useEffect(() => {
    const current = previewRef.current;
    return () => {
      if (current) releasePreviewUrl(current);
    };
  }, []);

  const onPick = async (file: File) => {
    // Previewed from the picked File, which has no URL yet. This is the point of
    // choosing it here: see the replacement before publishing it.
    if (previewRef.current) releasePreviewUrl(previewRef.current);
    const blob = previewUrlFor(file);
    previewRef.current = blob;
    setLocalPreview(blob);

    setUploadError('');
    setStatus('staging…');
    setStaging(true);
    try {
      const staged = await stageArtwork(file);
      // No second step: staging the file IS choosing it. The staged path makes
      // the field dirty, and the publish uploads it and rewrites the URL.
      onPathChange(staged.localPath);
      setStatus(`${staged.name} uploads on publish`);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
      setStatus('');
    } finally {
      setStaging(false);
    }
  };

  const current = value.trim();
  const staged = path.trim() !== '';
  // "icon" / "banner", taken from the contract's own label rather than guessed
  // from the flag.
  const noun = (FIELD_LABEL[flag] ?? label).replace(/\s*URL$/i, '').toLowerCase();

  // A staged file is this field's selection until it is published: the upload
  // writes a new content-addressed object and rewrites the URL itself, so its own
  // tile leads the grid rather than pretending an old object is still chosen.
  const selected = staged
    ? null
    : (listing.objects.find((object) => references(current, object)) ?? null);
  // A value the bucket does not list is kept and named, never cleared. An external
  // URL, or an object that has since been pruned, is still what players are shown,
  // and blanking a field nobody asked to change would blank published artwork.
  const orphan =
    current && !staged && !listing.loading && !listing.error && !selected ? current : '';

  const choose = (object: ArtworkObject) => {
    onChange(object.url);
    // A staged file is an upload that rewrites this very URL and would win over
    // the pick on publish, so choosing an object discards it. Otherwise the grid
    // would look chosen while the upload still took precedence.
    if (staged) onPathChange('');
    setStatus('');
    setUploadError('');
  };

  const tiles: ReactNode[] = [];
  if (staged) {
    tiles.push(
      <Tile
        key="staged"
        url={localPreview}
        name={nameFromPath(path)}
        note="uploads on publish"
        tone="current"
        srLabel={`${nameFromPath(path)} is staged and uploads on publish`}
      />
    );
  }
  if (orphan) {
    tiles.push(
      <Tile
        key="orphan"
        url={orphan}
        name={nameFromUrl(orphan)}
        note="not on the bucket"
        tone="plain"
        srLabel={`${nameFromUrl(orphan)} is the current URL but is not on the bucket`}
      />
    );
  }
  for (const object of listing.objects) {
    const isCurrent = selected?.key === object.key;
    tiles.push(
      <Tile
        key={object.key}
        url={object.url}
        name={object.name}
        note={
          isCurrent
            ? 'current'
            : object.inUse
              ? `used by ${FIELD_LABEL[object.field ?? ''] ?? object.field}`
              : 'superseded'
        }
        tone={isCurrent ? 'current' : object.inUse ? 'other' : 'plain'}
        srLabel={`Use ${object.name} as the ${noun}${isCurrent ? ', currently selected' : ''}`}
        onSelect={isCurrent ? undefined : () => choose(object)}
      />
    );
  }

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept={ACCEPT}
          aria-label={`Choose a ${noun} image to upload and use it`}
          disabled={staging}
          onChange={(event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            // Cleared so choosing the same file twice still fires: this input is
            // uncontrolled and a browser does not re-report an unchanged pick.
            input.value = '';
            if (file) void onPick(file);
          }}
          className="max-w-[210px] text-[11.5px] text-ink-subtle file:mr-2 file:rounded-sm file:border file:border-edge file:bg-surface-2 file:px-2 file:py-1 file:text-[11.5px] file:text-ink-muted hover:file:bg-surface-3"
        />
        {staging && <span className="text-[11.5px] text-ink-subtle">staging…</span>}
        {status && !staging && (
          <span className="truncate text-[11.5px] text-ink-muted">{status}</span>
        )}

        {listing.objects.length > 0 && (
          <button
            type="button"
            onClick={() => void listing.reload(true)}
            disabled={listing.refreshing}
            aria-label={`Re-list the images on the bucket for ${noun}`}
            className="ml-auto shrink-0 rounded-sm border border-edge-strong bg-transparent p-1 text-ink-subtle transition-colors hover:border-ink-subtle hover:text-ink"
          >
            <RefreshCw
              className={`size-3 ${listing.refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {uploadError && <ErrorLine>{uploadError}</ErrorLine>}
      {listing.error && <ErrorLine>{listing.error}</ErrorLine>}

      {listing.loading ? (
        <p className="mt-2 mb-0 text-[11.5px] text-ink-subtle">
          Listing images on the bucket&hellip;
        </p>
      ) : tiles.length ? (
        <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
          {tiles}
        </div>
      ) : (
        <p className="mt-2 mb-0 text-[11.5px] text-ink-subtle">
          No images on the bucket for this game yet, so upload one above.
        </p>
      )}

      {/* The URL is what ends up in catalog.json and what the launcher resolves, so
          it stays visible - read-only, because it is chosen from the grid above
          rather than typed. Mono is correct here: it is a URL. */}
      {current && (
        <p className="mt-2 mb-0 flex min-w-0 flex-row items-baseline gap-2 text-[11.5px]">
          <span className="shrink-0 text-ink-subtle">{staged ? 'replaced on upload' : 'URL'}</span>
          <span className="min-w-0 break-all font-mono text-ink" title={current}>
            {current}
          </span>
        </p>
      )}
    </div>
  );
}

const TILE =
  'flex flex-col items-center gap-1 rounded-sm border border-edge bg-surface-2 p-1.5 text-left transition-colors';

/**
 * One image in the grid.
 *
 * The note is the state: "current", "used by Banner URL", "superseded" or "not on
 * the bucket". Colour is never the only signal - a reader who cannot tell green
 * from grey still reads the word. A superseded tile is dimmed rather than hidden,
 * because it still costs storage and the operator has to see it to prune it.
 */
function Tile({
  url,
  name,
  note,
  tone,
  srLabel,
  onSelect,
}: {
  url: string;
  name: string;
  note: string;
  tone: 'current' | 'other' | 'plain';
  srLabel: string;
  onSelect?: () => void;
}) {
  const body = (
    <>
      <span className="flex h-12 w-full shrink-0 items-center justify-center overflow-hidden rounded-sm border border-edge-strong bg-surface-3">
        <ImagePreview
          url={url}
          alt={name}
          // Contain, not cover: cropping a wide banner removes the part being
          // identified.
          className="size-full object-contain"
        />
      </span>
      <span className="block w-full truncate font-mono text-[10.5px] text-ink" title={name}>
        {name}
      </span>
      <span
        className={`block w-full truncate text-[10.5px] ${tone === 'current' ? 'text-accent' : 'text-ink-subtle'}`}
      >
        {note}
      </span>
    </>
  );

  if (!onSelect) {
    // The current value and the staged upload are shown, not offered: there is
    // nothing to choose about the one that is already chosen.
    return (
      <div className={`${TILE} ${tone === 'current' ? 'border-accent bg-accent/[0.07]' : ''}`}>
        <span className="sr-only">{srLabel}</span>
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={srLabel}
      className={`${TILE} ${tone === 'plain' ? 'opacity-60' : ''} hover:border-ink-subtle`}
    >
      {body}
    </button>
  );
}
