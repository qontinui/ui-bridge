import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      'eslint.config.js',
    ],
  },

  // Base recommended configs
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React flat configs
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  // Custom configuration
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: '19',
      },
    },
    rules: {
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // React Hooks rules (classic only, not React Compiler rules)
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // React rules
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      // General rules
      'no-console': 'off',
      'no-unused-vars': 'off', // Use TypeScript's version
    },
  },

  // SVG-safety guard for the UI Bridge SDK sources.
  //
  // `Element.className` is `SVGAnimatedString` on SVG/MathML, not `string`.
  // Calling `.split`, `.toLowerCase`, `.trim`, etc. directly throws on SVG
  // (regression bug: "ee.className.split is not a function" in get_snapshot).
  // Use `classString(el)` / `classList(el)` from `src/core/class-name.ts`.
  //
  // Scoped to packages/ui-bridge/src so tests and fixtures keep their
  // existing `el.className = '…'` assignments (which are safe via the
  // native DOM API) without friction. Test files inside src/**/__tests__
  // are excluded explicitly because they construct HTMLElement literals.
  {
    files: ['packages/ui-bridge/src/**/*.ts', 'packages/ui-bridge/src/**/*.tsx'],
    ignores: [
      'packages/ui-bridge/src/**/__tests__/**',
      'packages/ui-bridge/src/**/*.test.ts',
      'packages/ui-bridge/src/**/*.test.tsx',
      'packages/ui-bridge/src/core/class-name.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Flags raw `.className.<op>()` reads on any object, e.g.
          //   el.className.split(' ')
          //   el.className.toLowerCase()
          // Does NOT flag `.className = ...` assignment, `typeof x.className`,
          // or `x.className || fallback`.
          selector:
            "CallExpression > MemberExpression[property.name=/^(split|toLowerCase|toUpperCase|trim|indexOf|includes|replace|replaceAll|match|startsWith|endsWith|substring|slice|charAt)$/] > MemberExpression[property.name='className']",
          message:
            'Use classString(el) or classList(el) from core/class-name instead of raw .className string ops — SVG/MathML elements have SVGAnimatedString className, not string, and will throw.',
        },
        {
          // Same, but through optional chain: `el.className?.toLowerCase()`.
          // Still unsafe on SVG because SVGAnimatedString is truthy.
          selector:
            "CallExpression > MemberExpression[property.name=/^(split|toLowerCase|toUpperCase|trim|indexOf|includes|replace|replaceAll|match|startsWith|endsWith|substring|slice|charAt)$/] > MemberExpression[property.name='className'][optional=true]",
          message:
            'Use classString(el) or classList(el) from core/class-name instead of raw .className?.<stringOp>() — SVGAnimatedString is truthy, so optional chaining does NOT protect you.',
        },
      ],
    },
  }
);
