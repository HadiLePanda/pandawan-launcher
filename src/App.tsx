import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { filterGames } from '@/lib/game-filters';
import { events } from '@/lib/bindings';
import { TitleBar, MainNav } from '@components/AppHeader';
import { FiltersPanel } from '@components/FiltersPanel';
import { GamesBar } from '@components/GamesBar';
import { GamePage, GameDetailsModal } from '@components/GamePage';
import { GamesPage } from '@components/GamesPage';
import { GameContextMenu } from '@components/GameContextMenu';
import { NewsArticleView } from '@components/NewsArticleView';
import { DownloadsPage } from '@components/DownloadsPage';
import { NotificationsPanel } from '@components/NotificationsPanel';
import type { GameContextAction } from '@/lib/game-context';
import { GamesHome } from '@components/GamesHome';
import { Settings } from '@components/Settings';
import { PinManagerModal } from '@components/PinManagerModal';
import { News } from '@components/News';
import { UpdateBanner } from '@components/UpdateBanner';
import { VerifyGameModal } from '@components/VerifyGameModal';
import { StorePlaceholder } from '@components/StorePlaceholder';
import { useLauncherStore } from '@/lib/store';
import { avatarUrl } from '@/lib/avatars';
import { isGamePinned } from '@/lib/pins';
import * as gameService from '@/lib/game-service';
import { checkForUpdatesOnStartup as checkForLauncherUpdate } from '@/lib/updater-service';
import { useUpdaterStore, downloadAndInstall, restartToApplyUpdate } from '@/lib/updater-service';
import { loadCatalog as loadCatalogService } from '@/lib/catalog-service';
import { startCatalogPoll, type CatalogPollHandle } from '@/lib/cdn';
import { applyLanguage } from '@/lib/i18n';
import { windowTitlebarToggleMaximize } from '@/lib/window';
import type { Game, VerificationResult, VerifyProgress } from '@/types';

declare global {
  interface Window {
    hideSplash?: () => void;
  }
}

function App() {
  const { t } = useTranslation();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isPinsOpen, setIsPinsOpen] = useState(false);
  const [isCatalogStale, setIsCatalogStale] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<Game | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerificationResult | null>(null);
  const [verifyRows, setVerifyRows] = useState<VerifyProgress[]>([]);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'games' | 'news' | 'store' | 'downloads'>('games');
  const [staleCatalogFor, setStaleCatalogFor] = useState(activeView);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [lastSelectedGameId, setLastSelectedGameId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ gameId: string; x: number; y: number } | null>(
    null
  );
  const [detailsModal, setDetailsModal] = useState<{
    gameId: string;
    view: 'patchNotes' | 'news' | 'info';
  } | null>(null);
  const [newsArticle, setNewsArticle] = useState<{ gameId: string; articleId: string } | null>(
    null
  );

  const {
    games,
    news,
    activeDownloads,
    cancelling,
    error,
    installGame,
    updateGame,
    launchGame,
    closeGame,
    uninstallGame,
    cancelOperation,
    updateGameStatus,
    refreshInstallation,
    refreshUpdateStatus,
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
    avatarId,
    unpinnedGameIds,
    toggleGamePinned,
    channelOverrides,
    setGameChannel,
  } = useLauncherStore();

  const installedIds = useMemo(
    () => new Set(games.filter((g) => g.status !== 'not_installed').map((g) => g.info.id)),
    [games]
  );

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

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

  // Watch the catalog for content published while the launcher was open. A
  // desktop app has no push channel from the CDN, so this polls a cheap
  // fingerprint every few minutes and only flags a change once something
  // actually moved. Polling pauses while a download or game run is in progress.
  const pollRef = useRef<CatalogPollHandle | null>(null);
  useEffect(() => {
    const handle = startCatalogPoll({
      loadCatalog: async () => {
        const { catalog } = await loadCatalogService();
        return { catalog };
      },
      onChange: () => setIsCatalogStale(true),
      isBusy: () => activeDownloads.size > 0 || games.some((g) => g.status === 'running'),
    });
    pollRef.current = handle;
    return () => {
      handle.stop();
      pollRef.current = null;
    };
  }, [activeDownloads.size, games]);

  // The flag is only meaningful until the user acts on it: either they refresh
  // and get the new content, or they keep working. Clearing it on view change
  // stops a stale dot from outliving the thing it pointed at.
  //
  // Adjusted during render rather than in an effect so the dot never paints once
  // against the old view first. `staleCatalogFor` records which view the current
  // flag belongs to; a mismatch means the user navigated and the flag is spent.
  // Mounting is a no-op because the state starts out on this same view.
  if (staleCatalogFor !== activeView) {
    setStaleCatalogFor(activeView);
    setIsCatalogStale(false);
  }

  // Applies a flagged catalog change. Deferred a tick so the dot clears even if
  // the reload fails, and so the click does not fight the poll that set it.
  const handleRefreshCatalog = useCallback(async () => {
    setIsCatalogStale(false);
    await loadCatalog();
  }, [loadCatalog]);

  // The nav button and the banner are two views of the same updater state. The
  // button is the primary affordance now; the banner is kept only for the
  // download progress it shows, and hidden once the button is on screen.
  const updaterStatus = useUpdaterStore((s) => s.status);
  const updaterVersion = useUpdaterStore((s) => s.version);
  const updaterDismissed = useUpdaterStore((s) => s.dismissed);

  const handleLauncherUpdateClick = useCallback(() => {
    if (updaterStatus === 'ready') {
      void restartToApplyUpdate();
    } else {
      void downloadAndInstall();
    }
  }, [updaterStatus]);

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
        setDetailsModal({
          gameId,
          view: action === 'gameNews' ? 'news' : action === 'patchNotes' ? 'patchNotes' : 'info',
        });
        return;
    }
  };

  // The channel the player chose, falling back to the catalog's. Install and
  // update must resolve against this, not game.info.channel, or picking a
  // channel would change the label and nothing else.
  const effectiveChannel = (gameId: string, catalogChannel: string) =>
    channelOverrides[gameId] ?? catalogChannel;

  const handleInstallGame = async (gameId: string) => {
    const game = games.find((g) => g.info.id === gameId);
    if (!game) return;
    await installGame(gameId, effectiveChannel(gameId, game.info.channel));
  };

  const handleUpdateGame = async (gameId: string) => {
    const game = games.find((g) => g.info.id === gameId);
    if (!game) return;
    await updateGame(gameId, effectiveChannel(gameId, game.info.channel));
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
    setVerifyRows([]);
    try {
      const result = await gameService.verifyGame(gameId, game.info.channel, (row) =>
        setVerifyRows((prev) => [...prev, row])
      );
      setVerifyResult(result);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    }
  };

  const pinnedGames = useMemo(
    () => games.filter((g) => isGamePinned(g.info.id, unpinnedGameIds)).map((g) => g.info),
    [games, unpinnedGameIds]
  );

  const handleNavigate = (dir: -1 | 1) => {
    const ids = pinnedGames.map((g) => g.id);
    if (ids.length === 0) return;
    if (!selectedGameId) {
      setSelectedGameId(ids[0]);
      return;
    }
    const idx = ids.indexOf(selectedGameId);
    const base = idx === -1 ? 0 : idx;
    setSelectedGameId(ids[(base + dir + ids.length) % ids.length]);
  };

  const renderContent = () => {
    // The article view wins over the tab underneath it, which means navigating to
    // another tab has to close it explicitly or it stays on screen - the store
    // looked like it was rendering the news article. Scoping it to the news tab
    // makes the invariant structural: there is no state combination where an
    // article is showing while the store is.
    if (activeView === 'news' && newsArticle) {
      const article = news.find((n) => n.id === newsArticle.articleId);
      const articleGame = games.find((g) => g.info.id === newsArticle.gameId);
      if (article && articleGame) {
        return (
          <NewsArticleView
            article={article}
            gameName={articleGame.info.name}
            gameIconUrl={articleGame.info.iconUrl}
            gameBannerUrl={articleGame.info.bannerUrl}
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
          cancelling={cancelling}
        />
      );
    }
    if (activeView === 'store') {
      return <StorePlaceholder />;
    }

    return (
      <GamesPage games={games}>
        {selectedGame ? (
          <GamePage
            game={selectedGame}
            news={news}
            downloadProgress={activeDownloads.get(selectedGame.info.id)}
            onPlay={() => launchGame(selectedGame.info.id)}
            onClose={() => closeGame(selectedGame.info.id)}
            onInstall={() => handleInstallGame(selectedGame.info.id)}
            onUpdate={() => handleUpdateGame(selectedGame.info.id)}
            onUninstall={() => handleUninstallGame(selectedGame.info.id)}
            onVerify={() => handleVerifyGame(selectedGame.info.id)}
            channel={effectiveChannel(selectedGame.info.id, selectedGame.info.channel)}
            catalogChannel={selectedGame.info.channel}
            onChannelChange={(channel) => {
              setGameChannel(selectedGame.info.id, channel);
              // A channel change means a different manifest, so the cached
              // update state no longer describes this install. Re-check rather
              // than leaving a stale "update available" on screen.
              void refreshUpdateStatus();
            }}
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
      <TitleBar
        catalogUnreachable={catalogUnreachable}
        catalogSource={catalogSource}
        onRetry={() => loadCatalog()}
        onDoubleClick={() => windowTitlebarToggleMaximize()}
      />
      <MainNav
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
          // Cleared, not just hidden: leaving it set means coming back to News
          // reopens the article the user walked away from.
          setNewsArticle(null);
          setActiveView('news');
          setSelectedGameId(lastSelectedGameId);
        }}
        onStoreClick={() => {
          setNewsArticle(null);
          setActiveView('store');
          setSelectedGameId(lastSelectedGameId);
        }}
        onDownloadsNavigate={() => {
          setNewsArticle(null);
          setActiveView('downloads');
          setSelectedGameId(lastSelectedGameId);
        }}
        onNotificationsClick={() => {
          setIsNotificationsOpen((v) => !v);
        }}
        onSettingsClick={() => {
          setIsNotificationsOpen(false);
          setIsSettingsOpen(true);
        }}
        activeDownloads={activeDownloads}
        notificationsBadge={unreadCount}
        avatarUrl={avatarUrl(avatarId)}
        onNavigatePrev={() => handleNavigate(-1)}
        onNavigateNext={() => handleNavigate(1)}
        catalogStale={isCatalogStale}
        onCatalogRefresh={handleRefreshCatalog}
        launcherUpdate={
          updaterStatus === 'available' ||
          updaterStatus === 'downloading' ||
          updaterStatus === 'ready'
            ? { version: updaterVersion, ready: updaterStatus === 'ready' }
            : null
        }
        onLauncherUpdateClick={handleLauncherUpdateClick}
      />

      {/* Shown in every view, not just the games grid. News and the store are
          navigated from a game's page, so hiding the pinned rail there meant
          losing the way back to a game and forcing a round trip through the
          nav every time. */}
      <GamesBar
        games={pinnedGames}
        installedIds={installedIds}
        unpinnedGameIds={unpinnedGameIds}
        selectedGameId={selectedGameId}
        isOverviewSelected={selectedGameId === null}
        onSelect={handleSelectGameIcon}
        onContextMenu={handleContextMenu}
        onOpenPins={() => setIsPinsOpen(true)}
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        {isNotificationsOpen && (
          <NotificationsPanel
            notifications={notifications}
            onMarkAllRead={markAllNotificationsRead}
            onClear={clearNotifications}
            onClose={() => setIsNotificationsOpen(false)}
          />
        )}

        <UpdateBanner hidden={!updaterDismissed} />

        <div className="app-body flex flex-row flex-1 overflow-hidden">
          {activeView === 'games' && !selectedGameId && (
            <FiltersPanel
              games={games.map((g) => g.info)}
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

      <PinManagerModal
        isOpen={isPinsOpen}
        onClose={() => setIsPinsOpen(false)}
        games={games.map((g) => g.info)}
        unpinnedGameIds={unpinnedGameIds}
        onTogglePin={toggleGamePinned}
      />

      <VerifyGameModal
        game={verifyTarget}
        result={verifyResult}
        error={verifyError}
        rows={verifyRows}
        onClose={() => {
          setVerifyTarget(null);
          setVerifyResult(null);
          setVerifyError(null);
          setVerifyRows([]);
        }}
      />
    </div>
  );
}

export default App;
