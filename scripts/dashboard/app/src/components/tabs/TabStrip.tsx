/**
 * The level-2 strip, used by Games and by Launcher.
 *
 * ONE component for both, because they are the same interaction: a tablist over a
 * set of sibling pages that share a heading. Games scopes it to the selected game;
 * Launcher scopes it to the section. Same aria-selected, same roving tabindex,
 * same arrow-key handling, so one mental model covers the section bar, the game
 * strip and the launcher strip - three levels of navigation that still feel like
 * one tool.
 *
 * The tabs arrive as a prop rather than being imported. That is what lets a strip
 * scoped to a game and a strip scoped to a section share an implementation: the
 * registry owns the ids, this owns the behaviour.
 */

import { useRef } from 'react';

export interface StripTab {
  id: string;
  label: string;
  hint: string;
}

export function TabStrip<T extends string>({
  tabs,
  active,
  onSelect,
  /** Names the group for assistive tech, and scopes the element ids. */
  label,
  /** Prefixes the tab/tabpanel ids. Must be unique per strip on the page. */
  idPrefix,
}: {
  tabs: readonly (StripTab & { id: T })[];
  active: T;
  onSelect: (id: T) => void;
  label: string;
  idPrefix: string;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  // Arrow keys move between tabs, which is what a tablist is expected to do. Not
  // while typing: a caret in the description box moves the whole page's section
  // when you press Left or Right to fix a typo, which is both a wrong-page
  // surprise and a half-finished form left on another tab.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select')) return;

    const ids = tabs.map((tab) => tab.id);
    const current = ids.indexOf(active);
    if (current === -1) return;

    event.preventDefault();
    let next: T | undefined;
    if (event.key === 'Home') next = ids[0];
    else if (event.key === 'End') next = ids[ids.length - 1];
    else {
      const step = event.key === 'ArrowRight' ? 1 : -1;
      next = ids[(current + step + ids.length) % ids.length] as T | undefined;
    }
    if (!next) return;
    onSelect(next);
    // Roving tabindex: only the selected tab stays in the tab order, so Tab moves
    // past the whole strip to the panel instead of through every stop.
    stripRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
  };

  return (
    <div
      ref={stripRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      // Scrolls inside its own box rather than wrapping: a wrapped second row of
      // tabs reads as a second page header.
      className="flex shrink-0 items-center gap-1 overflow-x-auto rounded-sm border border-edge bg-inset p-1"
    >
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            data-tab={tab.id}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            title={tab.hint}
            onClick={() => onSelect(tab.id)}
            className={[
              'shrink-0 whitespace-nowrap rounded border-none bg-transparent px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              selected
                ? 'bg-surface-2 text-ink shadow-[inset_0_-2px_0_var(--color-accent)]'
                : 'text-ink-subtle hover:bg-surface-2 hover:text-ink-muted',
            ].join(' ')}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
