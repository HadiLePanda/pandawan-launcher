/**
 * The screenshots field as a picker over the artwork library.
 *
 * Screenshots are catalog-only - `manifest: null` in the field contract - so the
 * publisher keeps them out of the manifest write; this edits the same ordered,
 * comma-joined URL list the publisher already splits, so catalog-edit.mjs and the
 * publisher need no new format. Array order IS display order, so reordering is a
 * property of the entry: drag it, or use the arrow buttons the drag handle cannot
 * offer a keyboard user.
 *
 * The images are the objects already on the bucket for this game and channel. A
 * new image reaches the library through the existing artwork upload, which stages
 * bytes through /api/art/stage and publishes them into the same prefix - there is
 * deliberately no second upload path here.
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, X } from 'lucide-react';

import type { ArtworkObject } from '@/types/api';
import { splitList } from '@lib/format';
import { cx } from '@/panels/cx';
import { Thumb } from '@/panels/Thumb';

export interface ScreenshotPickerProps {
  /** The comma-joined URL list the publisher splits, in display order. */
  value: string;
  /** The images on the bucket for this game and channel. */
  objects: ArtworkObject[];
  onChange: (next: string) => void;
}

/** The content-hashed object name for a stored URL, or the URL's own basename. */
function nameFor(url: string, objects: ArtworkObject[]): string {
  const hit = objects.find((object) => object.url === url || object.key === url);
  return hit?.name ?? url.split('/').pop() ?? url;
}

/** Whether a stored value points at an object, by absolute URL or by key. */
function objectFor(url: string, objects: ArtworkObject[]): ArtworkObject | undefined {
  return objects.find((object) => object.url === url || object.key === url);
}

export function ScreenshotPicker({ value, objects, onChange }: ScreenshotPickerProps) {
  const selected = splitList(value);
  // The index being dragged, so the row can dim while it is in flight. A ref
  // would not re-render the drop targets.
  const [drag, setDrag] = useState<number | null>(null);

  const commit = (next: string[]) => onChange(next.join(', '));

  const move = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= selected.length || to >= selected.length) {
      return;
    }
    const next = [...selected];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item as string);
    commit(next);
  };

  const toggle = (object: ArtworkObject) => {
    const at = selected.findIndex((one) => one === object.url || one === object.key);
    if (at >= 0) commit(selected.filter((_, index) => index !== at));
    else commit([...selected, object.url]);
  };

  return (
    <div className="flex flex-col gap-2">
      {selected.length ? (
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
                  className="rounded-sm p-1 text-ink-subtle transition-colors hover:text-ink disabled:cursor-not-allowed disabled:text-ink-faint"
                >
                  <ChevronUp aria-hidden size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${name} later`}
                  disabled={at === selected.length - 1}
                  onClick={() => move(at, at + 1)}
                  className="rounded-sm p-1 text-ink-subtle transition-colors hover:text-ink disabled:cursor-not-allowed disabled:text-ink-faint"
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
        <p className="text-[11.5px] text-ink-subtle">
          No screenshots chosen yet. Pick from the library below.
        </p>
      )}

      {objects.length ? (
        <div className="dw-art-grid">
          {objects.map((object) => {
            const chosen = selected.includes(object.url) || selected.includes(object.key);
            return (
              <button
                key={object.key}
                type="button"
                title={object.name}
                aria-label={chosen ? `Remove ${object.name}` : `Add ${object.name}`}
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
          No images are on the bucket for this game and channel yet. Upload one with the icon or
          banner field; it lands in this same library.
        </p>
      )}
    </div>
  );
}
