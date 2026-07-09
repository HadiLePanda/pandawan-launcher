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
import { ServerOff, RefreshCw } from 'lucide-react';
import { LoadingScreen } from '@components/LoadingScreen';
import { EmptyState } from '@components/EmptyState';

function ConnectionBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="banner">
      <div className="banner-text">
        <ServerOff className="w-4 h-4" />
        <span>Catalog server is unreachable. Showing bundled games; install and launch require a live server.</span>
      </div>
      <button onClick={onRetry} className="btn btn-sm btn-ghost text-ember">
        <RefreshCw className="w-4 h-4" />
        Retry
      </button>
    </div>
  );
}

function App() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddGameOpen, setIsAddGameOpen] = useState(false);
  const [activeView, setActiveView] = useState<'games' | 'news' | 'store'>('games');
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [lastSelectedGameId, setLastSelectedGameId] = useState<string | null>(null);

  const [isInitializing, setIsInitializing] = useState(true);
  const [initStatus, setInitStatus] = useState('Loading launcher…');

  const {
    games,
    activeDownloads,
    error,
    isLoading,
    installGame,
    updateGame,
    launchGame,
    uninstallGame,
    cancelOperation,
    loadCatalog,
    loadNews,
    loadGames,
    loadSettings,
    clearError,
    settings,
    catalogSource,
    catalogUnreachable,
  } = useLauncherStore();

  useEffect(() => {
    // Hand off from the inline splash screen as soon as React is in control.
    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('is-hidden');
      setTimeout(() => splash.remove(), 400);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setInitStatus('Loading settings…');
      await loadSettings();
      setInitStatus('Loading catalog…');
      await loadCatalog();
      setInitStatus('Loading news…');
      await loadNews();
      setInitStatus('Loading games…');
      await loadGames();
      setIsInitializing(false);
    };
    init();
  }, []);

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
    await installGame(gameId, game.info.channel);
    setIsAddGameOpen(false);
  };

  const handleUpdateGame = async (gameId: string) => {
    const game = games.find((g) => g.info.id === gameId);
    if (!game) return;
    await updateGame(gameId, game.info.channel);
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

  const uninstalledGames = games
    .filter((g) => g.status === 'not_installed')
    .map((g) => g.info);

  const renderContent = () => {
    if (activeView === 'news') {
      return <News />;
    }
    if (activeView === 'store') {
      return (
        <div className="flex-1 flex flex-col justify-center">
          <EmptyState
            title="Store Coming Soon"
            description="Browse and install new Pandawan games here."
          />
        </div>
      );
    }

    return (
      <GamesPage
        games={games}
        selectedGameId={selectedGameId}
        onSelectGameIcon={handleSelectGameIcon}
      >
        {selectedGame ? (
          <GamePage
            game={selectedGame}
            downloadProgress={activeDownloads.get(selectedGame.info.id)}
            onPlay={() => launchGame(selectedGame.info.id)}
            onInstall={() => handleInstallGame(selectedGame.info.id)}
            onUpdate={() => handleUpdateGame(selectedGame.info.id)}
            onUninstall={() => handleUninstallGame(selectedGame.info.id)}
            onVerify={() => handleVerifyGame(selectedGame.info.id)}
            onCancel={cancelOperation}
          />
        ) : (
          <GamesHome games={games} onSelectGame={handleSelectGame} />
        )}
      </GamesPage>
    );
  };

  return (
    <>
      <LoadingScreen isOpen={isInitializing || isLoading} status={initStatus} />
      <div className="min-h-screen flex flex-col bg-transparent text-ink overflow-hidden">
        <TitleBar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AppTopBar
          activeView={activeView}
          onGamesClick={() => {
            setActiveView('games');
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
          onDoubleClick={() => windowTitlebarToggleMaximize()}
        />

        {catalogUnreachable && catalogSource !== 'remote' && (
          <ConnectionBanner onRetry={() => loadCatalog()} />
        )}

        <div className="flex-1 overflow-hidden flex flex-col">{renderContent()}</div>
      </div>
      <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {error && (
        <div className="toast">
          <div className="toast-content">
            <div className="toast-message">{error}</div>
            <button onClick={clearError} className="toast-dismiss">
              Dismiss
            </button>
          </div>
        </div>
      )}

      <AddGameModal
        isOpen={isAddGameOpen}
        onClose={() => setIsAddGameOpen(false)}
        onInstall={handleInstallGame}
        availableGames={uninstalledGames}
      />
    </div>
    </>
  );
}

export default App;
