/**
 * The SECTION registry, and the Launcher's sub-sections. THIS IS THE LEVEL-1
 * EXTENSION POINT.
 *
 * The dashboard is two levels deep and this is the top of it:
 *
 *   Games    REQUIRES a game selection. Its level-2 tabs are registered in
 *            components/tabs/registry.tsx.
 *   Launcher two sub-sections, no selection.
 *   Website  the public site, a separate repository. No selection.
 *   Services the local dev servers. No selection.
 *   Commands the command reference. No selection.
 *
 * Everything except Games is a full-page section: it replaces the detail pane
 * ENTIRELY. A launcher publish and a website deploy have nothing to do with
 * whichever game happens to be selected, so the page must not read as though it
 * were about that game.
 *
 * The RAIL is separate from all of this. SectionRail is permanent and holds the
 * five sections; the game list is the Games page's own left column, NOT part of
 * the rail - so this file is where the sections come from and SectionRail is
 * where they are drawn.
 *
 * ============================================================================
 * ADDING A TOP-LEVEL SECTION
 * ============================================================================
 *
 *  1. Write the component. Take no props at all: a section that needs a gameId
 *     belongs in Games, not here. The panels read the server themselves through
 *     @lib/api, so a prop would suggest an influence they do not have.
 *  2. Add one entry to SECTIONS below - `id`, `label` and the `component` - plus
 *     the id's icon in SECTION_ICON in components/SectionRail.tsx. Games and
 *     Launcher are the exceptions: they omit `component` because each builds its
 *     own page and App routes them before this registry is consulted.
 *  3. Add the id to SECTION_IDS in @store/session.
 *
 * The rail, the roving tabindex, the arrow keys, the hash deep-link and the
 * reconciliation of a stale persisted id all come from the shell.
 *
 * ============================================================================
 * ADDING A LAUNCHER SUB-SECTION
 * ============================================================================
 *
 *  1. Write the component in panels/ (or components/sections/).
 *  2. Add one entry to LAUNCHER_SUBS below.
 *  3. Add the id to LAUNCHER_TAB_IDS in @store/session.
 *
 * Launcher uses the same strip mechanism as Games, scoped to the section rather
 * than to a game - which is why the strip takes its tabs as a prop rather than
 * importing a registry of its own.
 */

import type { ComponentType } from 'react';

import type { LauncherTabId, SectionId } from '@store/session';

import { CatalogPanel, CommandsPanel, LauncherPanel, ServicesPanel } from '@/panels';

import { WebsitePanel } from './WebsitePanel';

export interface SectionDefinition {
  id: SectionId;
  label: string;
  /**
   * The one sentence the page header shows: what this page is FOR.
   *
   * Optional, and set only where the section's component does NOT already say it.
   * Services and Commands wrap themselves in GlobalPanel, which carries a title
   * and a subtitle; giving those a second heading here would print the same word
   * twice. Website has no header of its own, so its lede lives here.
   *
   * Paired with `title` in SectionPage, which drops both when this is absent.
   */
  lede?: string;
  /**
   * Rendered as the tab's panel. Takes no props: nothing here is about a game.
   *
   * OMITTED for a COMPOSED section. Games and Launcher each build their own page
   * - Games needs the game list beside its detail, Launcher its own sub-section
   * strip - and App routes those two ids before it ever reads this field. The
   * absence of a component is therefore the marker, so there is no stub to
   * render by accident and no second list of composed ids to keep in step.
   */
  component?: ComponentType;
}

/**
 * The order the sections appear in, and the order SECTION_IDS uses. Games first
 * because that is where work starts; Commands last because it is a reference you
 * visit, not a place you work.
 */
export const SECTIONS: readonly SectionDefinition[] = [
  {
    id: 'games',
    label: 'Games',
    // No component: Games builds its own page and carries the game header.
  },
  {
    id: 'launcher',
    label: 'Launcher',
    // No component: LauncherSection builds its own page, because it has a strip.
  },
  {
    id: 'website',
    label: 'Website',
    lede: 'Its content comes from R2, so a launcher publish updates the page without a deploy.',
    component: WebsitePanel,
  },
  {
    id: 'services',
    label: 'Services',
    // No lede: ServicesPanel's own GlobalPanel header says what this is.
    component: ServicesPanel,
  },
  {
    id: 'commands',
    label: 'Commands',
    // No lede: CommandsPanel's own GlobalPanel header says what this is.
    component: CommandsPanel,
  },
];

export function sectionFor(id: SectionId): SectionDefinition | undefined {
  return SECTIONS.find((section) => section.id === id);
}

export interface LauncherSubDefinition {
  id: LauncherTabId;
  label: string;
  /** Names the sub-section on hover. Consumed by the Launcher's TabStrip. */
  hint: string;
  component: ComponentType;
}

/**
 * The Launcher's two sub-sections.
 *
 * Releases is the app's own version ladder and its publish verbs. Catalog is the
 * game index the launcher reads. They belong together because they are two halves
 * of one fact - what a player sees when the app opens - and because they are
 * published by the same bucket write, so a stale catalog is a symptom of a stale
 * release far more often than not.
 */
export const LAUNCHER_SUBS: readonly LauncherSubDefinition[] = [
  {
    id: 'releases',
    label: 'Releases',
    hint: 'The version players are downloading, what CI has built, and the keys it signed with.',
    component: LauncherPanel,
  },
  {
    id: 'catalog',
    label: 'Catalog',
    hint: 'Every game the launcher can see, and how the published catalog differs from the local one.',
    component: CatalogPanel,
  },
];

export function launcherSubFor(id: LauncherTabId): LauncherSubDefinition | undefined {
  return LAUNCHER_SUBS.find((sub) => sub.id === id);
}
