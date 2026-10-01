import { describe, it, expect } from 'vitest';
import { CDN_ORIGIN, resolveBaseUrl } from './cdn';
import type { GameManifest } from '@/types';

/**
 * Build bytes live under a version-stamped directory, so a manifest cannot tell
 * the client where its files are by position alone — it has to say so. These
 * tests cover both directions of that contract, including the fallback that
 * keeps manifests published before the layout change working.
 */
describe('resolveBaseUrl', () => {
  it('uses the manifest base_url, adding a trailing slash', () => {
    expect(
      resolveBaseUrl({
        game_id: 'misspell',
        channel: 'alpha',
        base_url: 'https://cdn.example.com/games/misspell/alpha/0.4.0-alpha.1',
      } as GameManifest)
    ).toBe('https://cdn.example.com/games/misspell/alpha/0.4.0-alpha.1/');
  });

  it('keeps an already-slashed base_url unchanged', () => {
    expect(
      resolveBaseUrl({
        game_id: 'misspell',
        channel: 'alpha',
        base_url: 'https://cdn.example.com/games/misspell/alpha/0.4.0/',
      } as GameManifest)
    ).toBe('https://cdn.example.com/games/misspell/alpha/0.4.0/');
  });

  it('falls back to the flat channel dir for pre-layout manifests', () => {
    // Manifests published before version-stamping carry no base_url. They must
    // still resolve, or every already-published game breaks on upgrade.
    expect(resolveBaseUrl({ game_id: 'misspell', channel: 'alpha' } as GameManifest)).toBe(
      `${CDN_ORIGIN}/games/misspell/alpha/`
    );
  });

  it('defaults a missing channel to stable when falling back', () => {
    expect(resolveBaseUrl({ game_id: 'legacy' } as GameManifest)).toBe(
      `${CDN_ORIGIN}/games/legacy/stable/`
    );
  });
});
