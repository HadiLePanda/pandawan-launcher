/**
 * One editor per metadata field, shared by the Metadata and Catalog tabs.
 *
 * Both tabs used to walk their own field list, so the same field behaved
 * differently in each - the image fields were a picker in one and a URL box in the
 * other. Rendering by the contract's `list` / `image` / `long` flags keeps them
 * agreeing by construction instead of by discipline.
 *
 * Presentational on purpose: the artwork listing and the suggestions are props, so
 * this has no data dependencies and cannot pull the tabs into an import cycle.
 */

import { useState } from 'react';

import type { ArtworkObject } from '@/types/api';

import { Badge, Button, Field, TextArea, TextInput } from './ui';

export interface FieldSpec {
  flag: string;
  label: string;
  list?: boolean;
  image?: boolean;
  long?: boolean;
}

export interface FieldControlProps {
  field: FieldSpec;
  /** Ties the label to the control. */
  id: string;
  /** What the publisher stores and receives back. */
  value: string;
  /** Display-only, image fields only: `value` may be origin-less. */
  previewUrl?: string;
  onChange: (next: string) => void;
  /** The bucket's artwork for this game and channel, for the image picker. */
  artworks?: ArtworkObject[];
  /** Chips offered for a list field, e.g. the known platforms. */
  suggestions?: string[];
  /** Renders the "changed" badge next to the label. */
  changed?: boolean;
}

/** Split the stored comma string the way the publisher does. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function Chips({
  id,
  value,
  suggestions = [],
  onChange,
}: {
  id: string;
  value: string;
  suggestions?: string[];
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const chips = splitList(value);
  const offered = suggestions.filter((one) => !chips.includes(one));

  const commit = (raw: string) => {
    const next = [...chips];
    for (const item of splitList(raw)) if (!next.includes(item)) next.push(item);
    onChange(next.join(', '));
    setDraft('');
  };

  return (
    <div className="dw-chip-box">
      {chips.map((chip) => (
        <span key={chip} className="dw-chip">
          {chip}
          <button
            type="button"
            aria-label={`Remove ${chip}`}
            onClick={() => onChange(chips.filter((one) => one !== chip).join(', '))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        className="dw-chip-input"
        onChange={(event) => {
          const next = event.target.value;
          // Comma commits, so both typing and pasting a list work.
          if (next.includes(',')) commit(next);
          else setDraft(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(draft);
          } else if (event.key === 'Backspace' && draft === '' && chips.length > 0) {
            onChange(chips.slice(0, -1).join(', '));
          }
        }}
        onBlur={() => commit(draft)}
      />
      {offered.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {offered.map((one) => (
            <button key={one} type="button" className="dw-chip-add" onClick={() => commit(one)}>
              + {one}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ImagePicker({
  id,
  value,
  previewUrl,
  artworks = [],
  onChange,
}: {
  id: string;
  value: string;
  previewUrl?: string;
  artworks?: ArtworkObject[];
  onChange: (next: string) => void;
}) {
  const [typing, setTyping] = useState(false);
  const shown = previewUrl || value;

  return (
    <div className="flex flex-col gap-2">
      {artworks.length > 0 && !typing ? (
        <div className="dw-art-grid">
          {artworks.map((object) => (
            <button
              key={object.key}
              type="button"
              title={object.name}
              aria-pressed={value === object.key || value === object.url}
              className="dw-art-tile"
              onClick={() => onChange(object.key)}
            >
              <img src={object.url} alt={object.name} loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}

      {typing ? (
        <TextInput
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoFocus
        />
      ) : (
        <div className="flex items-center gap-2">
          <span className="truncate font-mono text-[11.5px] text-ink-muted" title={shown}>
            {shown || 'nothing set'}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setTyping(true)}>
            Paste a URL
          </Button>
        </div>
      )}
    </div>
  );
}

export function FieldControl({
  field,
  id,
  value,
  previewUrl,
  onChange,
  artworks,
  suggestions,
  changed,
}: FieldControlProps) {
  return (
    <Field
      label={
        <span className="flex items-center gap-1.5">
          {field.label}
          {changed ? <Badge tone="info">changed</Badge> : null}
        </span>
      }
      htmlFor={id}
    >
      {field.image ? (
        <ImagePicker
          id={id}
          value={value}
          previewUrl={previewUrl}
          artworks={artworks}
          onChange={onChange}
        />
      ) : field.list ? (
        <Chips id={id} value={value} suggestions={suggestions} onChange={onChange} />
      ) : field.long ? (
        <TextArea id={id} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <TextInput id={id} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </Field>
  );
}
