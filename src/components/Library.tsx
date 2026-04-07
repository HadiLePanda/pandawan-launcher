import { useEffect } from 'react';
import { useLauncherStore } from '@/lib/store';
import { GameCard } from './GameCard';
import { Library as LibraryIcon, Plus } from 'lucide-react';

interface LibraryProps {
  onSelectGame: (gameId: string) => void;
}

// Mock data for Quirheim Online
const MOCK_GAMES = [
  {
    info: {
      id: 'quirheim-online',
      name: 'Quirheim Online',
      description: 'An epic MMORPG set in the mystical world of Quirheim. Embark on legendary quests, forge alliances, and battle fearsome creatures in a vast open world.',
      developer: 'Pandawan Corp',
      genre: ['MMORPG', 'Fantasy', 'Multiplayer'],
      iconUrl: '',
      bannerUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&h=675&fit=crop',
      screenshots: [
        'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=600&h=338&fit=crop',
        'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=600&h=338&fit=crop',
        'https://images.unsplash.com/photo-1552820728-8b83bb6b2b0a?w=600&h=338&fit=crop',
      ],
      version: '1.0.0',
      sizeBytes: 15_000_000_000, // 15GB
      releaseDate: '2024-12-01T00:00:00Z',
      manifestUrl: 'https://cdn.pandawancorp.com/games/quirheim-online/manifest.json',
    },
    installation: null,
    status: 'not_installed' as const,
    hasUpdate: false,
  },
  {
    info: {
      id: 'pixel-odyssey',
      name: 'Pixel Odyssey',
      description: 'A charming pixel art adventure game. Explore colorful worlds, solve puzzles, and uncover ancient secrets.',
      developer: 'Pandawan Corp',
      genre: ['Adventure', 'Indie', 'Pixel Art'],
      iconUrl: '',
      bannerUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200&h=675&fit=crop',
      screenshots: [],
      version: '1.2.0',
      sizeBytes: 500_000_000, // 500MB
      releaseDate: '2024-10-15T00:00:00Z',
      manifestUrl: 'https://cdn.pandawancorp.com/games/pixel-odyssey/manifest.json',
    },
    installation: null,
    status: 'not_installed' as const,
    hasUpdate: false,
  },
  {
    info: {
      id: 'stellar-command',
      name: 'Stellar Command',
      description: 'Command your fleet in epic space battles. Strategy, diplomacy, and combat in the far reaches of the galaxy.',
      developer: 'Pandawan Corp',
      genre: ['Strategy', 'Space', 'RTS'],
      iconUrl: '',
      bannerUrl: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1200&h=675&fit=crop',
      screenshots: [],
      version: '2.1.0',
      sizeBytes: 3_000_000_000, // 3GB
      releaseDate: '2024-08-20T00:00:00Z',
      manifestUrl: 'https://cdn.pandawancorp.com/games/stellar-command/manifest.json',
    },
    installation: null,
    status: 'not_installed' as const,
    hasUpdate: false,
  },
];

export function Library({ onSelectGame }: LibraryProps) {
  const { games, activeDownloads, isLoading, loadGames, installGame, launchGame, uninstallGame } = useLauncherStore();

  useEffect(() => {
    // Load mock games if none exist
    const store = useLauncherStore.getState();
    if (store.games.length === 0) {
      MOCK_GAMES.forEach((game) => {
        store.addGame(game.info);
      });
    }
    
    loadGames();
  }, []);

  const handleInstall = async (gameId: string) => {
    const game = games.find((g) => g.info.id === gameId);
    if (!game) return;
    
    // Extract base URL from manifest URL
    const manifestUrl = game.info.manifestUrl;
    const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/'));
    
    await installGame(gameId, manifestUrl, baseUrl);
  };

  const handleUpdate = async (gameId: string) => {
    // Update is same as install for patching
    await handleInstall(gameId);
  };

  const installedGames = games.filter((g) => g.status !== 'not_installed');
  const availableGames = games.filter((g) => g.status === 'not_installed');

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-3 text-ink-muted">
          <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          Loading games...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Your Library</h1>
            <p className="text-ink-muted">
              {installedGames.length} game{installedGames.length !== 1 ? 's' : ''} installed
            </p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface hover:bg-surface-light text-ink transition-colors text-sm font-medium">
            <Plus className="w-4 h-4" />
            Add Game
          </button>
        </div>

        {/* Installed Games */}
        {installedGames.length > 0 && (
          <section className="mb-12">
            <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wider mb-4">
              Installed
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {installedGames.map((game) => (
                <GameCard
                  key={game.info.id}
                  game={game}
                  downloadProgress={activeDownloads.get(game.info.id)}
                  onClick={() => onSelectGame(game.info.id)}
                  onPlay={() => launchGame(game.info.id)}
                  onUpdate={() => handleUpdate(game.info.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Available Games */}
        {availableGames.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wider mb-4">
              Available
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {availableGames.map((game) => (
                <GameCard
                  key={game.info.id}
                  game={game}
                  downloadProgress={activeDownloads.get(game.info.id)}
                  onClick={() => onSelectGame(game.info.id)}
                  onInstall={() => handleInstall(game.info.id)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {games.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-20 h-20 rounded-2xl bg-surface flex items-center justify-center mb-6">
              <LibraryIcon className="w-10 h-10 text-ink-dim" />
            </div>
            <h3 className="text-xl font-semibold mb-2">No games found</h3>
            <p className="text-ink-muted max-w-md">
              Your library is empty. Browse the store to find games to install, or add a game manually.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
