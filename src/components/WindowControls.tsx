import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Square, X, Copy } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { logger } from '@/lib/logger';
import { quitLauncher } from '@/lib/updater-service';

/** One instance per module, not one per render: the resize listener is keyed on
 * it, so building a new `Window` each render tore the subscription down and set
 * it up again on every render of the title bar. */
const appWindow = getCurrentWindow();

export function WindowControls() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
    };
    checkMaximized();

    const unlisten = appWindow.onResized(() => {
      checkMaximized();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleMinimize = async () => {
    // Minimizing always goes to the taskbar. Close-to-tray is the only tray
    // preference, so there is nothing to read here and a minimize that hid the
    // window would leave no taskbar entry to restore it from.
    await appWindow.minimize();
  };

  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
    const maximized = await appWindow.isMaximized();
    setIsMaximized(maximized);
  };

  const handleClose = async () => {
    // Rust's CloseRequested handler owns the decision - dock to the tray, or
    // exit - and on the exit path it tears the window down before this invoke
    // can resolve, so the promise rejects. Falling back to a real quit keeps a
    // rejection from leaving the user with a close button that does nothing.
    try {
      await appWindow.close();
    } catch (err) {
      logger.warn('Window close did not resolve, quitting outright', { error: String(err) });
      await quitLauncher();
    }
  };

  return (
    <>
      <button
        onClick={handleMinimize}
        className="window-control"
        aria-label={t('windowControls.minimize')}
      >
        <Minus className="w-4 h-4" />
      </button>
      <button
        onClick={handleMaximize}
        className="window-control"
        aria-label={isMaximized ? t('windowControls.restore') : t('windowControls.maximize')}
      >
        {isMaximized ? <Copy className="w-4 h-4" /> : <Square className="w-4 h-4" />}
      </button>
      <button
        onClick={handleClose}
        className="window-control window-control-close"
        aria-label={t('windowControls.close')}
      >
        <X className="w-4 h-4" />
      </button>
    </>
  );
}
