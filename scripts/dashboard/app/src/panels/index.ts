/**
 * The panel barrel.
 *
 * Each panel is a default export named after its tab, so the shell renders one
 * with `<CatalogPanel />`. Every panel here is GLOBAL - none acts on the game
 * selected in the rail - and each says so in its own header.
 *
 * Only the panels and the stream helper travel through here. A panel's own types
 * and the shared UI primitives stay at their own path, so this list cannot become
 * a second, stale public surface maintained alongside the modules it re-exports.
 */
export { default as CatalogPanel } from './CatalogPanel';
export { default as NewsPanel } from './NewsPanel';
export { default as LauncherPanel } from './LauncherPanel';
export { default as ServicesPanel } from './ServicesPanel';
export { default as CommandsPanel } from './CommandsPanel';

export { usePublisherStream, verdictLine } from './usePublisherStream';
