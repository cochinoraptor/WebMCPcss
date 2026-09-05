/**
 * Configuración de ESLint (flat config, ESLint 9) para WebMCPcss.
 * TypeScript estricto + integración con Prettier. Sustituye a .eslintrc.js.
 */
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const prettier = require('eslint-config-prettier');
const globals = require('globals');

module.exports = tseslint.config(
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'site/', '**/*.js', '**/*.cjs', '**/*.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser, ...globals.es2021 },
    },
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Reglas nuevas de typescript-eslint 8 que no aportan en este código base
      // (CommonJS + require() dinámico deliberado, `let` en helpers de tests…).
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-console': 'off',
    },
  },
);
