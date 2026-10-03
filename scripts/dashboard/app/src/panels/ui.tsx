/**
 * Primitives for the global panels, kept inside panels/ rather than in
 * ../components/ui.
 *
 * The shared component library is owned by the shell agent and its export names
 * are not part of the contract handed to this agent - only the names were, not
 * the prop signatures. Importing a component and guessing `variant="danger"`
 * against an unknown API produces a type error in *their* build, which is a
 * worse outcome than having a local one. So this file mirrors the same component
 * names (Button / Card / Field / Badge / EmptyState / Spinner) and is styled
 * from the project's own theme tokens, which makes swapping to the shared
 * library a change of import path rather than a rewrite.
 */
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { Loader2 } from 'lucide-react';

import { cx } from './cx';

const BTN_BASE =
  'inline-flex items-center justify-center gap-2 rounded-md border text-sm font-medium ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-canvas focus-visible:ring-action disabled:cursor-not-allowed disabled:opacity-40';

const BTN_VARIANT: Record<string, string> = {
  primary: 'bg-action text-black border-action hover:bg-action-hover hover:border-action-hover',
  secondary: 'bg-surface-light text-ink border-border hover:bg-surface-hover',
  danger: 'bg-transparent text-status-error border-status-error/60 hover:bg-status-error/10',
  quiet: 'bg-transparent text-ink-muted border-transparent hover:bg-surface-light hover:text-ink',
};

const BTN_SIZE: Record<string, string> = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-9 px-3',
  lg: 'h-10 px-4',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BTN_VARIANT | string;
  size?: keyof typeof BTN_SIZE | string;
  /** Square-ish control for an icon only. `aria-label` is then mandatory. */
  iconOnly?: boolean;
  busy?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={cx(
        BTN_BASE,
        BTN_VARIANT[variant] ?? BTN_VARIANT.secondary,
        BTN_SIZE[size] ?? BTN_SIZE.md,
        iconOnly && 'w-9 px-0',
        className
      )}
      {...rest}
    >
      {busy ? <Loader2 aria-hidden size={14} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

/**
 * A large flat panel. Reads by its FILL against the canvas, not by an outline.
 *
 * This is the "services, commands" shape the user was complaining about, and the
 * border was doing the work the fill should have been doing. `surface` against
 * `canvas` is 1.16:1 - a real step, visible without being loud - so the panel
 * separates on its own and the 1px line is not needed to find its edge.
 *
 * The border stays as a fallback for callers that override className with their
 * own border colour, which is the correct way to say "this boundary means
 * something" (see the danger and editor panels in CatalogPanel). Callers that
 * add a plain `border-*` class here must name a token: an uncoloured
 * `border-border` was the original bug, but any bare `border` inherits
 * currentColor and reintroduces it.
 */
export function Card({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-lg bg-surface p-4', className)} {...rest}>
      {children}
    </div>
  );
}

const BADGE_TONE: Record<string, string> = {
  neutral: 'border-border text-ink-muted bg-surface-light',
  good: 'border-action/50 text-action bg-action/10',
  warn: 'border-ember/50 text-ember bg-ember/10',
  bad: 'border-status-error/50 text-status-error bg-status-error/10',
  // `info` asked for a `blue` token that this palette has never defined, so it
  // emitted no rule at all and every info badge rendered with no colour at all.
  // The neutral styling is the honest replacement: it says "informational" by
  // being quiet, without inventing a hue that would then compete with the
  // channel and platform identities.
  info: 'border-border text-ink-muted bg-surface-light',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: keyof typeof BADGE_TONE | string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        BADGE_TONE[tone] ?? BADGE_TONE.neutral,
        className
      )}
    >
      {children}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  action,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-xs font-medium text-ink-muted">
          {label}
          {required ? <span className="text-status-error"> *</span> : null}
        </label>
        {action}
      </div>
      {children}
      {error ? (
        <p className="text-xs text-status-error">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-dim">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL =
  'w-full rounded-md border border-border bg-canvas px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-ink-subtle focus:border-action focus:outline-none focus:ring-1 focus:ring-action';

// Forwarded so a form can focus its first control - the panel opens its editor and
// the operator's next keystroke should land in it.
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(CONTROL, className)} {...rest} />;
  }
);

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(CONTROL, 'min-h-24 resize-y leading-relaxed', className)}
      {...rest}
    />
  );
});

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-muted">
      <Loader2 aria-hidden size={16} className="animate-spin" />
      {label}
    </span>
  );
}

// Re-exported from the shared library rather than kept as a second copy: two
// empty states that render differently is exactly the drift this file was meant
// to be a temporary bridge for.
export { EmptyState } from '@components/ui';

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-status-error/50 bg-status-error/10 px-3 py-2 text-sm text-status-error"
    >
      {children}
    </p>
  );
}

/**
 * A heading row used to make a global panel read as not-game-scoped.
 *
 * Every panel in this directory is global: it does not act on the game selected
 * in the rail. That distinction is invisible in markup, so it is stated in the
 * header of each panel rather than left to be inferred from a selection that
 * does not apply.
 */
export function GlobalPanel({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {subtitle ? <p className="mt-0.5 max-w-2xl text-xs text-ink-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
