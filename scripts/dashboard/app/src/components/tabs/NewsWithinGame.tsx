import { NewsPanel } from '@/panels';

/**
 * The tab is scoped to the selection but the content is not: a news item can be
 * about any game or none, so the panel it renders must not be given a scope, or
 * the feed would silently filter itself to whichever game happens to be
 * selected.
 *
 * Wrapping rather than importing keeps the panel's contract intact - it still
 * takes no props and reads the server itself - which is why this function
 * declares no parameters at all. A component with fewer parameters still
 * satisfies `ComponentType<GameTabProps>`.
 */
export function NewsWithinGame() {
  return <NewsPanel />;
}
