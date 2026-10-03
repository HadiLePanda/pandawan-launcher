import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Every colour utility a component uses must survive the build.
 *
 * The failure this guards against is silent and total. Tailwind v4 emits a
 * utility only when the CSS variable behind it exists, so a component written
 * against a token name the palette does not define gets NO RULE AT ALL - not a
 * wrong colour, no output. The panels shipped that way: `text-ink-dim`,
 * `bg-surface-light`, `text-status-error`, `text-ember`, `bg-action` and
 * `bg-action-hover` were used across nine files and defined nowhere, so those
 * elements rendered with no colour, no background and no border.
 *
 * It read as a taste problem ("white outline and black, hardly readable") rather
 * than a bug, which is why it survived review: nothing errors, nothing warns, the
 * build succeeds, and the page simply looks wrong.
 *
 * WHY THIS ALSO CHECKS THE SOURCE PALETTE, NOT ONLY THE BUILT CSS
 *
 * The built stylesheet is the thing the browser receives, so it is the strongest
 * single piece of evidence. But it is a build artifact, and it can be STALE: a
 * token deleted from styles.css lingers in a dist/ built before the edit, so a
 * built-CSS-only check keeps passing against a stylesheet nobody runs. The
 * source-palette check needs no build and cannot pass against a stale one.
 *
 * The built-CSS check still runs, and SKIPS - loudly, never silently - when the
 * build predates the sources. A stale build warrants a warning, not a failure:
 * this can run under parallel agents that cannot rebuild without clobbering each
 * other's dist/, so failing here would only train people to delete the test.
 */

const APP_DIR = path.resolve(__dirname);
const SRC = path.join(APP_DIR, 'src');

/** The built stylesheet and its mtime, or null when the app has not been built. */
function builtCss(): { css: string; mtimeMs: number } | null {
  const assets = path.join(APP_DIR, 'dist', 'assets');
  if (!existsSync(assets)) return null;
  const files = readdirSync(assets).filter((f) => f.endsWith('.css'));
  if (!files.length) return null;
  const newest = files
    .map((f) => path.join(assets, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
  return { css: readFileSync(newest, 'utf-8'), mtimeMs: statSync(newest).mtimeMs };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** The newest mtime under a directory, over every file, not just sources. */
function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    newest = Math.max(newest, stat.isDirectory() ? newestMtime(full) : stat.mtimeMs);
  }
  return newest;
}

/**
 * A class as written, with its variant prefixes removed: `md:hover:bg-x` -> `bg-x`.
 *
 * Without this the extractor below misses every variant-prefixed utility: the
 * `(?:^|[\s'"`])` anchor demands a space or quote before the name, and the `:`
 * of `hover:` is neither, so `hover:bg-missing` matched nothing and a missing
 * token behind hover:/focus:/md: could never be caught. Everything up to and
 * including the last top-level `:` goes; a `:` inside `[...]` (an arbitrary
 * value, e.g. `bg-[url(http://x)]`) is left alone.
 */
function baseUtility(cls: string): string {
  let depth = 0;
  let lastColon = -1;
  for (let i = 0; i < cls.length; i++) {
    const ch = cls[i];
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ':' && depth === 0) lastColon = i;
  }
  return cls.slice(lastColon + 1);
}

/** Prefixes that legitimately take a colour token. */
const COLOUR_PREFIXES = [
  'bg',
  'text',
  'border',
  'ring',
  'fill',
  'stroke',
  'from',
  'via',
  'to',
  'divide',
  'outline',
  'decoration',
  'shadow',
  'accent',
  'caret',
];

/**
 * Suffixes that are a size, side or style rather than a colour.
 *
 * A deny-list rather than a palette lookup on purpose: the palette is the thing
 * under test, so consulting it here would make the test agree with whatever the
 * palette happens to contain.
 */
const NOT_A_COLOUR = new Set([
  '0',
  '1',
  '2',
  '4',
  '8',
  'x',
  'y',
  't',
  'r',
  'b',
  'l',
  's',
  'e',
  'px',
  'solid',
  'dashed',
  'dotted',
  'double',
  'none',
  'hidden',
  'collapse',
  'separate',
  'left',
  'right',
  'top',
  'bottom',
  'start',
  'end',
  'inset',
  'center',
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  'full',
  'auto',
  'current',
  'inherit',
  'transparent',
  'currentcolor',
  'reverse',
]);

/** Side segments that can precede a colour: `border-l-accent`, `border-t-warn`. */
const COLOUR_SIDE_PREFIXES = new Set(['x', 'y', 't', 'r', 'b', 'l', 's', 'e']);

/**
 * Colour tokens the source references inside class strings, and where.
 *
 * Only class strings are scanned, since that is where a missing token bites. The
 * token must look like a palette name - one or two lowercase words - because
 * that is the shape the invented names had (`ink-dim`, `surface-light`, `ember`).
 */
function referencedColourTokens(files: string[]): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();

  for (const file of files) {
    const source = readFileSync(file, 'utf-8');
    const rel = path.relative(APP_DIR, file).replace(/\\/g, '/');

    const classStrings: string[] = [];
    // className="..." and className={`...`}
    for (const m of source.matchAll(/class(?:Name)?\s*=\s*(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      classStrings.push(m[1] ?? m[2] ?? '');
    }
    // Bare cx('...', cond && 'bg-x') argument lists carry no attribute.
    for (const m of source.matchAll(/\bcx\(([\s\S]*?)\)\s*;?/g)) {
      classStrings.push(m[1] ?? '');
    }

    for (const raw of classStrings) {
      // Variants are stripped per whitespace-separated class, so a variant cannot
      // hide the utility behind it.
      const text = raw.split(/\s+/).map(baseUtility).join(' ');

      for (const m of text.matchAll(/(?:^|[\s'"`])([a-z][a-z0-9]*-[a-zA-Z0-9_/-]+)/g)) {
        const name = m[1]!;
        const dash = name.indexOf('-');
        if (dash === -1) continue;
        if (!COLOUR_PREFIXES.includes(name.slice(0, dash))) continue;
        if (name.includes(':')) continue;

        const token = name.slice(dash + 1);
        // `bg-x/10` and `border-warn/50` carry an opacity modifier; the token is
        // the part before the slash. `bg-warn/` (trailing, no number) is the same
        // class with the modifier omitted, so it is dropped too.
        const bare = token.split('/')[0] ?? token;
        if (!bare) continue;

        // `border-l-accent` is a colour on the left edge, so a side prefix is
        // part of the utility rather than the token. Strip it - `border-l` alone
        // then leaves nothing and is correctly skipped as a plain border width.
        const withoutSide = COLOUR_SIDE_PREFIXES.has(bare)
          ? ''
          : COLOUR_SIDE_PREFIXES.has(bare.split('-')[0] ?? '')
            ? bare.split('-').slice(1).join('-')
            : bare;
        if (!withoutSide) continue;

        if (NOT_A_COLOUR.has(withoutSide.toLowerCase())) continue;
        if (/[A-Z0-9]/.test(withoutSide.split('-')[0]!)) continue;

        const owners = found.get(withoutSide) ?? new Set<string>();
        owners.add(rel);
        found.set(withoutSide, owners);
      }
    }
  }
  return found;
}

/**
 * Colour tokens the @theme block declares in styles.css - the source of truth
 * for whether a utility emits any CSS at all.
 */
function declaredColourTokens(): Set<string> {
  const source = readFileSync(path.join(SRC, 'styles.css'), 'utf-8');
  return new Set(Array.from(source.matchAll(/--color-([a-zA-Z0-9_-]+)\s*:/g), (m) => m[1]!));
}

/**
 * Black and white ship in Tailwind v4's default theme, so they need no @theme
 * entry and are not this palette's to own. Every other built-in palette name
 * (red-500, slate-900, ...) is treated as missing on purpose: this app has one
 * palette, and a stray default colour is exactly the drift worth catching.
 */
const BUILTIN_COLOURS = new Set(['black', 'white']);

describe('dashboard colour tokens reach the stylesheet', () => {
  const build = builtCss();
  const stale = build !== null && newestMtime(SRC) > build.mtimeMs;

  if (stale) {
    // Loud, because a silent skip is the failure mode this test exists for.
    console.warn(
      '\n[color-tokens] SKIPPED the built-CSS assertion: dist/assets/*.css is older ' +
        'than a file in src, so it cannot vouch for the current source. ' +
        'Run `npm run dashboard:build` to revalidate it.\n'
    );
  }

  it('every referenced colour token is declared in the palette', () => {
    const referenced = referencedColourTokens(walk(SRC));
    expect(
      referenced.size,
      'no colour utilities found - the scan itself is broken'
    ).toBeGreaterThan(5);

    const declared = declaredColourTokens();
    const missing: string[] = [];
    for (const [token, owners] of referenced) {
      if (declared.has(token) || BUILTIN_COLOURS.has(token)) continue;
      missing.push(`  ${token.padEnd(18)} ${[...owners].join(', ')}`);
    }

    expect(
      missing.sort().join('\n'),
      'These colour utilities name tokens that styles.css does NOT declare, so ' +
        'Tailwind v4 emits NO CSS for them - not a wrong colour, no rule - and the ' +
        'elements render completely unstyled with nothing to warn you. Add each to ' +
        'the @theme block in src/styles.css - an alias of an existing token is fine:\n' +
        missing.sort().join('\n')
    ).toBe('');
  });

  it.skipIf(!build || stale)('every referenced colour token produced CSS', () => {
    const css = build!.css;
    const referenced = referencedColourTokens(walk(SRC));
    expect(
      referenced.size,
      'no colour utilities found - the scan itself is broken'
    ).toBeGreaterThan(5);

    const missing: string[] = [];
    for (const [token, owners] of referenced) {
      const escaped = token.replace(/[-/\\.]/g, '\\$&');
      // Alive if it produced any rule, or if the token itself is declared - the
      // latter matters for a token used only via a variant Tailwind resolved
      // differently than written.
      const alive =
        new RegExp(`\\.${escaped}(?![A-Za-z0-9_-])`).test(css!) ||
        new RegExp(`--color-${escaped}\\s*:`).test(css!);
      if (!alive) missing.push(`  ${token.padEnd(18)} ${[...owners].join(', ')}`);
    }

    expect(
      missing.sort().join('\n'),
      'These colour utilities reference tokens that produced NO CSS in the build, so ' +
        'the elements render completely unstyled and nothing warns. Add each to the ' +
        '@theme block in src/styles.css - an alias of an existing token is fine:\n' +
        missing.sort().join('\n')
    ).toBe('');
  });

  it('declares a palette with real colour tokens', () => {
    // Guards the guard: without this, an emptied styles.css would make the check
    // above pass vacuously.
    const source = readFileSync(path.join(SRC, 'styles.css'), 'utf-8');
    const tokens = Array.from(source.matchAll(/--color-([a-zA-Z0-9_-]+)\s*:/g), (m) => m[1]!);
    expect(tokens.length).toBeGreaterThan(15);
  });
});
