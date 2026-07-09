import { WindowControls } from './WindowControls';

export function TitleBar() {
  return (
    <header className="titlebar drag-region">
      <div className="window-controls no-drag">
        <WindowControls />
      </div>
    </header>
  );
}
