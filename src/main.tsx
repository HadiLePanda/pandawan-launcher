import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './lib/i18n';
import './index.css';

// Dev-only tooling: fake launcher-updater states and a fake game download, so
// every update and install state can be inspected without a real 442 MB install.
// Both dynamic imports sit inside `import.meta.env.DEV` branches, so a release
// build statically drops them and never emits the chunks. That matters beyond
// tidiness: a shipping build that could fake an update state or a download is a
// security smell, so neither forcer must be reachable - let alone present - in
// production.
if (import.meta.env.DEV) {
  void import('./lib/dev-updater-forcer').then((m) => m.installDevUpdaterForcer());
  void import('./lib/dev-download-simulator').then((m) => m.installDevDownloadSimulator());
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
