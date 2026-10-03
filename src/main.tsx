import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './lib/i18n';
import './index.css';

// Dev-only launcher-updater state forcer. The dynamic import sits inside an
// `import.meta.env.DEV` branch, so a release build statically drops the branch
// and never emits the chunk. That matters beyond tidiness: a shipping build
// that could fake an update state is a security smell, so the forcer must not
// be reachable - let alone present - in production.
if (import.meta.env.DEV) {
  void import('./lib/dev-updater-forcer').then((m) => m.installDevUpdaterForcer());
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
