/**
 * The one rail: the brand and the five sections.
 *
 * This rail holds SECTIONS and nothing else. The game list used to live here,
 * under Games, and it crowded the five sections out of the rail's own budget -
 * so the list moved into the Games page, where it is a column beside the detail
 * it selects rather than a second navigation system sharing a column with the
 * sections. What moved is only where the list is drawn; what the rail does is
 * unchanged, and Games keeps a count so the rail still says how much there is.
 *
 * A section and the thing it acts on no longer sit in one visual column, and
 * that is the trade. In exchange the rail is five rows tall whatever the bucket
 * holds, so a long list of games can never push Launcher, Website, Services and
 * Commands off the bottom of the screen - which is what a hundred games did.
 *
 * Roving tabindex, Arrow/Home/End and the accent edge are here because the rail
 * is the only thing that changes section. The list cannot: it is a list on the
 * Games page, not a second tablist, so there is nothing to switch between
 * twice.
 *
 * PROSE BUDGET. Nothing in here explains anything - no tooltips, no hints, no
 * per-section sentences. Icon, label and count only. If a label needed
 * explaining, the layout would be wrong; see docs/DASHBOARD_DESIGN.md,
 * "Show, don't tell".
 */

import { useRef, type KeyboardEvent } from 'react';
import { Gamepad2, Globe, Rocket, Server, SquareTerminal, type LucideIcon } from 'lucide-react';

import { useSession, type SectionId } from '@store/session';

import { SECTIONS } from '@components/sections/registry';

/**
 * One icon per section. Lives here rather than in the registry so this file adds
 * no dependency on a file other work is editing; the labels still come from the
 * registry, so there is exactly one source for both words and nothing to keep in
 * step beyond this table.
 */
const SECTION_ICON: Record<SectionId, LucideIcon> = {
  games: Gamepad2,
  launcher: Rocket,
  website: Globe,
  services: Server,
  commands: SquareTerminal,
};

export function SectionRail({ gameCount }: { gameCount: number }) {
  const section = useSession((state) => state.section);
  const setSection = useSession((state) => state.setSection);

  const tablistRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    const ids = SECTIONS.map((entry) => entry.id);
    const current = ids.indexOf(section);
    if (current === -1) return;

    // No ArrowLeft/ArrowRight branch here any more. Those keys used to fold the
    // game list away while staying on Games; the list is on the page now, so
    // there is nothing beside the rail to fold, and swallowing the keys would
    // only make them feel dead. They reach the browser as they always did.
    event.preventDefault();
    let next: SectionId | undefined;
    if (event.key === 'Home') next = ids[0];
    else if (event.key === 'End') next = ids[ids.length - 1];
    else {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      next = ids[(current + step + ids.length) % ids.length];
    }
    if (!next) return;
    setSection(next);
    // Roving tabindex: only the selected section stays in the tab order, so Tab
    // moves on to the page instead of through five stops. Every row is always in
    // the DOM, so this cannot miss.
    tablistRef.current?.querySelector<HTMLButtonElement>(`[data-section="${next}"]`)?.focus();
  };

  return (
    // A navigation landmark as well as a tablist. The landmark is what says
    // "this is how you move around the tool" before anything is read.
    <nav
      aria-label="Dashboard"
      className="flex h-full min-h-0 w-[208px] shrink-0 flex-col border-r border-edge bg-side"
    >
      {/* The mark is at the top of the rail rather than in a bar of its own,
          because the rail is always here: the app keeps its only identity on
          all five sections instead of four fifths of them. */}
      <div className="flex shrink-0 items-center gap-2 px-4 py-2.5">
        <span className="size-3.5 shrink-0 rounded-[3px] bg-accent" aria-hidden="true" />
        <span className="text-[13px] font-semibold tracking-[-0.01em]">Pandawan</span>
      </div>

      {/* Five fixed rows and no overflow: this list cannot grow, so the five
          sections are always all there and none of them can be pushed off the
          bottom. That was the whole point of the move. */}
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Sections"
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        className="flex min-h-0 flex-1 flex-col gap-0.5 border-t border-edge px-2 py-2"
      >
        {SECTIONS.map((entry) => {
          const selected = entry.id === section;
          const Icon = SECTION_ICON[entry.id];
          const isGames = entry.id === 'games';

          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`section-tab-${entry.id}`}
              data-section={entry.id}
              aria-selected={selected}
              aria-controls={`section-${entry.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setSection(entry.id)}
              className={[
                'relative flex w-full shrink-0 items-center gap-2 rounded-sm py-1.5 pr-2 pl-3 text-left transition-colors',
                'text-[13px]',
                // Selection is weight + a surface + the accent edge. Three marks,
                // so the active section survives greyscale and a colour-blind
                // reader, and the edge is the same 2px rule the game row uses.
                selected
                  ? 'bg-surface-2 font-semibold text-ink'
                  : 'font-medium text-ink-subtle hover:bg-surface-2/60 hover:text-ink-muted',
              ].join(' ')}
            >
              {selected && (
                <span className="dw-rule absolute inset-y-0 left-0 w-[2px]" aria-hidden="true" />
              )}
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{entry.label}</span>
              {/* How many rows the Games page's list has. A count, not a
                  navigation: the games are picked on that page, so the rail says
                  the size without duplicating the way in. */}
              {isGames && gameCount > 0 && (
                <span className="ml-auto shrink-0 rounded-full bg-surface-3 px-1.5 text-[10px] font-semibold leading-[1.7] tabular-nums text-ink-subtle">
                  {gameCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
