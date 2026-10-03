import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import postcss from 'postcss';

/**
 * src/styles.css is hand-written and compiled by Tailwind, so nothing checks its
 * braces. A missing `}` does NOT break the parse - it silently makes every
 * following rule a descendant of the unclosed selector. That exact mistake once
 * swallowed 24 rules into `.svc-log`, which only renders when a dev service dies,
 * so the whole metadata and news editor shipped unstyled and nothing looked
 * broken enough to report.
 *
 * These assertions are deliberately blunt. Softening one into a warning stops it
 * catching the bug it exists for.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, 'src');
const cssPath = path.join(srcDir, 'styles.css');

const css = readFileSync(cssPath, 'utf8');

/** Parse once, and say plainly if the file is not CSS at all. */
function parseCss(): postcss.Root {
  try {
    return postcss.parse(css, { from: cssPath });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `src/styles.css does not parse, so every rule in it is inert or half-applied.\n` +
        `  ${reason}\n` +
        '  Usually an unbalanced brace. Count { and } - they must match.'
    );
  }
}

/** Every .ts/.tsx under src/, concatenated. The stylesheet is not part of it. */
function sourceText(): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) parts.push(readFileSync(full, 'utf8'));
    }
  };
  walk(srcDir);
  return parts.join('\n');
}

describe('dashboard src/styles.css', () => {
  it('parses', () => {
    const root = parseCss();

    let rules = 0;
    root.walkRules(() => rules++);

    expect(rules).toBeGreaterThan(0);
  });

  it('never nests one rule inside another', () => {
    // The regression this file exists for. A missing `}` does not break the parse
    // - postcss reads the remainder as descendants of the unclosed selector - so
    // only an AST walk catches it.
    const root = parseCss();
    const offenders: string[] = [];

    root.walkRules((rule) => {
      // Count only *rule* ancestors. Rules inside @layer/@media are fine, and so
      // are @keyframes steps (nested in an at-rule, never in a rule).
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

  it('has no class that no source file uses', () => {
    // The inverse mistake: a rule that survives the brace check but matches
    // nothing, because the markup was renamed underneath it.
    const root = parseCss();
    const haystack = sourceText();

    const classes = new Set<string>();
    root.walkRules((rule) => {
      for (const match of rule.selector.matchAll(/\.(-?[_A-Za-z][\w-]*)/g)) {
        classes.add(match[1]);
      }
    });

    const orphans = [...classes].filter((name) => !haystack.includes(name));

    expect(
      orphans,
      `These classes are styled but appear nowhere in src/, so the rules do ` +
        `nothing:\n  ${orphans.join('\n  ')}\n\n` +
        `Either the markup was renamed, or the rule is left over from removed code.`
    ).toEqual([]);
  });
});
