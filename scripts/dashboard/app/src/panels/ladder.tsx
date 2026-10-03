/**
 * The version-ladder pieces the Launcher releases page and the game Builds tab
 * both show.
 *
 * Extracted so the two pages cannot drift into presenting the same values in two
 * shapes: a rung is a dot, a role name and a value; a tally is a number with its
 * unit; a status word is the verdict, never a sentence comparing two versions.
 * The game tab reuses them for the same reason it reuses the panel and button
 * primitives - a bump of a game version and a bump of the launcher are the same
 * interaction over different data.
 */
import { cx } from './cx';

/** One rung of the ladder: a dot for the role, the role's name, the value. */
export function Rung({
  label,
  value,
  dot,
  tone,
}: {
  label: string;
  value: string;
  dot: string;
  tone: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={cx('size-1.5 shrink-0 self-center rounded-[1px]', dot)} aria-hidden="true" />
      <span className="text-[11px] text-ink-subtle">{label}</span>
      <span className={cx('font-mono text-[15px] tracking-[-0.01em] whitespace-nowrap', tone)}>
        {value}
      </span>
    </span>
  );
}

/** A number with its unit beside it, so the magnitude reads before the word. */
export function Tally({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-[15px] text-ink">{value}</span>
      <span className="text-[11px] text-ink-subtle">{label}</span>
    </span>
  );
}

/**
 * One version fact, read as its value and then its label.
 *
 * The Releases header is a row of these, so the value is the biggest thing and
 * the label names it beside the value rather than a chip a reader has to pair
 * up across the row. (Rung is the same fact inline, label-first, for the build
 * header.)
 */
export function Fact({
  label,
  value,
  tone = 'text-ink',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={cx('font-mono text-[17px] tracking-[-0.01em] whitespace-nowrap', tone)}>
        {value}
      </span>
      <span className="text-[11px] text-ink-subtle">{label}</span>
    </span>
  );
}

/** The ladder's verdict, as a word. Never a sentence comparing two versions. */
export function StatusWord({ tone, children }: { tone: string; children: string }) {
  return (
    <span className={cx('text-[11px] font-semibold uppercase tracking-[0.06em]', tone)}>
      {children}
    </span>
  );
}
