import { WindowControls } from './WindowControls';

export function TitleBar() {
  return (
    <header className="h-7 flex items-center justify-end drag-region z-50 relative">
      <div className="flex items-center no-drag pr-2">
        <WindowControls />
      </div>
    </header>
  );
}
