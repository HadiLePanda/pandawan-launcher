import { useState, useEffect } from 'react';
import { TitleBar } from '@components/TitleBar';
import { AppTopBar } from '@components/AppTopBar';
import { GamePage } from '@components/GamePage';
import { GamesPage } from '@components/GamesPage';
import { GamesHome } from '@components/GamesHome';
import { Settings } from '@components/Settings';
import { AddGameModal } from '@components/AddGameModal';
import { News } from '@components/News';
import { useLauncherStore } from '@/lib/store';
import { windowTitlebarToggleMaximize } from '@/lib/window';
import type { GameInfo } from '@/types';

// Mock available games for the "Add Game" modal
const MOCK_AVAILABLE_GAMES: GameInfo[] = [
  {
    id: 'quirheim-online',
    name: 'Quirheim Online',
    description: 'The medieval MMORPG governed by the four elements and ancient dragons — master your class, breathe with the world, and conquer dungeons.',
    developer: 'Pandawan Corp',
    genre: ['MMORPG', 'Fantasy', 'Co-op'],
    iconUrl: '',
    bannerUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200&h=675&fit=crop',
    screenshots: [],
    version: '1.0.0',
    sizeBytes: 15_000_000_000,
    releaseDate: '2024-12-01T00:00:00Z',
    manifestUrl: 'https://cdn.pandawancorp.com/games/quirheim-online/manifest.json',
    colorTheme: {
      accent: '#c8a84b',
      accentHover: '#d4b55e',
      accentMuted: 'rgba(200, 168, 75, 0.12)',
    },
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
    colorTheme: {
      accent: '#4a7a52',
      accentHover: '#5a8f62',
      accentMuted: 'rgba(74, 122, 82, 0.14)',
    },
  },
];

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddGameOpen, setIsAddGameOpen] = useState(false);
  const [activeView, setActiveView] = useState<'games' | 'news' | 'store'>('games');
  // null means the ALL / home overview is shown.
  // `lastSelectedGameId` preserves the last game selected so clicking "Games" returns to it.
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [lastSelectedGameId, setLastSelectedGameId] = useState<string | null>(null);

  const {
    games,
    activeDownloads,
    installGame,
    launchGame,
    uninstallGame,
    loadGames,
    loadSettings,
    settings,
  } = useLauncherStore();

  // Initialize app on mount
  useEffect(() => {
    const init = async () => {
      const store = useLauncherStore.getState();
      if (store.games.length === 0) {
        MOCK_AVAILABLE_GAMES.forEach((gameInfo) => {
          store.addGame(gameInfo);
        });
      }
      await loadGames();
      await loadSettings();

      // Default to the ALL overview on boot (selectedGameId stays null)
      const loadedGames = useLauncherStore.getState().games;
      if (loadedGames.length === 0 && !selectedGameId) {
        setSelectedGameId(null);
      }
    };
    init();
  }, []);

  // Apply theme class when setting changes
  useEffect(() => {
    if (!settings) return;
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else if (settings.theme === 'light') {
      root.classList.add('light');
    } else {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    }

    if (settings.theme === 'adaptive') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e: MediaQueryListEvent) => {
        root.classList.remove('light', 'dark');
        root.classList.add(e.matches ? 'dark' : 'light');
      };
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [settings?.theme]);

  const selectedGame = games.find((g) => g.info.id === selectedGameId);

  const handleSelectGame = (gameId: string | null) => {
    setSelectedGameId(gameId);
    if (gameId) {
      setLastSelectedGameId(gameId);
    }
  };

  const handleSelectGameIcon = (gameId: string | null) => {
    setActiveView('games');
    handleSelectGame(gameId);
  };

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
      setSelectedGameId(null);
    }
  };

  const handleVerifyGame = async (_gameId: string) => {
    alert('File verification coming soon!');
  };

  const uninstalledGames = MOCK_AVAILABLE_GAMES.filter(
    (mock) => !games.some((g) => g.info.id === mock.id && g.status !== 'not_installed')
  );

  const renderContent = () => {
    if (activeView === 'news') {
      return <News />;
    }
    if (activeView === 'store') {
      return (
        <div className="h-full flex flex-col items-center justify-center text-center p-8">
          <h2 className="text-xl font-semibold mb-2">Store Coming Soon</h2>
          <p className="text-ink-muted">Browse and install new Pandawan games here.</p>
        </div>
      );
    }

    // Games view: always keep the game selection bar visible
    return (
      <GamesPage games={games}>
        {selectedGame ? (
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
          <GamesHome games={games} onSelectGame={handleSelectGame} />
        )}
      </GamesPage>
    );
  };

  return (
    <div className="h-screen flex flex-col bg-transparent text-ink overflow-hidden">
      <TitleBar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AppTopBar
          activeView={activeView}
          selectedGameId={selectedGameId}
          games={games}
          onGamesClick={() => {
            setActiveView('games');
            // Return to last visited state inside the Games page.
            setSelectedGameId(lastSelectedGameId);
          }}
          onNewsClick={() => {
            setActiveView('news');
            setSelectedGameId(lastSelectedGameId);
          }}
          onStoreClick={() => {
            setActiveView('store');
            setSelectedGameId(lastSelectedGameId);
          }}
          onSettingsClick={() => setIsSettingsOpen(true)}
          onPlayerClick={() => {}}
          onSelectGameIcon={handleSelectGameIcon}
          onDoubleClick={() => windowTitlebarToggleMaximize()}
        />

        <div className="flex-1 overflow-hidden">
          {renderContent()}
        </div>
      </div>
      <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      <AddGameModal
        isOpen={isAddGameOpen}
        onClose={() => setIsAddGameOpen(false)}
        onInstall={handleInstallGame}
        availableGames={uninstalledGames}
      />
    </div>
  );
}

export default App;
