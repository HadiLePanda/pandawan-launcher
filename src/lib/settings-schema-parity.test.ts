import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LauncherSettings } from '@/types';

const repoRoot = join(__dirname, '..', '..');
const rustTypesPath = join(repoRoot, 'src-tauri', 'src', 'types.rs');

/**
 * Field names of a Rust struct in src-tauri/src/types.rs.
 *
 * types.rs is the source of truth for the settings schema, but the frontend
 * LauncherSettings in src/types/index.ts is maintained separately and nothing
 * enforced that the two agreed. That is how notify_friend_activity and
 * notify_news_events ended up in Rust, absent from TypeScript, and read by
 * nothing. A focused regex scrape is enough here: it only has to handle
 * `pub <name>: <type>,` lines inside one struct body.
 */
function rustStructFields(structName: string): string[] {
  const source = readFileSync(rustTypesPath, 'utf-8');
  const start = source.indexOf(`pub struct ${structName} {`);
  expect(start, `${structName} not found in types.rs`).toBeGreaterThan(-1);

  const body = source.slice(start);
  const end = body.indexOf('\n}');
  expect(end, `unterminated ${structName} body`).toBeGreaterThan(-1);

  return [...body.slice(0, end).matchAll(/^\s*pub\s+([a-z0-9_]+)\s*:/gm)].map((m) => m[1]);
}

/** LauncherSettings uses #[serde(rename_all = "camelCase")]. */
function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Field names of a TS interface in src/types/index.ts. */
function tsInterfaceFields(interfaceName: string): string[] {
  const source = readFileSync(join(repoRoot, 'src', 'types', 'index.ts'), 'utf-8');
  const start = source.indexOf(`export interface ${interfaceName} {`);
  expect(start, `${interfaceName} not found in src/types/index.ts`).toBeGreaterThan(-1);

  const body = source.slice(start);
  const end = body.indexOf('\n}');
  expect(end, `unterminated ${interfaceName} body`).toBeGreaterThan(-1);

  return [...body.slice(0, end).matchAll(/^\s{2}([A-Za-z0-9_]+)\??\s*:/gm)].map((m) => m[1]);
}

describe('Rust/TypeScript settings schema parity', () => {
  const rustFields = rustStructFields('LauncherSettings').map(toCamelCase);
  const tsFields = tsInterfaceFields('LauncherSettings');

  it('parses a non-trivial schema from both sides', () => {
    // Guards against a silently empty parse making the checks vacuous.
    expect(rustFields.length).toBeGreaterThan(5);
    expect(tsFields.length).toBeGreaterThan(5);
    expect(rustFields).toContain('notifyGameUpdates');
  });

  it('every Rust settings field exists in the TypeScript type', () => {
    const missing = rustFields.filter((f) => !tsFields.includes(f));
    expect(missing, `Rust fields absent from src/types/index.ts: ${missing.join(', ')}`).toEqual(
      []
    );
  });

  it('every TypeScript settings field exists in the Rust struct', () => {
    const missing = tsFields.filter((f) => !rustFields.includes(f));
    expect(
      missing,
      `TypeScript fields absent from src-tauri/src/types.rs: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('the frontend default settings cover every field in the type', () => {
    // `LauncherSettings` is type-only, so this object stands in for the
    // interface at runtime; Record<keyof ...> makes a missing key a type error.
    expect(Object.keys(DEFAULT_SETTINGS_SHAPE).sort()).toEqual([...tsFields].sort());
  });
});

// GameManifest and GameInstallation cross the IPC boundary, so parity is
// checked for them too. They stay snake_case on the wire (no rename_all), so
// names are compared verbatim.
describe('Rust/TypeScript channel schema parity', () => {
  const cases = [
    { name: 'GameManifest', ts: 'GameManifest' },
    { name: 'GameInstallation', ts: 'GameInstallation' },
  ];

  for (const { name, ts } of cases) {
    it(`${name} carries a channel field on both sides`, () => {
      expect(rustStructFields(name)).toContain('channel');
      expect(tsInterfaceFields(ts)).toContain('channel');
    });

    it(`${name} field names match the TypeScript type`, () => {
      const rust = rustStructFields(name);
      const tsFields = tsInterfaceFields(ts);
      const missing = rust.filter((f) => !tsFields.includes(f));
      expect(missing, `${name} Rust fields absent from TypeScript: ${missing.join(', ')}`).toEqual(
        []
      );
    });
  }
});

/** Mirrors DEFAULT_SETTINGS in src/components/Settings.tsx. */
const DEFAULT_SETTINGS_SHAPE: Record<keyof LauncherSettings, unknown> = {
  gamesInstallPath: null,
  maxDownloadSpeed: null,
  maxConcurrentDownloads: 4,
  autoUpdateGames: true,
  autoUpdateLauncher: true,
  minimizeToTray: true,
  closeToTray: false,
  trayHintShown: false,
  language: 'en',
  theme: 'adaptive',
  notifyGameUpdates: true,
  notifyDownloadComplete: true,
};
