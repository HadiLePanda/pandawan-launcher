import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { commands } from '@/lib/commands';
import { unwrapResult } from '@/lib/errors';
import { avatarUrl } from '@/lib/avatars';
import { isGamePinned } from '@/lib/pins';
import * as gameService from '@/lib/game-service';
import { checkForUpdatesOnStartup as checkForLauncherUpdate } from '@/lib/updater-service';
import {
  useUpdaterStore,
  checkForUpdates,
  downloadAndInstall,
  quitLauncher,
} from '@/lib/updater-service';
import { listen } from '@tauri-apps/api/event';
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { logger } from '@/lib/logger';
import { loadCatalog as loadCatalogService } from '@/lib/catalog-service';
import { startCatalogPoll } from '@/lib/cdn';
import * as nav from '@/lib/nav-history';
import type { NavEntry, NavView } from '@/lib/nav-history';
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
  /** Bumped to abandon an in-flight verification; see `closeVerify`. */
  const verifyRunRef = useRef(0);
  const [trayHintPending, setTrayHintPending] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [history, setHistory] = useState<nav.NavHistory>(() =>
    nav.initialHistory({ view: 'games', gameId: null, article: null })
  );

  const surface = nav.current(history);
  const activeView = surface.view;
  const selectedGameId = surface.gameId;
  const newsArticle = surface.article;
  const [staleCatalogFor, setStaleCatalogFor] = useState<NavView>('games');
  const [contextMenu, setContextMenu] = useState<{ gameId: string; x: number; y: number } | null>(
    null
  );
  const [detailsModal, setDetailsModal] = useState<{
    gameId: string;
    view: 'patchNotes' | 'news' | 'info';
  } | null>(null);

  const {
    games,
    news,
    activeDownloads,
    finishedDownloads,
    dismissFinishedDownload,
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
    dismissNotification,
    clearNotifications,
    avatarId,
    unpinnedGameIds,
    toggleGamePinned,
    channelFor,
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
  //
  // The busy check reads the store directly instead of closing over `games`:
  // depending on the array here tore the poller down and rebuilt it on every
  // status change, which discarded the fingerprint baseline mid-transfer and
  // made the next tick report the content the launcher already shows as new.
  useEffect(() => {
    const handle = startCatalogPoll({
      loadCatalog: async () => {
        const { catalog } = await loadCatalogService();
        return { catalog };
      },
      onChange: () => setIsCatalogStale(true),
      isBusy: () => {
        const { activeDownloads, games } = useLauncherStore.getState();
        return activeDownloads.size > 0 || games.some((g) => g.status === 'running');
      },
    });
    return () => handle.stop();
  }, []);

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

  // Clears the dot before the reload so it disappears even if the reload fails.
  const handleRefreshCatalog = useCallback(async () => {
    setIsCatalogStale(false);
    await loadCatalog();
  }, [loadCatalog]);

  // A field-level command rather than save_settings: that replaces the whole
  // object, so recording this flag used to send a snapshot read earlier and put
  // back every setting the user had changed in between.
  const markTrayHintShown = useCallback(async () => {
    const { settings: current } = useLauncherStore.getState();
    if (!current || current.trayHintShown) return;
    unwrapResult(await commands.markTrayHintShown());
    // Rust owns the flag now, so the store follows it rather than deciding it.
    useLauncherStore.setState((state) =>
      state.settings ? { settings: { ...state.settings, trayHintShown: true } } : {}
    );
  }, []);

  // The one-time tray hint fires on the first real dock, not on first run: it
  // only means anything to someone who just lost the window. A notification is
  // the only thing visible while the window is hidden; if it is denied or
  // fails, the popover is kept for the next time the window is opened. It is
  // marked shown only once actually delivered, so a suppressed hint is not
  // burned.
  const deliverTrayHint = useCallback(async () => {
    if (!settings || settings.trayHintShown) return;

    let granted = false;
    try {
      granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === 'granted';
    } catch (err) {
      logger.warn('Notification permission check failed', { error: String(err) });
    }

    if (granted) {
      try {
        sendNotification({
          title: t('trayHint.notificationTitle'),
          body: t('trayHint.notificationBody'),
        });
        await markTrayHintShown();
        return;
      } catch (err) {
        logger.warn('Tray hint notification failed, falling back to the popover', {
          error: String(err),
        });
      }
    }
    setTrayHintPending(true);
  }, [settings, markTrayHintShown, t]);

  useEffect(() => {
    const unlisten = listen('tray-docked', () => {
      void deliverTrayHint();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [deliverTrayHint]);

  const dismissTrayHint = useCallback(() => {
    setTrayHintPending(false);
    void markTrayHintShown();
  }, [markTrayHintShown]);

  // The nav button and the banner are two views of the same updater state. The
  // button is the persistent affordance; the banner is the launch-time prompt
  // that an update exists (and carries download progress), dismissible for the
  // session.
  const updaterStatus = useUpdaterStore((s) => s.status);
  const updaterVersion = useUpdaterStore((s) => s.version);
  const updaterDownloadedBytes = useUpdaterStore((s) => s.downloadedBytes);
  const updaterTotalBytes = useUpdaterStore((s) => s.totalBytes);
  const updaterError = useUpdaterStore((s) => s.error);
  // A game in flight owns a playtime recorder inside this process; restarting to
  // apply an update would kill it, so the chip confirms first.
  const isGameRunning = useMemo(() => games.some((g) => g.status === 'running'), [games]);
  const updaterProgress =
    updaterStatus === 'ready'
      ? 100
      : updaterStatus === 'downloading' && updaterTotalBytes && updaterTotalBytes > 0
        ? Math.min(100, Math.round((updaterDownloadedBytes / updaterTotalBytes) * 100))
        : null;

  // The chip owns a ready update and restarts only through its guarded path
  // (which warns while a game runs, so the playtime waiter survives). This
  // handler is the download side only.
  const handleLauncherUpdateClick = useCallback(() => {
    void downloadAndInstall();
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

  // The tray drives two actions that only exist in the frontend: the update
  // check lives in the JS updater plugin, and quitting needs a confirmation
  // naming the game it will stop. The window close reaches this too, when
  // close-to-tray is off. Event names mirror tray::EVENT_CHECK_UPDATES /
  // EVENT_QUIT_REQUESTED in Rust.
  useEffect(() => {
    const quit = listen('tray-quit-requested', () => {
      if (confirm(t('tray.quitWhileGameRunning'))) {
        void quitLauncher();
      }
    });
    // A tray-initiated check has no window to report into: the launcher is hidden
    // in the tray by definition, and every outcome - found, already current, or
    // failed - only ever reached the update banner and popover. So the check ran
    // and the result was invisible, which is why this looked like it did nothing.
    // A notification is the one surface that exists while the window does not.
    const check = listen('tray-check-updates', async () => {
      const result = await checkForUpdates({ manual: true });
      const version = useUpdaterStore.getState().version;
      const body =
        result === 'available'
          ? t('tray.updateFound', { version: version ?? '' })
          : result === 'error'
            ? t('tray.updateFailed')
            : t('tray.updateUpToDate');
      try {
        // Permission was already asked for by the tray hint; a refusal here just
        // means the result stays in the banner, which is where it will be next
        // time the window opens.
        if (!(await isPermissionGranted())) return;
        sendNotification({ title: 'Pandawan Launcher', body });
      } catch (err) {
        logger.warn('Tray update notification failed', { error: String(err) });
      }
    });

    return () => {
      quit.then((fn) => fn());
      check.then((fn) => fn());
    };
  }, [t]);

  const selectedGame = games.find((g) => g.info.id === selectedGameId);

  const goTo = useCallback((entry: NavEntry) => {
    setHistory((prev) => nav.push(prev, entry));
  }, []);

  const handleNavigateBack = useCallback(() => {
    setHistory((prev) => nav.goBack(prev));
  }, []);

  const handleNavigateForward = useCallback(() => {
    setHistory((prev) => nav.goForward(prev));
  }, []);

  /** Leaving Games and coming back lands on the games surface actually left. */
  const goToView = useCallback((view: NavView) => {
    setHistory((prev) => {
      const live = nav.current(prev);
      if (live.view === view) {
        return nav.push(prev, { view, gameId: null, article: null });
      }
      const restored = view === 'games' ? nav.lastGamesEntry(prev) : null;
      return nav.push(prev, {
        view,
        gameId: restored?.gameId ?? null,
        article: restored?.article ?? null,
      });
    });
  }, []);

  const handleSelectGame = useCallback(
    (gameId: string | null) => {
      goTo({ view: 'games', gameId, article: null });
    },
    [goTo]
  );

  const handleSelectGameIcon = useCallback(
    (gameId: string | null) => {
      goTo({ view: 'games', gameId, article: null });
    },
    [goTo]
  );

  const handleOpenArticle = useCallback((gameId: string, articleId: string) => {
    setHistory((prev) => {
      const article = { gameId, articleId };
      return nav.push(prev, { ...nav.current(prev), gameId, article });
    });
  }, []);

  const handleCloseArticle = useCallback(() => {
    setHistory((prev) => nav.replaceEntry(prev, { ...nav.current(prev), article: null }));
  }, []);

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
  // channel would change the label and nothing else. The resolver itself lives
  // in the store (`channelFor`), which is where the overrides are kept.

  const handleInstallGame = async (gameId: string) => {
    const game = games.find((g) => g.info.id === gameId);
    if (!game) return;
    await installGame(gameId, channelFor(gameId, game.info.channel));
  };

  const handleUpdateGame = async (gameId: string) => {
    const game = games.find((g) => g.info.id === gameId);
    if (!game) return;
    await updateGame(gameId, channelFor(gameId, game.info.channel));
  };

  const handleUninstallGame = async (gameId: string) => {
    if (confirm(t('app.confirmUninstall'))) {
      await uninstallGame(gameId);
      setHistory((prev) => ({
        ...prev,
        entries: prev.entries.map((entry) =>
          entry.gameId === gameId ? { view: entry.view, gameId: null, article: null } : entry
        ),
      }));
    }
  };

  // The game a menu or details panel was opened for. Both read `game.status`
  // several lines into their component, so an id that no longer resolves - the
  // game was uninstalled, or a catalog refresh dropped it - must render nothing
  // rather than pass an undefined game down as if it were there.
  const contextMenuGame = contextMenu
    ? games.find((g) => g.info.id === contextMenu.gameId)
    : undefined;
  const detailsModalGame = detailsModal
    ? games.find((g) => g.info.id === detailsModal.gameId)
    : undefined;

  // Closing the modal abandons the scan. `verifyGame` hashes every file of the
  // install, so it resolves long after a user who opened it on a hunch has
  // closed it again; without this the abandoned run's rows and verdict landed in
  // state nobody was showing and popped up on the next open. The run id is what
  // tells an abandoned run's callbacks from the current one's.
  const closeVerify = useCallback(() => {
    verifyRunRef.current += 1;
    setVerifyTarget(null);
    setVerifyResult(null);
    setVerifyError(null);
    setVerifyRows([]);
  }, []);

  useEffect(
    () => () => {
      verifyRunRef.current += 1;
    },
    []
  );

  const handleVerifyGame = async (gameId: string) => {
    const game = games.find((g) => g.info.id === gameId);
    if (!game) return;
    const run = ++verifyRunRef.current;
    setVerifyTarget(game);
    setVerifyResult(null);
    setVerifyError(null);
    setVerifyRows([]);
    try {
      const result = await gameService.verifyGame(gameId, game.info.channel, (row) => {
        if (verifyRunRef.current !== run) return;
        setVerifyRows((prev) => [...prev, row]);
      });
      if (verifyRunRef.current !== run) return;
      setVerifyResult(result);
    } catch (err) {
      if (verifyRunRef.current !== run) return;
      setVerifyError(err instanceof Error ? err.message : String(err));
    }
  };

  const pinnedGames = useMemo(
    () => games.filter((g) => isGamePinned(g.info.id, unpinnedGameIds)).map((g) => g.info),
    [games, unpinnedGameIds]
  );

  const renderContent = () => {
    const articleFromGame =
      newsArticle !== null && activeView === 'games' && newsArticle.gameId === selectedGameId;
    if (newsArticle && (activeView === 'news' || articleFromGame)) {
      const article = news.find((n) => n.id === newsArticle.articleId);
      // An item that belongs to no game is still readable; it just has no game to
      // name beside it. Requiring a game meant such an item could not be opened.
      const articleGame = newsArticle.gameId
        ? games.find((g) => g.info.id === newsArticle.gameId)
        : undefined;
      if (article) {
        return (
          <NewsArticleView
            article={article}
            gameName={articleGame?.info.name}
            gameIconUrl={articleGame?.info.iconUrl}
            gameBannerUrl={articleGame?.info.bannerUrl}
            onBack={handleCloseArticle}
            onClose={handleCloseArticle}
          />
        );
      }
      setHistory((prev) => nav.replaceEntry(prev, { ...nav.current(prev), article: null }));
      return null;
    }

    if (activeView === 'news') {
      return (
        <News
          onSelectArticle={(article) => {
            handleOpenArticle(article.gameId ?? '', article.id);
          }}
        />
      );
    }
    if (activeView === 'downloads') {
      return (
        <DownloadsPage
          downloads={activeDownloads}
          finished={finishedDownloads}
          games={games.map((g) => g.info)}
          onCancel={cancelOperation}
          onDismiss={dismissFinishedDownload}
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
            channel={channelFor(selectedGame.info.id, selectedGame.info.channel)}
            catalogChannel={selectedGame.info.channel}
            onChannelChange={(channel) => {
              setGameChannel(selectedGame.info.id, channel);
              // A channel change means a different manifest, so the cached
              // update state no longer describes this install. Re-check rather
              // than leaving a stale "update available" on screen.
              void refreshUpdateStatus();
            }}
            onSelectNewsArticle={(articleId) => handleOpenArticle(selectedGame.info.id, articleId)}
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
    <div className="relative h-screen max-h-screen flex flex-col bg-transparent text-ink overflow-hidden">
      {/* The only progress bar. Full width at the very top edge of the app, above
          the title bar, so it reads as chrome rather than a border of the nav and
          never fights the games list. Tinted by state, but never colour alone:
          the banner and the chip always carry the label and the percentage. */}
      {updaterProgress != null && (
        <div
          className="update-progress-line"
          role="progressbar"
          aria-valuenow={updaterProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('updateBanner.downloading', {
            version: updaterVersion ?? '',
            progress: ` ${updaterProgress}%`,
          })}
        >
          <div
            className={`update-progress-line-fill${
              updaterStatus === 'ready' ? ' update-progress-line-fill-ready' : ''
            }`}
            style={{ width: `${updaterProgress}%` }}
          />
        </div>
      )}
      <TitleBar
        catalogUnreachable={catalogUnreachable}
        catalogSource={catalogSource}
        onRetry={() => loadCatalog()}
        onDoubleClick={() => windowTitlebarToggleMaximize()}
      />
      <MainNav
        activeView={activeView}
        onGamesClick={() => goToView('games')}
        onNewsClick={() => goToView('news')}
        onStoreClick={() => goToView('store')}
        onDownloadsNavigate={() => goToView('downloads')}
        onNotificationsClick={() => {
          // Opening the panel is the read receipt: the bell's badge and its
          // highlight both mean "unread", and this is the user reading them.
          markAllNotificationsRead();
          setIsNotificationsOpen((v) => !v);
        }}
        onSettingsClick={() => {
          setIsNotificationsOpen(false);
          setIsSettingsOpen(true);
        }}
        activeDownloads={activeDownloads}
        notificationsBadge={unreadCount}
        avatarUrl={avatarUrl(avatarId)}
        onNavigatePrev={handleNavigateBack}
        canNavigatePrev={nav.canGoBack(history)}
        onNavigateNext={handleNavigateForward}
        canNavigateNext={nav.canGoForward(history)}
        catalogStale={isCatalogStale}
        onCatalogRefresh={handleRefreshCatalog}
        launcherUpdate={
          updaterStatus === 'available' ||
          updaterStatus === 'downloading' ||
          updaterStatus === 'ready'
            ? {
                version: updaterVersion,
                ready: updaterStatus === 'ready',
                downloading: updaterStatus === 'downloading',
                errored: updaterStatus === 'available' && Boolean(updaterError),
              }
            : null
        }
        onLauncherUpdateClick={handleLauncherUpdateClick}
        gameRunning={isGameRunning}
        notificationsPanel={
          isNotificationsOpen && (
            <NotificationsPanel
              notifications={notifications}
              onMarkAllRead={markAllNotificationsRead}
              onDismiss={dismissNotification}
              onClearAll={clearNotifications}
              onClose={() => setIsNotificationsOpen(false)}
            />
          )
        }
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
        <UpdateBanner />

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
      {contextMenu && contextMenuGame && (
        <GameContextMenu
          game={contextMenuGame}
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onAction={(action) => handleMenuAction(action, contextMenu.gameId)}
        />
      )}

      {detailsModalGame && detailsModal && (
        <GameDetailsModal
          game={detailsModalGame}
          news={news.filter((n) => n.gameId === detailsModal.gameId)}
          view={detailsModal.view}
          onClose={() => setDetailsModal(null)}
        />
      )}

      <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Fallback for the tray hint: shown only when the notification could not
          be delivered, and only once the window is visible again. */}
      {trayHintPending && settings && !settings.trayHintShown && (
        <div className="toast">
          <div className="toast-content">
            <div className="toast-message">{t('trayHint.popoverMessage')}</div>
            <button
              onClick={() => {
                dismissTrayHint();
                setIsSettingsOpen(true);
              }}
              className="toast-dismiss"
            >
              {t('trayHint.changeSetting')}
            </button>
            <button onClick={dismissTrayHint} className="toast-dismiss">
              {t('common.dismiss')}
            </button>
          </div>
        </div>
      )}

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
        onClose={closeVerify}
      />
    </div>
  );
}

export default App;
