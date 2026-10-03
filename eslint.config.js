import js from '@eslint/js';
import ts from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default ts.config(
  {
    ignores: [
      'dist',
      'node_modules',
      '.tmp-venv',
      'src-tauri/target',
      'src-tauri/gen',
      'scripts/**/*.cjs',
      'scripts/**/*.mjs',
      // The dashboard's built React bundle. It is generated output, minified, and
      // linted by the same `eslint .` that walks the repo - so linting it reports
      // thousands of bogus errors against vendor code (`no-undef` on `performance`,
      // `MutationObserver` and friends). The source is linted instead; this is only
      // the compiled result.
      //
      // Matched as a directory rather than a file list because the hashed asset
      // names change on every build and a file-glob ignore would go stale.
      'scripts/dashboard/app/dist',
      '.agents',
      '.claude',
      '.github/skills',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // The dashboard's client is a plain browser page served by scripts/dashboard.mjs,
    // not part of the Vite app, so it needs the browser globals the src/ tree gets
    // from typescript-eslint's DOM defaults.
    //
    // Listed explicitly rather than pulled from the `globals` package: adding a
    // dependency to fix seven no-undef errors would be the heavier change, and an
    // explicit list keeps `npm run lint` honest - a name used in this file but
    // missing here is reported rather than silently allowed.
    files: ['scripts/dashboard/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        TextDecoder: 'readonly',
        Event: 'readonly',
        // Used by the tab strip (location.hash) and the launcher-release link.
        location: 'readonly',
        history: 'readonly',
        // Polling loops: the services status poll and the refresh timer.
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        // The dev-server check that asks whether something is already running.
        navigator: 'readonly',
        // Blob URLs and image uploads for the artwork picker.
        URL: 'readonly',
        FileReader: 'readonly',
        // Query strings for the artwork listing.
        URLSearchParams: 'readonly',
      },
    },
  }
);
