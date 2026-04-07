import { Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function WindowControls() {
  const appWindow = getCurrentWindow();

  const handleMinimize = async () => {
    await appWindow.minimize();
  };

  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
  };

  const handleClose = async () => {
    await appWindow.close();
  };

  return (
    <div className="flex items-center gap-2 no-drag">
      <button
        onClick={handleMinimize}
        className="p-2 rounded-md text-ink-muted hover:text-ink hover:bg-surface-light transition-colors"
        aria-label="Minimize"
      >
        <Minus className="w-4 h-4" />
      </button>
      <button
        onClick={handleMaximize}
        className="p-2 rounded-md text-ink-muted hover:text-ink hover:bg-surface-light transition-colors"
        aria-label="Maximize"
      >
        <Square className="w-4 h-4" />
      </button>
      <button
        onClick={handleClose}
        className="p-2 rounded-md text-ink-muted hover:text-white hover:bg-status-error transition-colors"
        aria-label="Close"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
