import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import postcss from 'postcss';

/**
 * style.css is served as a plain stylesheet next to index.html: no bundler, no
 * build step, no type checker. Nothing validates its braces, so a single missing
 * `}` once shipped the whole game-metadata and news editor unstyled - the rules
 * after it were parsed as *descendants* of `.svc-log`, which only renders when a
 * dev service dies on startup, so nobody saw it happen.
 *
 * These assertions are deliberately blunt. Anything that softens them into a
 * warning stops catching the exact bug they exist for.
 */

const cssPath = fileURLToPath(new URL('./style.css', import.meta.url));
const htmlPath = fileURLToPath(new URL('./index.html', import.meta.url));
const appPath = fileURLToPath(new URL('./app.js', import.meta.url));

const css = readFileSync(cssPath, 'utf8');
const html = readFileSync(htmlPath, 'utf8');
const app = readFileSync(appPath, 'utf8');

/** Parse once, and say so plainly if the file is not CSS at all. */
function parseCss(): postcss.Root {
  try {
    return postcss.parse(css, { from: cssPath });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `style.css does not parse, so every rule in it is inert or half-applied.\n` +
        `  ${reason}\n` +
        '  Usually this is an unbalanced brace. Count { and } - they must match.'
    );
  }
}

describe('style.css', () => {
  it('parses', () => {
    const root = parseCss();

    let rules = 0;
    root.walkRules(() => rules++);

    expect(rules).toBeGreaterThan(0);
  });

  it('never nests one rule inside another', () => {
    // The regression this file exists for. A missing `}` does not break the
    // parse - postcss happily reads the remainder as descendants of the
    // unclosed selector - so only an AST walk catches it.
    const root = parseCss();
    const offenders: string[] = [];

    root.walkRules((rule) => {
      // Count only *rule* ancestors. Rules inside @media/@supports are fine,
      // and so are @keyframes steps (nested in an at-rule, never in a rule).
      let parent = rule.parent;
      while (parent) {
        if (parent.type === 'rule') {
          // Deliberate CSS nesting names its parent explicitly with `&`. A rule
          // swallowed by a missing brace never does, so this split cannot hide
          // the bug while still allowing intentional nesting later.
          if (!rule.selector.includes('&')) {
            offenders.push(
              `line ${rule.source?.start.line}: "${rule.selector}" is inside "${parent.selector}"`
            );
          }
          break;
        }
        parent = parent.parent;
      }
    });

    expect(
      offenders,
      `These rules are nested inside another rule, so they only ever apply to ` +
        `elements matching their parent too - in practice, never:\n  ${offenders.join('\n  ')}\n\n` +
        `Usually an unclosed brace above them. Fixing the brace is the whole fix.`
    ).toEqual([]);
  });

  it('has no class that neither the markup nor the script ever uses', () => {
    // The inverse mistake: a rule that survives the brace check but matches
    // nothing, because the markup was renamed underneath it.
    const root = parseCss();
    const haystack = `${html}\n${app}`;

    const classes = new Set<string>();
    root.walkRules((rule) => {
      for (const match of rule.selector.matchAll(/\.(-?[_A-Za-z][\w-]*)/g)) {
        classes.add(match[1]);
      }
    });

    const orphans = [...classes].filter(
      (name) => !haystack.includes(name) && !isBuiltAtRuntime(name)
    );

    expect(
      orphans,
      `These classes are styled but never appear in index.html or app.js, so the ` +
        `rules do nothing:\n  ${orphans.join('\n  ')}\n\n` +
        `Either the markup was renamed, or the rule is left over from removed code.`
    ).toEqual([]);
  });
});

/**
 * Names the dashboard builds by string concatenation are absent from the source
 * by construction - `'is-' + key`, `inv-${platform}` - so searching the text can
 * never find them. Those families are derived from app.js rather than listed, so
 * adding a platform or a service state keeps working without touching this test.
 */
function isBuiltAtRuntime(name: string): boolean {
  for (const family of dynamicClassFamilies()) {
    if (family.has(name)) return true;
  }
  return KNOWN_EXCEPTIONS.has(name);
}

function dynamicClassFamilies(): Set<string>[] {
  const platforms = new Set<string>();
  for (const match of app.matchAll(/PLATFORMS\s*=\s*\[([^\]]*)\]/g)) {
    for (const entry of match[1].split(',')) {
      const value = entry.trim().replace(/^['"`]|['"`]$/g, '');
      if (value) platforms.add(`inv-${value}`);
    }
  }

  // svc-state is rendered as `'is-' + key`, one per STATE_LABELS entry.
  const states = new Set<string>();
  for (const match of app.matchAll(/STATE_LABELS\s*=\s*\{([\s\S]*?)\n\};/g)) {
    for (const entry of match[1].matchAll(/^\s{2}([A-Za-z_][\w-]*)\s*:/gm)) {
      states.add(`is-${entry[1]}`);
    }
  }

  return [platforms, states];
}

/**
 * Classes that are genuinely absent from both files, each with the reason. Kept
 * explicit rather than pattern-matched so an entry has to be justified in review.
 */
const KNOWN_EXCEPTIONS = new Set<string>([
  // metric() colours a card with `'metric is-' + tone`, and both tones come
  // from a ternary (`drift.length ? 'alert' : 'good'`) that cannot be read out
  // of the source as a literal.
  'is-alert',
  'is-good',
  // refreshLauncher() draws each rung as `rung rung-${state}` with the state
  // passed as a positional argument to a local helper.
  'rung-live',
  'rung-pending',
]);
