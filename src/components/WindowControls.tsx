import { useState, useEffect } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';


export function WindowControls() {
  const appWindow = getCurrentWindow();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    // Check initial state
    const checkMaximized = async () => {
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
    };
    checkMaximized();

    // Listen for resize events
    const unlisten = appWindow.onResized(() => {
      checkMaximized();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [appWindow]);

  const handleMinimize = async () => {
    await appWindow.minimize();
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
    <div className="flex items-center no-drag">
      <button
        onClick={handleMinimize}
        className="p-3 text-ink-muted hover:text-ink hover:bg-surface-light transition-colors"
        aria-label="Minimize"
      >
        <Minus className="w-4 h-4" />
      </button>
      <button
        onClick={handleMaximize}
        className="p-3 text-ink-muted hover:text-ink hover:bg-surface-light transition-colors"
        aria-label={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? (
          <Copy className="w-4 h-4" />
        ) : (
          <Square className="w-4 h-4" />
        )}
      </button>
      <button
        onClick={handleClose}
        className="p-3 text-ink-muted hover:text-white hover:bg-status-error transition-colors"
        aria-label="Close"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
