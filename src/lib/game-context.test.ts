import { describe, it, expect } from 'vitest';
import { deriveMenuItems, type GameContextMenuItem } from './game-context';
import type { Game } from '@/types';

function makeGame(status: Game['status'], hasUpdate = false): Game {
  return {
    info: {
      id: 'test',
      name: 'Test Game',
      description: '',
      developer: '',
      genre: ['RPG'],
      version: '1.0',
      channel: 'stable',
      sizeBytes: 0,
      supportedPlatforms: ['windows'],
    },
    status,
    hasUpdate,
  } as Game;
}

function ids(items: GameContextMenuItem[]) {
  return items.map((i) => i.id);
}

describe('deriveMenuItems', () => {
  // Play and install are the primary button one click away, and game news is
  // already in the game's sidebar. Repeating any of them in the menu presented
  // the same action as two different choices.
  it('installed game shows verify, patch notes, info, uninstall', () => {
    const game = makeGame('installed');
    expect(ids(deriveMenuItems(game))).toEqual(['verify', 'patchNotes', 'gameInfo', 'uninstall']);
  });

  it('not installed game shows patch notes and info only', () => {
    const game = makeGame('not_installed');
    expect(ids(deriveMenuItems(game))).toEqual(['patchNotes', 'gameInfo']);
  });

  it('never offers play, install or game news', () => {
    for (const status of ['installed', 'not_installed', 'downloading', 'updating'] as const) {
      const shown = ids(deriveMenuItems(makeGame(status)));
      expect(shown).not.toContain('play');
      expect(shown).not.toContain('install');
      expect(shown).not.toContain('gameNews');
    }
  });

  it('downloading game only shows game info', () => {
    const game = makeGame('downloading');
    expect(ids(deriveMenuItems(game))).toEqual(['gameInfo']);
  });

  it('marks uninstall as danger', () => {
    const game = makeGame('installed');
    const uninstall = deriveMenuItems(game).find((i) => i.id === 'uninstall');
    expect(uninstall?.danger).toBe(true);
  });
});
