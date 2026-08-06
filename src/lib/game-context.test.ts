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
  it('installed game shows play, verify, patch notes, news, info, uninstall', () => {
    const game = makeGame('installed');
    expect(ids(deriveMenuItems(game))).toEqual([
      'play',
      'verify',
      'patchNotes',
      'gameNews',
      'gameInfo',
      'uninstall',
    ]);
  });

  it('not installed game shows install, patch notes, news, info', () => {
    const game = makeGame('not_installed');
    expect(ids(deriveMenuItems(game))).toEqual(['install', 'patchNotes', 'gameNews', 'gameInfo']);
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
