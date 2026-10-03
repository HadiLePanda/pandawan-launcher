/**
 * The one media selector, shared by every image a form edits.
 *
 * A form never prints a picture grid inline. It shows a compact row for the
 * current selection - thumbnail, content-hashed name, and a change/clear
 * affordance - and the grid lives in a popup opened from that row. The same
 * component serves a single slot (icon, banner) and an ordered list
 * (screenshots): `multiple` is the prop, not a second component, so a new media
 * slot costs one call site rather than a copy of this file.
 *
 * New bytes reach the library through the artwork upload the Metadata tab
 * already owns (`/api/art/stage`). The picker only calls `onUpload` - it does not
 * know how the file is staged - so there is deliberately one upload path in the
 * app and this is not a second one.
 */
import { useRef, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, Upload, X } from 'lucide-react';

import type { ArtworkObject } from '@/types/api';
import { splitList } from '@lib/format';
import { cx } from './cx';
import { Thumb } from './Thumb';
import { Button } from './ui';

export interface MediaPickerProps {
  id: string;
  /** The stored value: one key/URL, or a comma-joined list in display order. */
  value: string;
  /** The images on the bucket for this game and channel. */
  objects: ArtworkObject[];
  onChange: (next: string) => void;
  /** Noun for accessible names, e.g. "icon", "banner", "screenshot". */
  noun: string;
  /** Ordered list with add/remove/reorder. False for a single slot. */
  multiple?: boolean;
  /** Display-only: the current selection's preview, including a staged file. */
  previewUrl?: string;
  /** Name of the staged file, shown while it waits to upload on publish. */
  stagedName?: string;
  /** The one upload path. Absent means this slot accepts no file upload. */
  onUpload?: (file: File) => Promise<void>;
  /** True while the library listing is still being read. */
  objectsLoading?: boolean;
  /**
   * The listing's failure, when it could not be read. Distinct from an empty
   * library on purpose: a read that failed renders no objects either, and the
   * popup must not report that as "nothing is on the bucket".
   */
  objectsError?: string | null;
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/** The content-hashed object name for a stored value, or the value's basename. */
function nameFor(value: string, objects: ArtworkObject[]): string {
  const hit = objects.find((object) => object.url === value || object.key === value);
  return hit?.name ?? value.split('/').pop() ?? value;
}

function objectFor(value: string, objects: ArtworkObject[]): ArtworkObject | undefined {
  return objects.find((object) => object.url === value || object.key === value);
}

export function MediaPicker({
  id,
  value,
  objects,
  onChange,
  noun,
  multiple = false,
  previewUrl,
  stagedName,
  onUpload,
  objectsLoading = false,
  objectsError = null,
}: MediaPickerProps) {
  const [open, setOpen] = useState(false);
  // The index being dragged, so the row can dim while it is in flight. A ref
  // would not re-render the drop targets.
  const [drag, setDrag] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const selected = multiple ? splitList(value) : value.trim() ? [value.trim()] : [];
  // Keyed on the STAGED FILE, not on previewUrl. previewUrl is also the display
  // preview of the current selection (MetadataTab passes the published URL for a
  // value the listing cannot resolve), so deriving this from it made a field the
  // operator just cleared render the old image again as "uploads on publish".
  const staged = !multiple && !selected.length && Boolean(stagedName);

  const commit = (next: string[]) => onChange(multiple ? next.join(', ') : (next[0] ?? ''));

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= selected.length || to >= selected.length)
      return;
    const next = [...selected];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item as string);
    commit(next);
  };

  const toggle = (object: ArtworkObject) => {
    const at = selected.findIndex((one) => one === object.url || one === object.key);
    if (at >= 0) {
      commit(selected.filter((_, index) => index !== at));
      return;
    }
    if (multiple) commit([...selected, object.key]);
    else {
      commit([object.key]);
      setOpen(false);
    }
  };

  const pickFile = async (file: File) => {
    if (!onUpload) return;
    setError('');
    setBusy(true);
    try {
      await onUpload(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const isChosen = (object: ArtworkObject) =>
    selected.includes(object.url) || selected.includes(object.key);

  return (
    <div className="flex flex-col gap-2">
      {selected.length ? (
        multiple ? (
          <ul className="flex flex-col gap-1.5">
            {selected.map((url, at) => {
              const name = nameFor(url, objects);
              const object = objectFor(url, objects);
              return (
                <li
                  key={`${url}-${at}`}
                  draggable
                  onDragStart={() => setDrag(at)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    move(drag ?? at, at);
                    setDrag(null);
                  }}
                  onDragEnd={() => setDrag(null)}
                  className={cx(
                    'flex items-center gap-2 rounded-sm border border-edge bg-surface-2 p-1.5',
                    drag === at && 'opacity-60'
                  )}
                >
                  <span
                    className="cursor-grab text-ink-subtle"
                    aria-hidden="true"
                    title="Drag to reorder"
                  >
                    <GripVertical size={14} />
                  </span>
                  <Thumb url={object?.url ?? url} alt={name} shape="wide" />
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-muted"
                    title={name}
                  >
                    {name}
                  </span>
                  <span className="text-[11px] tabular-nums text-ink-subtle">{at + 1}</span>
                  <button
                    type="button"
                    aria-label={`Move ${name} earlier`}
                    disabled={at === 0}
                    onClick={() => move(at, at - 1)}
                    className="rounded-sm p-1 text-ink-subtle transition-colors hover:text-ink disabled:cursor-not-allowed disabled:text-ink-subtle/50"
                  >
                    <ChevronUp aria-hidden size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${name} later`}
                    disabled={at === selected.length - 1}
                    onClick={() => move(at, at + 1)}
                    className="rounded-sm p-1 text-ink-subtle transition-colors hover:text-ink disabled:cursor-not-allowed disabled:text-ink-subtle/50"
                  >
                    <ChevronDown aria-hidden size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    onClick={() => commit(selected.filter((_, index) => index !== at))}
                    className="rounded-sm p-1 text-ink-subtle transition-colors hover:text-status-error"
                  >
                    <X aria-hidden size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex items-center gap-2 rounded-sm border border-edge bg-surface-2 p-1.5">
            <Thumb
              url={
                previewUrl ||
                objectFor(selected[0] as string, objects)?.url ||
                (selected[0] as string)
              }
              alt={nameFor(selected[0] as string, objects)}
              shape="wide"
            />
            <span
              className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-muted"
              title={nameFor(selected[0] as string, objects)}
            >
              {nameFor(selected[0] as string, objects)}
            </span>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => setOpen(true)}
              aria-label={`Change ${noun}`}
            >
              Change
            </Button>
            <Button
              size="sm"
              iconOnly
              variant="quiet"
              onClick={() => {
                setError('');
                onChange('');
              }}
              title={`Clear ${noun}`}
              aria-label={`Clear ${noun}`}
            >
              <X aria-hidden size={14} />
            </Button>
          </div>
        )
      ) : staged ? (
        <div className="flex items-center gap-2 rounded-sm border border-edge bg-surface-2 p-1.5">
          <Thumb url={previewUrl ?? ''} alt={`staged ${noun}`} shape="wide" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-muted">
            {stagedName || 'staged file'}
          </span>
          <span className="text-[11px] text-ink-subtle">uploads on publish</span>
          <Button
            size="sm"
            iconOnly
            variant="quiet"
            onClick={() => {
              setError('');
              onChange('');
            }}
            title={`Clear the staged ${noun}`}
            aria-label={`Clear the staged ${noun}`}
          >
            <X aria-hidden size={14} />
          </Button>
        </div>
      ) : (
        <p className="text-[11.5px] text-ink-subtle">
          {multiple ? `No ${noun}s chosen.` : `No ${noun} chosen.`}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => setOpen(true)}
          aria-label={`Choose ${noun} from the artwork library`}
        >
          {selected.length || staged ? 'Change' : 'Choose'}
        </Button>
        {onUpload ? (
          <>
            <input
              ref={fileRef}
              id={id}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              disabled={busy}
              aria-label={`Upload a ${noun} file`}
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                // Cleared so choosing the same file twice still fires: this input
                // is uncontrolled and a browser does not re-report an unchanged pick.
                input.value = '';
                if (file) void pickFile(file);
              }}
            />
            <Button
              size="sm"
              busy={busy}
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              aria-label={`Upload a ${noun} file`}
            >
              <Upload aria-hidden size={13} />
              Upload
            </Button>
          </>
        ) : null}
      </div>

      {error ? <p className="text-[11.5px] text-status-error">{error}</p> : null}

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${noun} library`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 overflow-auto rounded-lg border border-edge bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="m-0 text-sm font-semibold text-ink">
                {multiple ? `Choose ${noun}s` : `Choose a ${noun}`}
              </h3>
              <Button
                size="sm"
                onClick={() => setOpen(false)}
                aria-label={`Close the ${noun} library`}
              >
                Done
              </Button>
            </div>

            {objectsError ? (
              <p className="text-[11.5px] text-status-error">
                Could not read the artwork library: {objectsError}
              </p>
            ) : objectsLoading ? (
              <p className="text-[11.5px] text-ink-subtle">Reading the artwork library&hellip;</p>
            ) : objects.length ? (
              <div className="dw-art-grid">
                {objects.map((object) => {
                  const chosen = isChosen(object);
                  return (
                    <button
                      key={object.key}
                      type="button"
                      title={object.name}
                      aria-label={
                        multiple
                          ? chosen
                            ? `Remove ${object.name}`
                            : `Add ${object.name}`
                          : `Use ${object.name}`
                      }
                      aria-pressed={chosen}
                      className="dw-art-tile"
                      onClick={() => toggle(object)}
                    >
                      <img src={object.url} alt={object.name} loading="lazy" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11.5px] text-ink-subtle">
                No images are on the bucket for this game and channel yet.
                {onUpload ? ' Upload one to add it to this library.' : ''}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
