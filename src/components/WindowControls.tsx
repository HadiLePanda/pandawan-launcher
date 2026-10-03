import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Square, X, Copy } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useLauncherStore } from '@/lib/store';

export function WindowControls() {
  const { t } = useTranslation();
  const appWindow = getCurrentWindow();
  const [isMaximized, setIsMaximized] = useState(false);
  const minimizeToTray = useLauncherStore((s) => s.settings?.minimizeToTray ?? true);

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
  }, [appWindow]);

  const handleMinimize = async () => {
    // Docking to the tray is a hide, not a minimize: a minimized frameless
    // window still has no taskbar entry here, so the tray is the only way back.
    if (minimizeToTray) {
      await appWindow.hide();
    } else {
      await appWindow.minimize();
    }
  };

  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
    const maximized = await appWindow.isMaximized();
    setIsMaximized(maximized);
  };

  const handleClose = async () => {
    await appWindow.close();
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
