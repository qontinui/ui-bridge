import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintReact from '@eslint-react/eslint-plugin';
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
      // Generated artifacts — owned by scripts/gen-diagnostics.ts, not the
      // linter. ESLint --fix was stripping the generator's /* eslint-disable */
      // directive, desyncing the committed file from generator output and
      // failing the diagnostics:check drift gate. Same principle as the Rust
      // mirror's #[rustfmt::skip] (plan D-series).
      '**/diagnostics/codes.generated.ts',
    ],
  },

  // Base recommended configs
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // React flat configs
  eslintReact.configs['recommended-typescript'],
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
      // @eslint-react/exhaustive-deps is intentionally disabled — react-hooks/exhaustive-deps
      // (above) is the canonical source of truth per the plan's "Scope — out" decision. Keeping
      // both layered produces duplicate warnings on the same hook. If react-hooks ever lags
      // behind React's evolving deps semantics, revisit this.
      '@eslint-react/exhaustive-deps': 'off',

      // General rules
      'no-console': 'off',
      'no-unused-vars': 'off', // Use TypeScript's version
    },
  },

  // ==========================================================================
  // no-restricted-syntax guards for the UI Bridge SDK sources.
  //
  // NOTE ON FLAT-CONFIG SEMANTICS: ESLint flat config does NOT merge the
  // options of a rule configured in multiple matching config objects — the LAST
  // matching object's value REPLACES earlier ones. So the two guard families
  // below (SVG `.className` safety + §4.6 redaction) must be composed into
  // shared selector arrays and re-declared together in every block that a given
  // file matches, or one family would silently disable the other. That is why
  // the projection-module block repeats the package-wide selectors and appends
  // its own, rather than relying on additive layering.
  // ==========================================================================

  // ---- SVG-safety guard: `.className` string ops ----------------------------
  // `Element.className` is `SVGAnimatedString` on SVG/MathML, not `string`.
  // Calling `.split`, `.toLowerCase`, `.trim`, etc. directly throws on SVG
  // (regression bug: "ee.className.split is not a function" in get_snapshot).
  // Use `classString(el)` / `classList(el)` from `src/core/class-name.ts`.
  ...(() => {
    const CLASSNAME_SELECTORS = [
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
    ];

    // ---- §4.6 redaction guard (plan Phase 6) --------------------------------
    // Two layers, modelled on the `.className` precedent above. The whole point
    // is to change the default for a new DOM projection from "silently leak" to
    // "fail the build": a raw content read outside the two sanctioned reader
    // modules (core/redaction.ts, core/a11y.ts) is a lint error. Runtime-gating
    // each flagged read (via isValueRedacted/isContentRedacted or a reader
    // minter) is the fix — never an eslint-disable.

    // LAYER 1 — package-wide, high-signal, low-noise reads.
    const REDACTION_L1_SELECTORS = [
      {
        // Raw reads of the sensitive a11y content attributes. The ONLY
        // sanctioned raw readers are core/a11y.ts (the readXAttr wrappers) and
        // core/redaction.ts; every other module routes through them.
        selector:
          "CallExpression[callee.property.name='getAttribute'][arguments.0.value=/^(aria-label|aria-labelledby|placeholder|title|alt)$/]",
        message:
          "§4.6: raw getAttribute('aria-label'|'aria-labelledby'|'placeholder'|'title'|'alt') leaks a redaction-boundary secret. Read it via core/a11y (readAriaLabelAttr/readAriaLabelledbyAttr/readPlaceholderAttr/readTitleAttr/readAltAttr) and scrub with core/redaction (scrubContent/isContentRedacted) where it reaches a client.",
      },
      {
        // Raw `.innerText` read. Route via core/a11y readInnerText/computeVisibleText.
        selector:
          "MemberExpression[computed=false][property.name='innerText']:not(AssignmentExpression > .left):not(UnaryExpression[operator='typeof'] > .argument)",
        message:
          '§4.6: raw .innerText read leaks a redaction-boundary secret. Read it via core/a11y (readInnerText / computeVisibleText) and scrub where it reaches a client.',
      },
      {
        // Casting INTO the Scrubbed brand outside core/redaction.ts — the
        // obvious escape hatch from the brand (plan limit 1). The mint point is
        // confined to core/redaction.ts (allowlisted).
        selector: "TSAsExpression[typeAnnotation.typeName.name='Scrubbed']",
        message:
          '§4.6: casting a value INTO Scrubbed<T> outside core/redaction.ts forges the brand. Mint it through a scrub function in core/redaction.ts.',
      },
      {
        // Direct member reads of a React fiber back-ref key
        // (`el.__reactProps$xyz` / `el.__reactFiber$xyz`). For a controlled
        // password input, props.value IS the cleartext secret. (Today the SDK
        // reaches fiber via computed keys, so this is a forward regression
        // backstop — it flags nothing currently and must stay that way.)
        selector: "MemberExpression[property.name=/^__react(Props|Fiber)\\$/]",
        message:
          '§4.6: reading a React fiber key (__reactProps$/__reactFiber$) can expose a controlled-input cleartext value. Route through extractReactState (gated via scrubReactProps in core/redaction.ts).',
      },
    ];

    // LAYER 2 — projection modules only: raw `.value`/`.textContent` READS.
    // Package-wide these two property names are far too common on the SDK's own
    // domain types (ElementState.value/.textContent, Searchable.*, the redaction
    // verdict token, SelectOptions.value, IteratorResult.value) to ban outright,
    // so the ban is scoped by `files:` to the modules that build client-facing
    // payloads from raw DOM, and the SELECTOR is tuned to match genuine DOM
    // element reads while excluding: writes/typeof/update, `.value.<op>` value-
    // mutation chains, call-result objects (iterator/query chains), and reads of
    // the already-scrubbed domain carriers (state/searchable/verdict/options/…)
    // and their nested `.state.`/`.params.` forms.
    const CARRIER_NAMES =
      'state|searchable|criteria|verdict|reactVerdict|redactionVerdict|options|option|opt|spec|request|params|info|event|capturedEvent|parsed|updates|changes|acc|bv|av|existing|iter|o|sel';
    const NESTED_CARRIER = "[object.property.name=/^(state|params)$/]";
    const REDACTION_L2_SELECTORS = [
      {
        selector:
          "MemberExpression[computed=false][property.name='value']" +
          ':not(AssignmentExpression > .left)' +
          ":not(UnaryExpression[operator='typeof'] > .argument)" +
          ':not(UpdateExpression > .argument)' +
          ':not(MemberExpression > .object)' +
          ":not([object.type='CallExpression'])" +
          ':not([object.name=/^(' +
          CARRIER_NAMES +
          ')$/])' +
          ':not(' +
          NESTED_CARRIER +
          ')',
        message:
          '§4.6: raw input .value read in a projection module. Gate it — read via readScrubbedValue(el) from core/redaction, or isValueRedacted(el) ? REDACTED_VALUE : el.value — so password/boundary fields never ship cleartext.',
      },
      {
        selector:
          "MemberExpression[computed=false][property.name='textContent']" +
          ':not(AssignmentExpression > .left)' +
          ":not(UnaryExpression[operator='typeof'] > .argument)" +
          ':not([object.name=/^(' +
          CARRIER_NAMES +
          ')$/])' +
          ':not(' +
          NESTED_CARRIER +
          ')',
        message:
          '§4.6: raw .textContent read in a projection module. Gate it — read via readScrubbedText(el) from core/redaction, or isContentRedacted(el) ? REDACTED_VALUE : el.textContent — so redaction-boundary text never ships.',
      },
    ];

    return [
      // Package-wide (ui-bridge src): SVG safety + redaction Layer 1.
      {
        files: ['packages/ui-bridge/src/**/*.ts', 'packages/ui-bridge/src/**/*.tsx'],
        ignores: [
          'packages/ui-bridge/src/**/__tests__/**',
          'packages/ui-bridge/src/**/*.test.ts',
          'packages/ui-bridge/src/**/*.test.tsx',
          // The two sanctioned raw-content readers — the choke point.
          'packages/ui-bridge/src/core/class-name.ts',
          'packages/ui-bridge/src/core/redaction.ts',
          'packages/ui-bridge/src/core/a11y.ts',
        ],
        rules: {
          'no-restricted-syntax': ['error', ...CLASSNAME_SELECTORS, ...REDACTION_L1_SELECTORS],
        },
      },
      // Projection modules: same package-wide selectors PLUS the Layer-2
      // raw-`.value`/`.textContent`-read ban. This block matches AFTER the block
      // above for these files, so it must re-declare the package-wide selectors
      // (flat config replaces, does not merge — see NOTE above).
      {
        files: [
          'packages/ui-bridge/src/server/handlers.ts',
          'packages/ui-bridge/src/server/page-primitives.ts',
          'packages/ui-bridge/src/react/commandHandlers.ts',
          'packages/ui-bridge/src/render-log/dom-capture.ts',
          'packages/ui-bridge/src/recording/**/*.ts',
          'packages/ui-bridge/src/ai/search-engine.ts',
          'packages/ui-bridge/src/ai/semantic-snapshot.ts',
          'packages/ui-bridge/src/control/action-executor.ts',
        ],
        ignores: [
          'packages/ui-bridge/src/**/__tests__/**',
          'packages/ui-bridge/src/**/*.test.ts',
          'packages/ui-bridge/src/**/*.test.tsx',
        ],
        rules: {
          'no-restricted-syntax': [
            'error',
            ...CLASSNAME_SELECTORS,
            ...REDACTION_L1_SELECTORS,
            ...REDACTION_L2_SELECTORS,
          ],
        },
      },
    ];
  })()
);
