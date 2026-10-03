/// <reference types="vite/client" />

/**
 * Ambient types for the dashboard app.
 *
 * `vite/client` is what declares `*.css` (and the other static-asset imports)
 * as modules, so `import './styles.css'` type-checks. Without this file, that
 * side-effect import is an error under `noUncheckedSideEffectImports`-style
 * checking - which TypeScript 7 enables by default, so the app started failing
 * to compile on the upgrade even though nothing about the import had changed.
 *
 * This mirrors src/vite-env.d.ts in the launcher, which serves the same purpose
 * for that app. Keep the two in step: both are Vite frontends, and a CSS import
 * that type-checks in one should type-check in the other.
 */
