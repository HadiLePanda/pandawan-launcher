import { getCurrentWindow } from '@tauri-apps/api/window';

export async function windowTitlebarToggleMaximize() {
  const appWindow = getCurrentWindow();
  await appWindow.toggleMaximize();
}
