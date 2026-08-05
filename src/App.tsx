import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { filterGames } from '@/lib/game-filters';
import { events } from '@/lib/bindings';
import { TitleBar } from '@components/TitleBar';
import { AppTopBar } from '@components/AppTopBar';
import { GameSidebar } from '@components/GameSidebar';
import { GamePage, GameDetailsModal } from '@components/GamePage';
import { GamesPage } from '@components/GamesPage';
import { GameContextMenu } from '@components/GameContextMenu';
import { NewsArticleView } from '@components/NewsArticleView';
import { DownloadsPage } from '@components/DownloadsPage';
import { NotificationsPanel } from '@components/NotificationsPanel';
import type { GameContextAction } from '@/lib/game-context';
import { GamesHome } from '@components/GamesHome';
import { Settings } from '@components/Settings';
import { AddGameModal } from '@components/AddGameModal';
import { News } from '@components/News';
import { UpdateBanner } from '@components/UpdateBanner';
import { VerifyGameModal } from '@components/VerifyGameModal';
import { useLauncherStore } from '@/lib/store';
import * as gameService from '@/lib/game-service';
import { checkForUpdatesOnStartup as checkForLauncherUpdate } from '@/lib/updater-service';
import { applyLanguage } from '@/lib/i18n';
import { windowTitlebarToggleMaximize } from '@/lib/window';
import type { Game, VerificationResult } from '@/types';
import { ServerOff, RefreshCw } from 'lucide-react';
import { EmptyState } from '@components/EmptyState';

declare global {
  interface Window {
    hideSplash?: () => void;
  }
}

function ConnectionBanner({ onRetry, className }: { onRetry: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn('banner', className)}>
      <div className="banner-text truncate">
        <ServerOff className="w-4 h-4 shrink-0" />
        <span className="truncate">{t('app.connectionBanner')}</span>
      </div>
      <button onClick={onRetry} className="btn btn-sm btn-ghost text-ember shrink-0">
        <RefreshCw className="w-4 h-4" />
        {t('common.retry')}
      </button>
    </div>
  );
}

function App() {
  const { t } = useTranslation();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isAddGameOpen, setIsAddGameOpen] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<Game | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerificationResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'games' | 'news' | 'store' | 'downloads'>('games');
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [lastSelectedGameId, setLastSelectedGameId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ gameId: string; x: number; y: number } | null>(
    null
  );
  const [detailsModal, setDetailsModal] = useState<
    { gameId: string; view: 'patchNotes' | 'news' | 'info' } | null
  >(null);
  const [newsArticle, setNewsArticle] = useState<{ gameId: string; articleId: string } | null>(
    null
  );

  const {
    games,
    news,
    activeDownloads,
    error,
    installGame,
    updateGame,
    launchGame,
    uninstallGame,
    cancelOperation,
    updateGameStatus,
    refreshInstallation,
    loadCatalog,
    loadNews,
    loadGames,
    loadSettings,
    clearError,
    settings,
    catalogSource,
    catalogUnreachable,
    gameFilters,
    setGameFilters,
    notifications,
    markAllNotificationsRead,
    clearNotifications,
  } = useLauncherStore();

  const installedIds = useMemo(
    () => new Set(games.filter((g) => g.status !== 'not_installed').map((g) => g.info.id)),
    [games]
  );

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const filteredGameIds = useMemo(() => {
    const infos = games.map((g) => g.info);
    const filtered = filterGames(infos, installedIds, gameFilters);
    return new Set(filtered.map((g) => g.id));
  }, [games, installedIds, gameFilters]);

  const filteredGames = useMemo(
    () => games.filter((g) => filteredGameIds.has(g.info.id)),
    [games, filteredGameIds]
  );

  useEffect(() => {
    const MIN_LOADING_MS = 1000;
    const startTime = Date.now();
    let cancelled = false;

    const removeSplash = () => {
      if (typeof window.hideSplash === 'function') {
        window.hideSplash();
        return;
      }
      const splash = document.getElementById('splash');
      if (splash) splash.remove();
    };

    const init = async () => {
      await loadSettings();
      await loadCatalog();
      await loadNews();
      await loadGames();

      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, MIN_LOADING_MS - elapsed);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }

      if (!cancelled) {
        removeSplash();
      }
    };

    init();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Silent launcher update check, fired once settings are loaded and only
  // when the autoUpdateLauncher toggle is on. Manual checks in Settings are
  // unaffected. The service logs and swallows failures, so the UI never blocks.
  useEffect(() => {
    void checkForLauncherUpdate(settings?.autoUpdateLauncher);
  }, [settings?.autoUpdateLauncher]);

  useEffect(() => {
    void applyLanguage(settings?.language);
  }, [settings?.language]);

  useEffect(() => {
    if (!settings) return;
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    if (settings.theme === 'dark') {
      root.classList.add('dark');
    } else if (settings.theme === 'light') {
      root.classList.add('light');
    } else {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.theme]);

  useEffect(() => {
    const unlisten = events.gameExited.listen((event) => {
      updateGameStatus(event.payload.game_id, 'installed');
      void refreshInstallation(event.payload.game_id);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [updateGameStatus, refreshInstallation]);

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

  const handleContextMenu = (e: React.MouseEvent, gameId: string) => {
    e.preventDefault();
    setContextMenu({ gameId, x: e.clientX, y: e.clientY });
  };

  const handleMenuAction = (action: GameContextAction, gameId: string) => {
    switch (action) {
      case 'play':
        return launchGame(gameId);
      case 'install':
        return handleInstallGame(gameId);
      case 'verify':
        return handleVerifyGame(gameId);
      case 'uninstall':
        return handleUninstallGame(gameId);
      case 'patchNotes':
      case 'gameNews':
      case 'gameInfo':
        setDetailsModal({ gameId, view: action === 'gameNews' ? 'news' : action === 'patchNotes' ? 'patchNotes' : 'info' });
        return;
    }
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
    if (confirm(t('app.confirmUninstall'))) {
      await uninstallGame(gameId);
      setSelectedGameId(null);
    }
  };

  const handleVerifyGame = async (gameId: string) => {
    const game = games.find((g) => g.info.id === gameId);
    if (!game) return;
    setVerifyTarget(game);
    setVerifyResult(null);
    setVerifyError(null);
    try {
      const result = await gameService.verifyGame(gameId, game.info.channel);
      setVerifyResult(result);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    }
  };

  const uninstalledGames = games.filter((g) => g.status === 'not_installed').map((g) => g.info);

  const renderContent = () => {
    if (newsArticle) {
      const article = news.find((n) => n.id === newsArticle.articleId);
      const articleGame = games.find((g) => g.info.id === newsArticle.gameId);
      if (article && articleGame) {
        return (
          <NewsArticleView
            article={article}
            gameName={articleGame.info.name}
            gameIconUrl={articleGame.info.iconUrl}
            onBack={() => setNewsArticle(null)}
            onClose={() => setNewsArticle(null)}
          />
        );
      }
      setNewsArticle(null);
    }

    if (activeView === 'news') {
      return (
        <News
          onSelectArticle={(article) => {
            if (!article.gameId) return;
            setNewsArticle({ articleId: article.id, gameId: article.gameId });
          }}
        />
      );
    }
    if (activeView === 'downloads') {
      return (
        <DownloadsPage
          downloads={activeDownloads}
          games={games.map((g) => g.info)}
          onCancel={cancelOperation}
        />
      );
    }
    if (activeView === 'store') {
      return (
        <div className="flex-1 flex flex-col justify-center">
          <EmptyState
            title={t('app.storeComingSoonTitle')}
            description={t('app.storeComingSoonDescription')}
          />
        </div>
      );
    }

    return (
      <GamesPage games={games}>
        {selectedGame ? (
          <GamePage
            game={selectedGame}
            news={news}
            downloadProgress={activeDownloads.get(selectedGame.info.id)}
            onPlay={() => launchGame(selectedGame.info.id)}
            onInstall={() => handleInstallGame(selectedGame.info.id)}
            onUpdate={() => handleUpdateGame(selectedGame.info.id)}
            onUninstall={() => handleUninstallGame(selectedGame.info.id)}
            onVerify={() => handleVerifyGame(selectedGame.info.id)}
            onSettings={() => setIsSettingsOpen(true)}
            onSelectNewsArticle={(articleId) =>
              setNewsArticle({ articleId, gameId: selectedGame.info.id })
            }
            onCancel={cancelOperation}
          />
        ) : (
          <GamesHome
            games={filteredGames}
            onSelectGame={handleSelectGame}
            onContextMenu={handleContextMenu}
          />
        )}
      </GamesPage>
    );
  };

  return (
    <div className="h-screen max-h-screen flex flex-col bg-transparent text-ink overflow-hidden">
      <TitleBar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <AppTopBar
          activeView={activeView}
          onGamesClick={() => {
            if (activeView === 'games') {
              setSelectedGameId(null);
            } else {
              setActiveView('games');
              setSelectedGameId(lastSelectedGameId);
            }
          }}
          onNewsClick={() => {
            setActiveView('news');
            setSelectedGameId(lastSelectedGameId);
          }}
          onStoreClick={() => {
            setActiveView('store');
            setSelectedGameId(lastSelectedGameId);
          }}
          onDownloadsClick={() => setActiveView('downloads')}
          onNotificationsClick={() => setIsNotificationsOpen((v) => !v)}
          onSettingsClick={() => setIsSettingsOpen(true)}
          onDoubleClick={() => windowTitlebarToggleMaximize()}
          downloadsBadge={activeDownloads.size}
          notificationsBadge={unreadCount}
        />

        {isNotificationsOpen && (
          <NotificationsPanel
            notifications={notifications}
            onMarkAllRead={markAllNotificationsRead}
            onClear={clearNotifications}
            onClose={() => setIsNotificationsOpen(false)}
          />
        )}

        {catalogUnreachable && catalogSource !== 'remote' && (
          <ConnectionBanner onRetry={() => loadCatalog()} className="shrink-0" />
        )}

        <UpdateBanner />

        <div className="app-body flex flex-row flex-1 overflow-hidden">
          {activeView === 'games' && (
            <GameSidebar
              games={games.map((g) => g.info)}
              installedIds={installedIds}
              selectedGameId={selectedGameId}
              onSelect={handleSelectGameIcon}
              onContextMenu={handleContextMenu}
              filters={gameFilters}
              onFilterChange={setGameFilters}
            />
          )}
          <main className="flex-1 overflow-hidden flex flex-col">{renderContent()}</main>
        </div>
      </div>
      {contextMenu && (
        <GameContextMenu
          game={games.find((g) => g.info.id === contextMenu.gameId)!}
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onAction={(action) => handleMenuAction(action, contextMenu.gameId)}
        />
      )}

      {detailsModal && (
        <GameDetailsModal
          game={games.find((g) => g.info.id === detailsModal.gameId)!}
          news={news.filter((n) => n.gameId === detailsModal.gameId)}
          view={detailsModal.view}
          onClose={() => setDetailsModal(null)}
        />
      )}

      <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {error && (
        <div className="toast toast-error">
          <div className="toast-content">
            <div className="toast-message">{error}</div>
            <button onClick={clearError} className="toast-dismiss">
              {t('common.dismiss')}
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

      <VerifyGameModal
        game={verifyTarget}
        result={verifyResult}
        error={verifyError}
        onClose={() => {
          setVerifyTarget(null);
          setVerifyResult(null);
          setVerifyError(null);
        }}
      />
    </div>
  );
}

export default App;
