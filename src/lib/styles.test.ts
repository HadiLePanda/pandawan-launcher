import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import postcss from 'postcss';

/**
 * The launcher stylesheet is hand-written and compiled by Tailwind, so nothing
 * checked it. Two mistakes it has actually shipped, both silent:
 *
 * - An unclosed brace does NOT break the parse. It makes every following rule a
 *   descendant of the unclosed selector, so the rules stop matching and the page
 *   renders unstyled while looking like a content problem.
 * - A rule whose class the markup no longer uses does nothing at all, forever.
 *   This file had 74 of those, including a whole downloads popup.
 *
 * A mention in a doc or a comment does not count as usage - that is exactly how
 * the dead rules stayed alive. Only markup counts.
 *
 * Keep these assertions blunt. Softening one into a warning stops it catching the
 * bug it exists for.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, '..');
const stylesDir = path.join(srcDir, 'styles');

/** index.css plus every chunk under src/styles/. */
function stylesheetFiles(): string[] {
  const chunkDir = path.join(stylesDir);
  const chunks = statSync(chunkDir).isDirectory()
    ? readdirSync(chunkDir)
        .filter((f) => f.endsWith('.css'))
        .map((f) => path.join(chunkDir, f))
    : [];
  return [path.join(srcDir, 'index.css'), ...chunks];
}

function parseStylesheet(): postcss.Root {
  const parts = stylesheetFiles().map((f) => readFileSync(f, 'utf8'));
  try {
    return postcss.parse(parts.join('\n'), { from: path.join(srcDir, 'index.css') });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The stylesheet does not parse, so every rule in it is inert or half-applied.\n` +
        `  ${reason}\n` +
        '  Usually an unbalanced brace. Count { and } - they must match.',
      { cause: error }
    );
  }
}

/** Every file that can actually apply a class: markup, never docs or config. */
function markupFiles(): string[] {
  const files = [path.join(srcDir, '..', 'index.html')];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?|html)$/.test(entry)) files.push(full);
    }
  };
  walk(srcDir);
  const publicDir = path.join(srcDir, '..', 'public');
  if (statSync(publicDir).isDirectory()) {
    for (const entry of readdirSync(publicDir)) {
      if (/\.html?$/.test(entry)) files.push(path.join(publicDir, entry));
    }
  }
  return files;
}

describe('launcher stylesheet', () => {
  it('parses', () => {
    let rules = 0;
    parseStylesheet().walkRules(() => {
      rules++;
    });
    expect(rules).toBeGreaterThan(0);
  });

  it('never nests one rule inside another', () => {
    const offenders: string[] = [];
    parseStylesheet().walkRules((rule) => {
      // Rules inside @layer/@media are fine, and so are @keyframes steps. A rule
      // whose ancestor is another *rule* is either deliberate nesting (which says
      // so with `&`) or a swallowed rule.
      let parent: postcss.Node | undefined = rule.parent;
      while (parent) {
        if (parent.type === 'rule') {
          const enclosing = (parent as postcss.Rule).selector;
          if (!rule.selector.includes('&')) {
            offenders.push(
              `line ${rule.source?.start?.line}: "${rule.selector}" is inside "${enclosing}"`
            );
          }
          break;
        }
        parent = parent.parent;
      }
    });

    expect(
      offenders,
      `These rules are nested inside another rule, so they only apply to elements ` +
        `matching their parent too - in practice, never:\n  ${offenders.join('\n  ')}\n\n` +
        `Usually an unclosed brace above them. Fixing the brace is the whole fix.`
    ).toEqual([]);
  });

  it('has no class that no markup uses', () => {
    const haystack = markupFiles()
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');

    const classes = new Set<string>();
    parseStylesheet().walkRules((rule) => {
      // Skip :not(...) - a class that never matches inside :not() makes a selector
      // match MORE, so it is not evidence of a dead rule.
      const selector = rule.selector.replace(/:not\([^)]*\)/g, '');
      for (const match of selector.matchAll(/\.(-?[_A-Za-z][\w-]*)/g)) classes.add(match[1]!);
    });

    const orphans = [...classes].filter((name) => !haystack.includes(name));

    expect(
      orphans,
      `These classes are styled but appear in no markup file, so the rules do ` +
        `nothing:\n  ${orphans.join('\n  ')}\n\n` +
        `A mention in a doc or a comment is not usage. Either the markup was ` +
        `renamed, or the rule is left over from removed code - delete it.`
    ).toEqual([]);
  });

  it('imports every chunk under src/styles/', () => {
    // An unimported chunk is dead CSS that the class check above cannot see,
    // because it parses the files directly rather than through index.css.
    const index = readFileSync(path.join(srcDir, 'index.css'), 'utf8');
    const imported = new Set(
      [...index.matchAll(/@import\s+'\.\/styles\/([^']+)'/g)].map((m) => m[1])
    );
    const present = readdirSync(stylesDir).filter((f) => f.endsWith('.css'));
    const orphans = present.filter((f) => !imported.has(f));

    expect(
      orphans,
      `These files exist under src/styles/ but index.css never imports them, so ` +
        `none of their rules are ever applied:\n  ${orphans.join('\n  ')}`
    ).toEqual([]);
  });
});
