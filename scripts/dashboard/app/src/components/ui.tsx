/**
 * The primitives every panel and tab is built from.
 *
 * Deliberately few. Each one exists because the same decision was otherwise being
 * made twice, and made differently each time.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';

import type { CacheState } from '@lib/api';
import { updatedPhrase } from '@lib/format';

/**
 * The age of the data on screen, plus what the cache said about it.
 *
 * Stale data is SHOWN, not blanked, with a spinner beside it. Blanking the
 * screen to show "this is stale" destroys the page someone was reading, which
 * is a worse outcome than showing a value that is a minute old.
 */
export function DataAge({
  ageMs,
  cache,
  refreshing,
}: {
  ageMs: number | null;
  cache: CacheState;
  refreshing: boolean;
}) {
  const phrase = updatedPhrase(ageMs);
  const stale = cache === 'stale';

  return (
    <span className="flex items-center gap-2 text-[11.5px] text-ink-subtle">
      {(refreshing || stale) && (
        <Loader2
          className="size-3 animate-spin text-ink-subtle"
          aria-hidden="true"
          role={refreshing ? 'status' : undefined}
        />
      )}
      {stale && !refreshing && <span>refreshing&hellip;</span>}
      {phrase && <span className="tabular-nums">{phrase}</span>}
      {!phrase && !stale && <span>not loaded</span>}
      {/* Names the cache state for a screen reader, since it is carried visually
          only by a spinner. */}
      <span className="sr-only">
        {stale ? 'showing data that is being revalidated' : refreshing ? 'refreshing' : ''}
      </span>
    </span>
  );
}

/**
 * A dead end that says what to do next.
 *
 * A blank box is not an empty state: it names the action rather than only
 * reporting the absence. Recessed, not outlined - a dashed 1px edge was the
 * loudest thing on a page with nothing on it, and the fill plus the copy already
 * say "nothing here".
 */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg bg-inset/60 px-4 py-8 text-center">
      <p className="m-0 text-sm font-medium text-ink">{title}</p>
      {children ? <div className="max-w-prose text-xs text-ink-muted">{children}</div> : null}
      {action}
    </div>
  );
}

/** An error, in the one place errors are shown: next to the control that caused them. */
export function ErrorLine({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-2 flex items-start gap-2 text-[12px] text-danger">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** The persistent statement that an edit is not published. */
export function DirtyBar({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-accent/30 border-l-[3px] border-l-accent bg-accent/[0.07] px-3 py-2 text-[12.5px] text-ink-muted">
      {children}
    </div>
  );
}

/** The command output well. Recessed, so the numbers in it are the thing you read. */
export function Log({ lines }: { lines: string }) {
  if (!lines) return null;
  return (
    <pre className="dw-log" aria-live="polite">
      {lines}
    </pre>
  );
}

/** A button row aligned to the trailing edge, wrapping rather than overflowing. */
export function ActionRow({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-edge pt-3">
      {children}
    </div>
  );
}
