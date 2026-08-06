import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '@/locales/en.json';
import fr from '@/locales/fr.json';

type LocaleMessages = Record<string, unknown>;

function flattenKeys(messages: LocaleMessages, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const fullKey = `${prefix}${key}`;
    if (value !== null && typeof value === 'object') {
      return flattenKeys(value as LocaleMessages, `${fullKey}.`);
    }
    return [fullKey];
  });
}

/**
 * Collects every `t('...')` call with a string-literal key from src/**.{ts,tsx}
 * sources. Only single/double-quoted literal keys are captured;
 * template literals (dynamic keys like t(`prefix.${id}`)) are not matchable
 * by this regex and are intentionally out of scope — none exist today.
 * Test files are excluded: i18n.test.ts deliberately resolves unknown keys.
 *
 * Known blind spots to address when they first occur:
 * (a) i18next plural forms (key_one/key_other) will need special handling
 *     once the first plural key arrives;
 * (b) the regex can false-positive on a local variable named `t` that is
 *     not the translation function.
 */
function collectReferencedKeys(rootDir: string): Map<string, string[]> {
  const referenced = new Map<string, string[]>();
  // t('key') or t("key"), optionally followed by interpolation options.
  const tCall = /\bt\(\s*(['"])((?:[^\\'"]|\\.)*)\1/g;

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
        !entry.name.endsWith('.test.ts') &&
        !entry.name.endsWith('.test.tsx')
      ) {
        const source = readFileSync(fullPath, 'utf-8');
        for (const match of source.matchAll(tCall)) {
          const key = match[2];
          const locations = referenced.get(key) ?? [];
          locations.push(fullPath);
          referenced.set(key, locations);
        }
      }
    }
  };

  walk(rootDir);
  return referenced;
}

describe('i18n key coverage', () => {
  const referencedKeys = collectReferencedKeys(join(process.cwd(), 'src'));
  const enKeys = new Set(flattenKeys(en as LocaleMessages));

  const getValue = (messages: LocaleMessages, key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node as LocaleMessages)[part], messages);

  const placeholders = (value: string): string[] =>
    [...value.matchAll(/\{\{(.+?)\}\}/g)].map((m) => m[1].trim()).sort();

  it('finds t() calls in the component sources', () => {
    // Sanity guard: if the scan breaks silently this fails instead of
    // vacuously passing the per-key assertions below.
    expect(referencedKeys.size).toBeGreaterThan(50);
    expect(referencedKeys.has('topBar.games')).toBe(true);
    expect(referencedKeys.has('settings.title')).toBe(true);
  });

  it('every t() key referenced in src exists in en.json', () => {
    const missing = [...referencedKeys.entries()]
      .filter(([key]) => !enKeys.has(key))
      .map(([key, locations]) => `${key} (used in ${locations.join(', ')})`);

    expect(missing).toEqual([]);
  });

  it('en.json has no unused keys (stale translations)', () => {
    // Keys kept intentionally despite no current t() reference (e.g. shared
    // keys reserved for an upcoming feature) must be whitelisted here.
    const allowedUnused: string[] = [];
    const unused = [...enKeys].filter(
      (key) => !referencedKeys.has(key) && !allowedUnused.includes(key)
    );

    expect(unused).toEqual([]);
  });

  it.each([['fr', fr as LocaleMessages]])(
    '%s.json has exactly the same key set as en.json',
    (_language, messages) => {
      const keys = flattenKeys(messages);

      expect(keys.length).toBe(enKeys.size);
      expect(keys.sort()).toEqual([...enKeys].sort());
    }
  );

  it('translations keep the same {{placeholders}} as the English source', () => {
    const mismatches: string[] = [];
    for (const key of enKeys) {
      const enValue = getValue(en as LocaleMessages, key);
      if (typeof enValue !== 'string') continue;
      const expected = placeholders(enValue);
      for (const [language, messages] of Object.entries({ fr })) {
        const actual = placeholders(String(getValue(messages as LocaleMessages, key)));
        if (actual.join() !== expected.join()) {
          mismatches.push(`${language}:${key} has [${actual}] expected [${expected}]`);
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('no locale value is left empty', () => {
    for (const [language, messages] of Object.entries({ en, fr })) {
      const flattened = flattenKeys(messages as LocaleMessages);
      for (const key of flattened) {
        const value = getValue(messages as LocaleMessages, key);
        expect(value, `${language}:${key} must not be empty`).not.toBe('');
      }
    }
  });
});
