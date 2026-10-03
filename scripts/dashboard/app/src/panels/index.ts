/**
 * The panel barrel.
 *
 * Each panel is a default export named after its tab, so the shell can render one
 * with `<CatalogPanel />` and needs to know nothing else. Every panel in this
 * directory is GLOBAL - none of them acts on the game selected in the rail - and
 * each says so in its own header rather than relying on the shell to say it.
 *
 * `GlobalPanel` is re-exported because a panel the shell agent writes (or a
 * future one here) needs the same "this is not game-scoped" framing to stay
 * visually distinct from the game-scoped tabs.
 */
export { default as CatalogPanel } from './CatalogPanel';
export { default as NewsPanel } from './NewsPanel';
export { default as LauncherPanel } from './LauncherPanel';
export { default as ServicesPanel } from './ServicesPanel';
export { default as CommandsPanel } from './CommandsPanel';

export {
  Button,
  Badge,
  Card,
  EmptyState,
  ErrorNote,
  Field,
  GlobalPanel,
  Spinner,
  TextArea,
  TextInput,
} from './ui';
export { cx } from './cx';
export { Thumb } from './Thumb';
export { usePublisherStream, verdictLine, type StreamVerdict } from './usePublisherStream';
export {
  CATALOG_FIELDS,
  CHANNELS,
  PLATFORMS,
  fieldsToGame,
  gameToFields,
  labelForField,
  splitList,
  validateGame,
  type CatalogChangedEntry,
  type CatalogDiff,
  type CatalogDoc,
  type CatalogField,
  type CatalogGame,
  type CatalogResponse,
} from './catalog-contract';
export type { DevService } from './ServicesPanel';
export type { NewsField, NewsItem } from './NewsPanel';
export { ago } from './relativeTime';
