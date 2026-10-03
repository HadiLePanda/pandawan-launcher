import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

/**
 * Build config for the publishing dashboard UI - a SEPARATE app from the
 * launcher frontend.
 *
 * Two Vite builds now exist:
 *   - vite.config.ts (repo root)         -> dist/                    launcher, ships to players
 *   - scripts/dashboard/app/vite.config.ts -> scripts/dashboard/app/dist/   local admin tool
 *
 * The output directory is the whole point of this file existing. The dashboard
 * holds R2 credentials and can delete bucket objects, so it must never be
 * reachable from the launcher's `frontendDist` (../dist).
 * src-tauri/tests/bundle_contents_tests.rs fails the build if anything under
 * scripts/ or any .env reaches dist/; keeping this build's outDir outside the
 * repo-root dist/ makes that guarantee structural rather than a convention
 * someone has to remember.
 *
 * The React sources live in scripts/dashboard/app/ rather than directly in
 * scripts/dashboard/ so the previous hand-written index.html / app.js /
 * style.css stay readable and servable until the cutover is done.
 */
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@lib': path.resolve(__dirname, 'src/lib'),
      '@store': path.resolve(__dirname, 'src/store'),
      '@types': path.resolve(__dirname, 'src/types'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
