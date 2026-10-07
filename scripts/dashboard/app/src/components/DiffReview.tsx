/**
 * What publishing would change, shown as a diff rather than described as one.
 *
 * It renders the same numbers from the same dirty predicates that build the
 * payload, so the review cannot disagree with what would be sent: `rows` is
 * computed by the tab and the publish payload is built from that very list.
 *
 * The published value is never hidden or struck through. It sits beside the new
 * value at the same size, because the only way to review a change is to see both
 * sides of it. Tone carries the direction - recessed for before, accent-washed
 * for after - and the fallback words "(empty)" / "(cleared)" make the distinction
 * in words as well as colour.
 */

import { plural } from '@lib/format';

export interface DiffRow {
  flag: string;
  label: string;
  /** What is published now. '' renders as "(empty)". */
  before: string;
  /** What it would become. '' renders as "(cleared)". */
  after: string;
  /** True when this row is about to lose its value, not merely change it. */
  cleared: boolean;
  /**
   * True when both values are literal identifiers (a URL) and belong in mono. A
   * display name or a description is prose, and prose in mono is the font
   * inconsistency this flag exists to prevent.
   */
  mono?: boolean;
}

export function DiffReview({
  rows,
  summary,
  target,
}: {
  rows: DiffRow[];
  summary: string;
  /** "example-game / alpha", shown so a review always names what it is about. */
  target: string;
}) {
  if (!rows.length) return null;

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-edge bg-surface">
      <div className="border-b border-edge bg-surface-2 px-4 py-3">
        <h3 className="m-0 text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-subtle">
          Review - {plural(rows.length, 'field')} on {target}
        </h3>
        {summary ? <p className="m-0 mt-1 text-[12px] text-ink-subtle">{summary}</p> : null}
      </div>

      <div>
        {rows.map((row) => (
          <div
            key={row.flag}
            className="grid grid-cols-[minmax(7rem,12rem)_minmax(0,1fr)_minmax(0,1fr)] items-stretch [&+&]:border-t [&+&]:border-edge"
          >
            <div className="flex items-start gap-2 break-words border-r border-edge px-3 py-2 text-[11.5px] leading-[1.45] text-ink-muted">
              {row.label}
              {row.cleared && (
                <span className="shrink-0 rounded-full bg-warn/[0.18] px-1.5 text-[10px] font-bold uppercase leading-[1.6] tracking-[0.04em] text-warn">
                  cleared
                </span>
              )}
            </div>

            {/* Recessed and one ink step down: the published value is context,
                not the subject. Mono only for a literal identifier - a display
                name set in mono is the inconsistency the two-font rule removes. */}
            <div
              className={[
                'bg-inset px-3 py-2 text-[12px] leading-[1.5] break-words whitespace-pre-wrap text-ink-faint',
                row.mono ? 'font-mono' : 'font-sans',
              ].join(' ')}
            >
              {row.before || <span className="text-ink-faint/60">(empty)</span>}
            </div>

            {/* The accent is a wash and a leading edge, not coloured body text: a
                whole description in green is harder to read, not easier. */}
            <div
              className={[
                'px-3 py-2 text-[12px] leading-[1.5] break-words whitespace-pre-wrap shadow-[inset_2px_0_0_var(--color-accent)]',
                row.mono ? 'font-mono' : 'font-sans',
                row.cleared
                  ? 'bg-warn/[0.08] shadow-[inset_2px_0_0_var(--color-warn)] text-ink-muted italic'
                  : 'bg-accent/[0.07] text-ink',
              ].join(' ')}
            >
              {row.after || <span>(cleared)</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
