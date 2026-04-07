import { useState, useEffect } from 'react';
import { TitleBar } from '@components/TitleBar';
import { GameSidebar } from '@components/GameSidebar';
import { GamePage } from '@components/GamePage';
import { Settings } from '@components/Settings';
import { AddGameModal } from '@components/AddGameModal';
import { News } from '@components/News';
import { useLauncherStore } from '@/lib/store';
import type { GameInfo } from '@/types';

// Mock available games for the "Add Game" modal
const MOCK_AVAILABLE_GAMES: GameInfo[] = [
  {
    id: 'quirheim-online',
    name: 'Quirheim Online',
    description: 'An epic MMORPG set in the mystical world of Quirheim.',
    developer: 'Pandawan Corp',
    genre: ['MMORPG', 'Fantasy'],
    iconUrl: '',
    bannerUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&h=675&fit=crop',
    screenshots: [],
    version: '1.0.0',
    sizeBytes: 15_000_000_000,
    releaseDate: '2024-12-01T00:00:00Z',
    manifestUrl: 'https://cdn.pandawancorp.com/games/quirheim-online/manifest.json',
  },
  {
    id: 'pixel-odyssey',
    name: 'Pixel Odyssey',
    description: 'A charming pixel art adventure game.',
    developer: 'Pandawan Corp',
    genre: ['Adventure', 'Indie'],
    iconUrl: '',
    bannerUrl: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200&h=675&fit=crop',
    screenshots: [],
    version: '1.2.0',
    sizeBytes: 500_000_000,
    releaseDate: '2024-10-15T00:00:00Z',
    manifestUrl: 'https://cdn.pandawancorp.com/games/pixel-odyssey/manifest.json',
  },
  {
    id: 'stellar-command',
    name: 'Stellar Command',
    description: 'Command your fleet in epic space battles.',
    developer: 'Pandawan Corp',
    genre: ['Strategy', 'Space'],
    iconUrl: '',
    bannerUrl: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1200&h=675&fit=crop',
    screenshots: [],
    version: '2.1.0',
    sizeBytes: 3_000_000_000,
    releaseDate: '2024-08-20T00:00:00Z',
    manifestUrl: 'https://cdn.pandawancorp.com/games/stellar-command/manifest.json',
  },
];

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddGameOpen, setIsAddGameOpen] = useState(false);
  const [showNews, setShowNews] = useState(false);
  
  const {
    games,
    activeDownloads,
    selectedGameId,
    selectGame,
    installGame,
    launchGame,
    uninstallGame,
    loadGames,
  } = useLauncherStore();

  // Initialize app on mount
  useEffect(() => {
    const init = async () => {
      // Add mock games if none exist
      const store = useLauncherStore.getState();
      if (store.games.length === 0) {
        MOCK_AVAILABLE_GAMES.forEach((gameInfo) => {
          store.addGame(gameInfo);
        });
      }
      await loadGames();
    };
    init();
  }, []);

  const selectedGame = games.find((g) => g.info.id === selectedGameId);

  const handleInstallGame = async (gameId: string) => {
    const game = games.find((g) => g.info.id === gameId);
    if (!game) return;
    
    const manifestUrl = game.info.manifestUrl;
    const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/'));
    
    await installGame(gameId, manifestUrl, baseUrl);
    setIsAddGameOpen(false);
  };

  const handleUpdateGame = async (gameId: string) => {
    await handleInstallGame(gameId);
  };

  const handleUninstallGame = async (gameId: string) => {
    if (confirm('Are you sure you want to uninstall this game?')) {
      await uninstallGame(gameId);
      selectGame(null);
    }
  };

  const handleVerifyGame = async (_gameId: string) => {
    alert('File verification coming soon!');
  };

  // Get games that aren't installed yet for the Add Game modal
  const uninstalledGames = MOCK_AVAILABLE_GAMES.filter(
    (mock) => !games.some((g) => g.info.id === mock.id && g.status !== 'not_installed')
  );

  return (
    <div className="h-screen flex flex-col bg-canvas text-ink overflow-hidden">
      {/* Title Bar */}
      <TitleBar
        onSettingsClick={() => setIsSettingsOpen(true)}
        isSettingsOpen={isSettingsOpen}
      />

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Game Sidebar */}
        <GameSidebar
          games={games}
          selectedGameId={selectedGameId}
          onSelectGame={(gameId) => {
            selectGame(gameId);
            setShowNews(false);
          }}
          onAddGame={() => setIsAddGameOpen(true)}
        />

        {/* Content Area */}
        <main className="flex-1 overflow-hidden">
          {showNews ? (
            <News onBack={() => setShowNews(false)} />
          ) : selectedGame ? (
            <GamePage
              game={selectedGame}
              downloadProgress={activeDownloads.get(selectedGame.info.id)}
              onPlay={() => launchGame(selectedGame.info.id)}
              onInstall={() => handleInstallGame(selectedGame.info.id)}
              onUpdate={() => handleUpdateGame(selectedGame.info.id)}
              onUninstall={() => handleUninstallGame(selectedGame.info.id)}
              onVerify={() => handleVerifyGame(selectedGame.info.id)}
            />
          ) : (
            <EmptyState onBrowseGames={() => setIsAddGameOpen(true)} />
          )}
        </main>
      </div>

      {/* Modals */}
      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      <AddGameModal
        isOpen={isAddGameOpen}
        onClose={() => setIsAddGameOpen(false)}
        onInstall={handleInstallGame}
        availableGames={uninstalledGames}
      />
    </div>
  );
}

function EmptyState({ onBrowseGames }: { onBrowseGames: () => void }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-8">
      <div className="w-24 h-24 rounded-3xl bg-surface flex items-center justify-center mb-6 shadow-premium">
        <svg
          className="w-12 h-12 text-ink-dim"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>
      <h2 className="text-2xl font-bold mb-2 gradient-text">No Game Selected</h2>
      <p className="text-ink-muted max-w-md mb-8">
        Select a game from the sidebar to view details, or install a new game to get started.
      </p>
      <button
        onClick={onBrowseGames}
        className="px-6 py-3 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-all btn-press btn-glow shadow-glow hover:shadow-glow-lg"
      >
        Install a Game
      </button>
    </div>
  );
}

export default App;
