/**
 * The shell.
 *
 * One rail, and it is the navigation: SectionRail holds the brand and the five
 * sections, and nothing else. There is no top bar. What that rail does NOT hold
 * is the game list - the list was under Games in the rail and crowded the five
 * sections out of its own budget, so it now lives on the Games page as a column
 * beside the detail it selects. The rail is always present, so the content to
 * its right never moves, whatever the section is.
 *
 * So Games is the only section with more than one column, and the only one that
 * requires a selection:
 *
 *   [rail] [game list] [detail]     <- Games
 *   [rail] [detail]                 <- every other section, full width
 *
 * Nothing is reserved for the list on the other four. A launcher publish and a
 * website deploy have nothing to do with whichever game happens to be selected,
 * so their pages must not read as though they did.
 *
 * The five sections, and what each one is:
 *
 *   Games    five tabs, all about the game picked in the list on that page. The
 *            only section that requires a selection.
 *   Launcher the app's own releases plus the game catalog it ships with, as two
 *            sub-sections.
 *   Website  the public site, a separate repository.
 *   Services the local dev servers.
 *   Commands the command reference.
 *
 * Full height, no page scroll - it is a tool someone stares at while working.
 * The list and the detail scroll independently of each other.
 *
 * Data is loaded once on mount and then only on an explicit Refresh. There is no
 * polling and no background revalidation, and that is a decision rather than an
 * omission: a silent refresh would replace the values someone is halfway through
 * reviewing a diff against, which is the one thing this tool must never do.
 */

import { useCallback, useEffect, useMemo } from 'react';

import type { CacheState } from '@lib/api';
import { buildScopes, type GameScope } from '@lib/games';
import { useServer } from '@store/server';
import { useSession, sectionFromHash, type SectionId } from '@store/session';

import { SectionRail } from '@components/SectionRail';
import { GameListPane } from '@components/GameListPane';
import { DetailPane } from '@components/tabs/DetailPane';

import { LauncherSection } from '@components/sections/LauncherSection';
import { SectionPage } from '@components/sections/SectionPage';
import { sectionFor } from '@components/sections/registry';

export function App() {
  const inventory = useServer((state) => state.inventory);
  const loadInventory = useServer((state) => state.loadInventory);
  const loadCatalog = useServer((state) => state.loadCatalog);

  const section = useSession((state) => state.section);
  // setSection is no longer read here: the rail calls it, and the only reason the
  // shell ever needed it was to hand it to the bar it no longer renders.
  const syncSectionFromHash = useSession((state) => state.syncSectionFromHash);
  const reconcile = useSession((state) => state.reconcile);

  // Derived once per inventory change rather than per component, so the list,
  // the header and the tab prefills cannot disagree about what a scope is.
  const scopes = useMemo(() => buildScopes(inventory.data?.inventory ?? []), [inventory.data]);

  // Load once. The catalog is best-effort: GET /api/catalog may not exist on the
  // server yet, and its absence must not be the thing that stops the rail
  // rendering.
  useEffect(() => {
    void loadInventory({ refresh: false });
    void loadCatalog({ refresh: false });
  }, [loadCatalog, loadInventory]);

  // The section is a link. A Back, a Forward or a pasted URL must all land on
  // the section they name, so the store follows the address bar - and rewrites a
  // hash it does not recognise rather than leaving a broken link in place.
  //
  // The first pass only normalises the URL (a bare http://127.0.0.1:4400/ becomes
  // #games and is therefore copyable). It must not call setState: the store's
  // initial value already read the hash, so there is nothing to change.
  useEffect(() => {
    if (!sectionFromHash(window.location.hash)) {
      window.history.replaceState(null, '', `#${useSession.getState().section}`);
    }
    const onHashChange = () => syncSectionFromHash();
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [syncSectionFromHash]);

  // Validate the persisted selection against the inventory, so a key naming a
  // game that has since been deleted falls back rather than rendering an empty
  // detail pane for something that is gone. This runs whatever section is open:
  // leaving Games and coming back must not have silently forgotten the game.
  //
  // BOTH guards are load-bearing. `loading` alone is not enough: on the very
  // first render the entry has not started loading yet, so `loading` is false and
  // `scopes` is empty - reconciling then would wipe the restored selection before
  // the fetch it needs to validate against has even returned. So this waits for
  // DATA, not for the absence of a loading flag.
  const hasInventory = inventory.data !== null;
  useEffect(() => {
    if (!hasInventory) return;
    reconcile(scopes);
  }, [hasInventory, reconcile, scopes]);

  const refresh = useCallback(() => {
    void loadInventory({ refresh: true });
    void loadCatalog({ refresh: true });
  }, [loadCatalog, loadInventory]);

  return (
    // Row, not column: the rail is a permanent left column and the page is its
    // single sibling. The page's width is therefore fixed by the rail alone, so
    // switching sections cannot move it by a pixel. The page's own two columns
    // on Games are inside that sibling, which is why the four other sections
    // get the same width they have always had and nothing is held back for them.
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-canvas">
      {/* A count, not a list: the rail says how many games there are and the
          Games page is where they can be picked. */}
      <SectionRail gameCount={scopes.length} />

      <SectionPageFor
        section={section}
        scopes={scopes}
        loading={inventory.loading}
        ageMs={inventory.ageMs}
        cache={inventory.cache}
        refreshing={inventory.refreshing}
        error={inventory.error}
        onRefresh={refresh}
        onPublished={() => void loadInventory({ refresh: true })}
      />
    </div>
  );
}

/**
 * Which page the section renders.
 *
 * Games and Launcher are COMPOSED: each builds its own page, because Games needs
 * the game list beside its detail and Launcher has its own level-2 strip. Every
 * other section gets the SAME frame - SectionPage with its registry entry's
 * label and lede, wrapping its own component - which is what guarantees the
 * tabpanel id matches the `aria-controls` the rail points at on all of them.
 *
 * Games is the only branch that puts two columns side by side. The list is the
 * left column and the detail is the right one, and the detail is unchanged by
 * that: it still owns `section-games` and its own scroll region, so the list
 * sitting beside it costs it nothing but width.
 *
 * The panels' own `GlobalPanel` headers then read as the second heading inside
 * the page rather than competing with it: the page says which section you are in
 * and what it is for, and the panel says what it does.
 */
function SectionPageFor({
  section,
  scopes,
  loading,
  ageMs,
  cache,
  refreshing,
  error,
  onRefresh,
  onPublished,
}: {
  section: SectionId;
  scopes: GameScope[];
  loading: boolean;
  ageMs: number | null;
  cache: CacheState;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
  onPublished: () => void;
}) {
  // The selected scope is derived ONCE, here, and handed to the detail. The list
  // does not need it - it reads `selectedKey` itself to mark the active row - so
  // there is still exactly one definition of "selected" and two consumers that
  // cannot disagree.
  const selectedKey = useSession((state) => state.selectedKey);
  const selected = useMemo(
    () => scopes.find((scope) => scope.key === selectedKey) ?? null,
    [scopes, selectedKey]
  );

  const games = (
    <DetailPane
      scopes={scopes}
      scope={selected}
      ageMs={ageMs}
      cache={cache}
      refreshing={refreshing}
      error={error}
      onRefresh={onRefresh}
      onPublished={onPublished}
    />
  );

  const gamesPage = (
    // A row of two: the list takes its fixed width, the detail takes the rest
    // and keeps `flex-1 min-w-0` from DetailPane, so it shrinks rather than
    // forcing the whole page to scroll sideways. Each column has its own
    // `dw-scroll` region, so the page never scrolls as one document. Built once
    // because the fallback below must not be able to drift from the real Games
    // page.
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <GameListPane scopes={scopes} loading={loading} error={error} />
      {games}
    </div>
  );

  if (section === 'games') return gamesPage;

  if (section === 'launcher') return <LauncherSection />;

  const definition = sectionFor(section);
  // A registry entry with no component is a COMPOSED section (Games/Launcher,
  // routed above), so reaching here means a development error - an id added to
  // SECTION_IDS with no page. Games is always constructible, so it is what the
  // shell falls back to rather than a blank pane.
  if (!definition?.component) return gamesPage;

  const Component = definition.component;
  return (
    // No title/lede when the registry has no lede: that panel renders its own
    // header, and two headings saying the same word is a defect, not a design.
    <SectionPage
      section={definition.id}
      title={definition.lede ? definition.label : undefined}
      lede={definition.lede}
    >
      <Component />
    </SectionPage>
  );
}
