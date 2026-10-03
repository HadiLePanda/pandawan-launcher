/**
 * Class-name joiner, in its own module so `ui.tsx` exports components only.
 *
 * eslint-plugin-react-refresh warns on any file that exports both components and
 * non-components: HMR can only invalidate a module cleanly when every export is
 * a component, so a mixed module makes a fast refresh fall back to a full reload
 * while editing. `cx` is a plain function and belongs here rather than in ui.tsx.
 *
 * Falsy entries are dropped rather than joined, so a conditional class reads as
 * `cx('base', isActive && 'is-active')` and the `false` does not become the
 * literal string "false" in the DOM.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
