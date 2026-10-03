/**
 * One editor per non-media metadata field, rendered from the contract's own
 * `list` / `long` flags.
 *
 * Media fields do NOT come through here: icon, banner and screenshots all use
 * the shared MediaPicker, so there is exactly one picture selector in the app
 * and this control stays a text control. Presentational on purpose - the chips
 * for a list field are a prop - so it has no data dependencies.
 */

import { useState } from 'react';

import { Badge, Field, TextArea, TextInput } from './ui';

export interface FieldSpec {
  flag: string;
  label: string;
  list?: boolean;
  long?: boolean;
}

export interface FieldControlProps {
  field: FieldSpec;
  /** Ties the label to the control. */
  id: string;
  /** What the publisher stores and receives back. */
  value: string;
  onChange: (next: string) => void;
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

export function FieldControl({
  field,
  id,
  value,
  onChange,
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
      {field.list ? (
        <Chips id={id} value={value} suggestions={suggestions} onChange={onChange} />
      ) : field.long ? (
        <TextArea id={id} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <TextInput id={id} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </Field>
  );
}
