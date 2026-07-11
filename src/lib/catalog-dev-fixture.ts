import type { GameCatalog, GameInfo, GameManifest } from '@/types';
import { resolveGameInfo } from './cdn';
import { logger } from './logger';

// Static fixture for offline dev testing. These imports are bundled into a
// separate chunk and only loaded in dev when the remote/local catalog fails.
import devCatalog from '../../examples/launcher/catalog.json';

const manifestModules = import.meta.glob<GameManifest>(
  '../../examples/games/*/stable/manifest.json',
  {
    eager: true,
    import: 'default',
  }
);

export async function loadDevFixtureCatalog(): Promise<{
  catalog: GameCatalog;
  games: GameInfo[];
} | null> {
  if (!import.meta.env.DEV) return null;

  try {
    const catalog = devCatalog as unknown as GameCatalog;
    if (!catalog || !Array.isArray(catalog.games)) {
      throw new Error('Invalid dev fixture catalog');
    }

    const manifests = new Map<string, GameManifest>();
    for (const manifest of Object.values(manifestModules)) {
      manifests.set(manifest.game_id, manifest);
    }

    const games: GameInfo[] = [];
    for (const entry of catalog.games) {
      const manifest = manifests.get(entry.id);
      if (!manifest) {
        logger.warn(`Dev fixture missing manifest for ${entry.id}`);
        continue;
      }
      games.push(resolveGameInfo(entry, manifest));
    }

    return { catalog, games };
  } catch (err) {
    logger.warn('Failed to load dev fixture catalog', { error: String(err) });
    return null;
  }
}
