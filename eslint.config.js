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
    files: ['scripts/dashboard/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        fetch: 'readonly',
        TextDecoder: 'readonly',
        Event: 'readonly',
      },
    },
  }
);
