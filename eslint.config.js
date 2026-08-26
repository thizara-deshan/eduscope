import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import {
  bannedGlobals, bannedImports, bannedProperties, boundaryExempt, boundaryFiles,
} from './tools/eslint-rules/no-direct-network.js';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**', '**/build/**', '**/.next/**', '**/node_modules/**',
      '**/coverage/**', '**/playwright-report/**', '**/test-results/**',
      'packages/shared/src/schemas/generated/**', // codegen output
      'prototype/**', 'legacy-Codebase/**',
      // Agent tooling and worktree checkouts. All are gitignored, but ESLint
      // flat config does NOT read .gitignore, so `eslint .` walks into them —
      // and a worktree under .claude/ carries its own full copy of prototype/
      // and legacy-Codebase/, which is how a clean tree lints 1142 errors.
      '.claude/**', '.agents/**', 'agent/**', 'revamp-guide/**',
      // Python virtualenvs for the pipeline-manager (A) and AI (C) services.
      // Gitignored and never present in CI, but a local checkout carries them
      // and flat config walks into their vendored .js (e.g. urllib3's
      // emscripten worker), which is not our code to lint.
      '**/.venv/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts (.mjs/.cjs/.js) as well as app/service source get both
    // global sets; without .mjs here the campus/quiz gate scripts report
    // `process`/`URL` as undefined.
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // `_`-prefixed names are the repo-wide "intentionally unused" signal —
      // interface-mandated params (`_reply`, `_actor`, `_reason`) and
      // destructure-to-omit idioms (`const { seq: _seq, ...rest } = ...`).
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: ['apps/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The scaffold's central risk is re-render discipline (Task 15).
      'react-hooks/exhaustive-deps': 'error',
      // frontend-conventions §3: aria-label on every icon-only control. The
      // panel is a touch kiosk with no keyboard and no screen reader to fall
      // back on, so this is enforced from before the first screen exists.
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-has-content': 'error',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-role': 'error',
      'jsx-a11y/control-has-associated-label': 'error',
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/no-autofocus': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
    },
  },
  // ── the client boundary ───────────────────────────────────────────────────
  {
    files: boundaryFiles,
    ignores: boundaryExempt,
    rules: {
      'no-restricted-globals': ['error', ...bannedGlobals],
      'no-restricted-imports': ['error', { paths: bannedImports }],
      'no-restricted-properties': ['error', ...bannedProperties],
    },
  },
);
