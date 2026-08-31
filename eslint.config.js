import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

const boundary = (forbidden, message) => ({
  'no-restricted-imports': [
    'error',
    {
      paths: forbidden.map((name) => ({ name, message })),
    },
  ],
});

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/node_modules/**',
      'demo/**',
      'data/**',
      'graphify-out/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'apps/desktop/out/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        // Type-aware linting. Without it `no-floating-promises` cannot run, and an
        // un-awaited `fail()` in the login path silently accepted every wrong password
        // and crashed the process on the unhandled rejection.
        projectService: {
          // Build/test config files live outside the app tsconfigs; lint them without types.
          allowDefaultProject: ['*.config.ts', '*.workspace.ts', 'server.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Build and test config files sit outside the app tsconfigs. Lint them for syntax,
    // but without type information — they contain no promise-handling logic.
    files: ['**/*.config.ts', 'vitest.workspace.ts'],
    languageOptions: { parserOptions: { projectService: false, project: null } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
    },
  },
  {
    files: ['packages/domain/**/*.ts'],
    rules: boundary(
      [
        '@sns/database',
        '@sns/auth',
        '@sns/server',
        '@sns/web',
        '@sns/desktop',
        '@sns/ui',
        '@sns/config',
        '@sns/contracts',
      ],
      'domain imports nothing else in the repo',
    ),
  },
  {
    files: ['packages/database/**/*.ts'],
    rules: boundary(
      ['@sns/auth', '@sns/server', '@sns/web', '@sns/desktop', '@sns/ui', '@sns/config'],
      'database imports domain and contracts only',
    ),
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      ...boundary(
        ['@sns/domain', '@sns/database', '@sns/auth', '@sns/server', '@sns/desktop', '@sns/config'],
        'web imports contracts and ui only',
      ),
    },
  },
  {
    files: ['apps/desktop/**/*.ts'],
    rules: boundary(
      [
        '@sns/domain',
        '@sns/database',
        '@sns/auth',
        '@sns/server',
        '@sns/web',
        '@sns/ui',
        '@sns/contracts',
      ],
      'desktop imports config only and never the database layer',
    ),
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
