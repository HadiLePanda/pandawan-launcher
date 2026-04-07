import { useState, useEffect } from 'react';
import { Header } from '@components/Header';
import { Library } from '@components/Library';
import { GameDetail } from '@components/GameDetail';
import { Settings } from '@components/Settings';
import { Store } from '@components/Store';
import { News } from '@components/News';
import { useLauncherStore } from '@/lib/store';

type Tab = 'library' | 'store' | 'news' | 'settings';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('library');
  const { games, activeDownloads, selectedGameId, selectGame, installGame, launchGame, uninstallGame, checkForUpdates } = useLauncherStore();

  // Initialize app on mount
  useEffect(() => {
    const init = async () => {
      // Load settings and games
      await useLauncherStore.getState().loadGames();
    };
    init();
  }, []);

  const selectedGame = games.find((g) => g.info.id === selectedGameId);

  const handleBackFromDetail = () => {
    selectGame(null);
  };

  const handleInstallGame = async (gameId: string) => {
    const game = games.find((g) => g.info.id === gameId);
    if (!game) return;
    
    const manifestUrl = game.info.manifestUrl;
    const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf('/'));
    
    await installGame(gameId, manifestUrl, baseUrl);
  };

  const handleUpdateGame = async (gameId: string) => {
    // Update uses same mechanism as install (patching)
    await handleInstallGame(gameId);
  };

  const handleUninstallGame = async (gameId: string) => {
    if (confirm('Are you sure you want to uninstall this game?')) {
      await uninstallGame(gameId);
      selectGame(null);
    }
  };

  const handleVerifyGame = async (gameId: string) => {
    alert('File verification coming soon!');
  };

  const renderContent = () => {
    // If a game is selected, show detail view
    if (selectedGame && activeTab === 'library') {
      return (
        <GameDetail
          game={selectedGame}
          downloadProgress={activeDownloads.get(selectedGame.info.id)}
          onBack={handleBackFromDetail}
          onPlay={() => launchGame(selectedGame.info.id)}
          onInstall={() => handleInstallGame(selectedGame.info.id)}
          onUpdate={() => handleUpdateGame(selectedGame.info.id)}
          onUninstall={() => handleUninstallGame(selectedGame.info.id)}
          onVerify={() => handleVerifyGame(selectedGame.info.id)}
        />
      );
    }

    switch (activeTab) {
      case 'library':
        return <Library onSelectGame={selectGame} />;
      case 'store':
        return <Store />;
      case 'news':
        return <News />;
      case 'settings':
        return <Settings />;
      default:
        return <Library onSelectGame={selectGame} />;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-canvas text-ink overflow-hidden">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex-1 overflow-hidden">
        {renderContent()}
      </main>
    </div>
  );
}

export default App;
