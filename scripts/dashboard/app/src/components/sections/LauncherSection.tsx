/**
 * The Launcher page: the app's own releases and the game catalog it ships with.
 *
 * Full page, no rail, no game selection. Both sub-sections are about the LAUNCHER
 * - "what will this app show a player" - and neither is about the game that
 * happens to be selected, because the rail is not on this page at all. That is
 * deliberate: the launcher publish and the catalog publish are the same bucket
 * write, so they are one place to look when the two disagree.
 *
 * Reuses the same TabStrip Games uses. The strip is scoped to the section rather
 * than to a game, which is why the mechanism is shared and the tab list is not.
 */

import { useSession, type LauncherTabId } from '@store/session';

import { TabStrip } from '@components/tabs/TabStrip';

import { SectionPage } from './SectionPage';
import { LAUNCHER_SUBS, launcherSubFor } from './registry';

/** Ids are prefixed so they can never collide with the game's strip. */
const ID_PREFIX = 'launcher';

export function LauncherSection() {
  const launcherTab = useSession((state) => state.launcherTab);
  const setLauncherTab = useSession((state) => state.setLauncherTab);

  // Validated against the REGISTRY, so a sub-section removed in a later version
  // falls back to the first rather than rendering a component that is gone.
  const definition = launcherSubFor(launcherTab) ?? launcherSubFor('releases');
  const activeId = (definition?.id ?? 'releases') as LauncherTabId;

  return (
    // No page heading and no scope paragraph. SectionPage already supplies the
    // `section-launcher` tabpanel and the page header, and the panel below carries
    // the facts as its own dense header - so a heading or a sentence here would
    // only restate what the layout already shows. The sub-section strip is the
    // whole of the navigation on this page.
    <SectionPage section="launcher">
      <TabStrip
        tabs={LAUNCHER_SUBS}
        active={activeId}
        onSelect={setLauncherTab}
        label="Launcher"
        idPrefix={ID_PREFIX}
      />

      {definition ? (
        // A plain div, NOT role="tabpanel". SectionPage is already the tabpanel
        // for this section, and a tabpanel inside a tabpanel is invalid: assistive
        // tech announces two nested regions for one selection. `aria-labelledby`
        // is kept so the sub-section is still associated with its own tab.
        <div
          id={`${ID_PREFIX}-panel-${activeId}`}
          aria-labelledby={`${ID_PREFIX}-tab-${activeId}`}
          className="mt-4"
        >
          <definition.component />
        </div>
      ) : null}
    </SectionPage>
  );
}
