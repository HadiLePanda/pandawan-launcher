import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { commands, events } from './bindings';

/**
 * bindings.ts cannot be regenerated in this environment.
 *
 * The export test needs the Tauri runtime, so the checked-in file is maintained
 * by hand. That makes it the one place in the frontend where a mismatch is
 * invisible until a call fails at runtime, so it is checked here instead - by
 * reading the Rust source of truth and comparing, rather than trusting that
 * someone remembered to add a wrapper.
 */

const libRs = readFileSync(resolve(__dirname, '../../src-tauri/src/lib.rs'), 'utf-8');
const bindingsTs = readFileSync(resolve(__dirname, 'bindings.ts'), 'utf-8');

/** Command names inside lib.rs's collect_commands! list. */
function rustCommands(): string[] {
  const block = libRs.match(/collect_commands!\[([\s\S]*?)\]/);
  expect(block, 'collect_commands! not found in lib.rs').not.toBeNull();
  // The regex has one capture group, so index 1 is always the body.
  return (block as RegExpMatchArray)[1]!
    .split(',')
    .map((part) => part.trim())
    .filter((name) => /^[a-z_]+$/.test(name))
    .sort();
}

/** Command names the frontend actually invokes. */
function invokedCommands(): string[] {
  return [...bindingsTs.matchAll(/__TAURI_INVOKE\('([a-z_]+)'/g)].map((m) => m[1]!).sort();
}

describe('bindings.ts matches the Rust command list', () => {
  it('wraps every command lib.rs registers', () => {
    // The failure this catches: a #[tauri::command] added to lib.rs with no
    // wrapper added here. Nothing else would notice - the frontend compiles, the
    // rest of the suite passes, and the call fails only when a player reaches
    // that screen.
    const missing = rustCommands().filter((name) => !invokedCommands().includes(name));
    expect(missing, `registered in lib.rs but never invoked: ${missing}`).toEqual([]);
  });

  it('invokes nothing lib.rs does not register', () => {
    // The reverse: a wrapper left behind after a command was renamed or deleted.
    // Calling it fails with a Tauri error naming a command that does not exist,
    // which reads as a bug in the caller rather than a stale generated file.
    const extra = invokedCommands().filter((name) => !rustCommands().includes(name));
    expect(extra, `invoked but not registered in lib.rs: ${extra}`).toEqual([]);
  });

  it('exports one wrapper per invoked command', () => {
    // Catches a name that appears in an __TAURI_INVOKE call but is not attached
    // to the exported `commands` object, which the two checks above cannot see:
    // it would be dead text in the file.
    //
    // The exported keys are camelCase and the invoked names snake_case, so they
    // are compared as counts plus the count of distinct invoke targets. Counting
    // rather than converting keeps this honest about the naming difference
    // instead of encoding a conversion rule that the generator would own.
    const invoked = invokedCommands();
    expect(Object.keys(commands).length).toBe(invoked.length);
  });

  it('declares the game-exited event the frontend listens for', () => {
    // game-exited is what carries playtime back to the backend when a game quits.
    // It is emitted rather than invoked, so the checks above do not cover it.
    expect(Object.keys(events)).toContain('gameExited');
  });

  it('types gameExited with the duration the backend records', () => {
    // duration_seconds is what record_playtime adds to total_playtime_seconds. It
    // was hand-added to this file after the export test could not run, which makes
    // it exactly the kind of edit that gets lost on the next regeneration.
    expect(libRs).toContain('duration_seconds');
    expect(bindingsTs).toContain('duration_seconds');
  });
});
