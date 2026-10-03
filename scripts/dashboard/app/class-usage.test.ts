import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import postcss from 'postcss';

/**
 * The reverse of styles.test.ts, which only catches CSS nothing uses.
 *
 * A hand-written class the markup uses but the stylesheet does not define renders
 * unstyled and nothing reports it - the same silent failure AGENTS.md describes
 * from the launcher's old hand-written sheet, where a missing brace left whole
 * panels unstyled and nobody noticed. Only the `dw-` family is checked: Tailwind
 * utilities are generated from theme tokens and never appear in this file.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, 'src');

function stylesheet(): string {
  return readFileSync(path.join(srcDir, 'styles.css'), 'utf8');
}

/** Every file that can apply a class. Docs and config cannot. */
function markupFiles(): string[] {
  const files = [path.join(here, 'index.html')];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?|html)$/.test(entry)) files.push(full);
    }
  };
  walk(srcDir);
  return files;
}

describe('dashboard hand-written classes', () => {
  it('defines every dw- class the markup uses', () => {
    const used = new Set<string>();
    for (const file of markupFiles()) {
      for (const match of readFileSync(file, 'utf8').matchAll(/(^|[^a-z0-9-])(dw-[a-z0-9-]+)/g)) {
        used.add(match[2]);
      }
    }

    const declared = new Set<string>();
    postcss.parse(stylesheet()).walkRules((rule) => {
      for (const match of rule.selector.matchAll(/\.(dw-[a-z0-9-]+)/g)) declared.add(match[1]);
    });

    const unstyled = [...used].filter((name) => !declared.has(name)).sort();

    expect(
      unstyled,
      `These dw- classes are used in markup but have no rule, so they render ` +
        `unstyled and nothing else would report it:\n  ${unstyled.join('\n  ')}\n\n` +
        `Tailwind utilities do not belong here - only the hand-written dw- family.`
    ).toEqual([]);
  });
});
