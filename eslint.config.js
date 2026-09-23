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
  // matching object's value REPLACES earlier ones. So the guard families below
  // (SVG `.className` safety, §4.6 redaction, interaction predicate) must be composed into
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
        selector: 'MemberExpression[property.name=/^__react(Props|Fiber)\\$/]',
        message:
          '§4.6: reading a React fiber key (__reactProps$/__reactFiber$) can expose a controlled-input cleartext value. Route through extractReactState (gated via scrubReactProps in core/redaction.ts).',
      },
    ];

    // ---- Interaction-predicate guard (plan 2026-08-23-single-source-derived-facts, 12a)
    // "Is this element enabled / clickable?" has ONE answer in this package:
    // `core/a11y`'s `readDisabledSignals` (native `disabled` + `aria-disabled`)
    // and `readInteractionBlockers` (those two plus effective computed
    // `pointer-events: none`), folded by `isInteractionBlocked`. Every
    // `ElementState.enabled` producer, the click-path pre-check and
    // `UIQuery.enabled()` read those helpers, so the reader and the actor
    // cannot disagree about the same element. A hand-inlined copy of one of the
    // three inputs is how that disagreement came back last time (UIQuery kept
    // the pre-#166 `disabled || aria-disabled` predicate). Of the modules
    // exempt below, core/a11y.ts is the one that owns these reads (the other
    // two, core/class-name.ts and core/redaction.ts, are exempt for the
    // className/redaction families and read none of these inputs). The fix for
    // a flagged read is to call the helper — never an eslint-disable.
    //
    // KNOWN GAPS — shapes these selectors cannot see without type information,
    // left to review (each is a raw read of an interaction-predicate input):
    //   - a native `.disabled` read off an already-TYPED binding (`b.disabled`
    //     where `b: HTMLButtonElement`): syntactically identical to a form
    //     projection's legitimate `input.disabled`, so only a typed rule could
    //     tell a predicate from a projection.
    //   - `.pointerEvents` off a STORED computed style
    //     (`const st = getComputedStyle(el); st.pointerEvents`): the selector is
    //     rooted at the call, and a stored style object looks like the
    //     serializers' legitimate `computedStyles` projections.
    //   - `el.matches(':disabled')` / `querySelector(':disabled')` and
    //     `[aria-disabled]` CSS selectors: the signal is inside a string.
    //   - `.ariaDisabled` read off a variable whose name is in the struct
    //     allowlist below (a DOM element bound to e.g. `s`) — the allowlist is
    //     what keeps reads of the helper's own returned struct legal.
    const INTERACTION_PREDICATE_MESSAGE_TAIL =
      ' Read it via core/a11y — readDisabledSignals(el) for the DOM disabled signals, readInteractionBlockers(el) for the full blocking surface — and fold with isInteractionBlocked, so every reader agrees with the click path.';
    const INTERACTION_PREDICATE_SELECTORS = [
      {
        // The native-disabled probe shape: `'disabled' in el && el.disabled`
        // or `'disabled' in el ? el.disabled : false`.
        selector: "BinaryExpression[operator='in'][left.value='disabled']",
        message:
          "Interaction predicate: a raw `'disabled' in el` native-disabled probe re-implements readDisabledSignals." +
          INTERACTION_PREDICATE_MESSAGE_TAIL,
      },
      {
        // The cast-then-read shapes: `(el as HTMLButtonElement).disabled`,
        // `(<HTMLButtonElement>el).disabled`, and the non-null-cast
        // `(el as HTMLButtonElement)!.disabled`. Assignments
        // (`(el as HTMLButtonElement).disabled = true`) are writes, not
        // predicate reads, and stay allowed. Reads off an already-typed form
        // control (`input.disabled` in a form projection) are not flagged —
        // see KNOWN GAPS above.
        selector:
          "MemberExpression[computed=false][property.name='disabled'][object.type=/^(TSAsExpression|TSTypeAssertion)$/]:not(AssignmentExpression > .left), MemberExpression[computed=false][property.name='disabled'][object.type='TSNonNullExpression'][object.expression.type=/^(TSAsExpression|TSTypeAssertion)$/]:not(AssignmentExpression > .left)",
        message:
          'Interaction predicate: casting an element to read its native `.disabled` re-implements readDisabledSignals.' +
          INTERACTION_PREDICATE_MESSAGE_TAIL,
      },
      {
        // The ARIA reflection IDL property `el.ariaDisabled` — the same signal
        // as the attribute. Reads of the helper's returned struct and of
        // ElementState carriers (`disabledSignals.ariaDisabled`,
        // `blockers.ariaDisabled`, `state.ariaDisabled`, `x.state.ariaDisabled`,
        // …) are allowlisted by object name; everything else is flagged.
        selector:
          "MemberExpression[computed=false][property.name='ariaDisabled']:not(AssignmentExpression > .left):not([object.name=/^(disabledSignals|signals|sig|blockers|s|state)$/]):not([object.property.name='state'])",
        message:
          'Interaction predicate: reading the ariaDisabled IDL property off an element re-implements readDisabledSignals.' +
          INTERACTION_PREDICATE_MESSAGE_TAIL,
      },
      {
        selector:
          "CallExpression[callee.property.name=/^(getAttribute|hasAttribute)$/][arguments.0.value='aria-disabled']",
        message:
          'Interaction predicate: a raw aria-disabled attribute read re-implements readDisabledSignals.' +
          INTERACTION_PREDICATE_MESSAGE_TAIL,
      },
      {
        // `.pointerEvents` read straight off a `getComputedStyle(...)` /
        // `window.getComputedStyle(...)` call. Rooted at the CALL on purpose:
        // `blockers.pointerEvents` / `signals.pointerEvents` off the struct the
        // helper returns, and a serializer projecting an already-read style
        // object into `computedStyles`, are legitimate and must not fire.
        selector:
          "MemberExpression[property.name='pointerEvents'][object.type='CallExpression'][object.callee.name='getComputedStyle'], MemberExpression[property.name='pointerEvents'][object.type='CallExpression'][object.callee.property.name='getComputedStyle']",
        message:
          'Interaction predicate: reading pointer-events straight off getComputedStyle() re-implements readInteractionBlockers (use its pointerEventsNone).' +
          INTERACTION_PREDICATE_MESSAGE_TAIL,
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
    const NESTED_CARRIER = '[object.property.name=/^(state|params)$/]';
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
        // redaction-surface:package-guard-exemptions:start
        // Every entry here is EXEMPT from all §4.6 Layer-1 rules and from the
        // interaction-predicate guard (of these, core/a11y.ts is the one that
        // owns the interaction-predicate reads), so this list
        // is itself redaction surface: enrolling a file beside the sanctioned
        // readers would silently open a raw-read channel. Mirrored into
        // packages/ui-bridge/redaction-surface.manifest.json and drift-checked
        // by scripts/check-redaction-surface.cjs — after editing, run
        // `npm run redaction:surface:update`.
        ignores: [
          'packages/ui-bridge/src/**/__tests__/**',
          'packages/ui-bridge/src/**/*.test.ts',
          'packages/ui-bridge/src/**/*.test.tsx',
          // The two sanctioned raw-content readers — the choke point.
          'packages/ui-bridge/src/core/class-name.ts',
          'packages/ui-bridge/src/core/redaction.ts',
          'packages/ui-bridge/src/core/a11y.ts',
        ],
        // redaction-surface:package-guard-exemptions:end
        rules: {
          'no-restricted-syntax': [
            'error',
            ...CLASSNAME_SELECTORS,
            ...REDACTION_L1_SELECTORS,
            ...INTERACTION_PREDICATE_SELECTORS,
          ],
        },
      },
      // Projection modules: same package-wide selectors PLUS the Layer-2
      // raw-`.value`/`.textContent`-read ban. This block matches AFTER the block
      // above for these files, so it must re-declare the package-wide selectors
      // (flat config replaces, does not merge — see NOTE above).
      {
        // redaction-surface:projection-modules:start
        // The §4.6 Layer-2 projection surface. This list is mirrored into
        // packages/ui-bridge/redaction-surface.manifest.json and cross-checked by
        // scripts/check-redaction-surface.cjs (the Layer-3 ratchet). Keep the two
        // in sync: after editing this list run `npm run redaction:surface:update`.
        files: [
          'packages/ui-bridge/src/server/handlers.ts',
          'packages/ui-bridge/src/server/dom-fallback.ts',
          'packages/ui-bridge/src/server/page-primitives.ts',
          'packages/ui-bridge/src/react/commandHandlers.ts',
          'packages/ui-bridge/src/render-log/dom-capture.ts',
          'packages/ui-bridge/src/recording/**/*.ts',
          'packages/ui-bridge/src/ai/search-engine.ts',
          'packages/ui-bridge/src/ai/semantic-snapshot.ts',
          'packages/ui-bridge/src/control/action-executor.ts',
        ],
        // redaction-surface:projection-modules:end
        // redaction-surface:projection-module-ignores:start
        // An entry here exempts a projection module from the Layer-2 raw-read
        // ban while the `files` list above still matches the manifest — a
        // silent guard-disable. Only test globs belong here. Mirrored into the
        // manifest and drift-checked by scripts/check-redaction-surface.cjs.
        ignores: [
          'packages/ui-bridge/src/**/__tests__/**',
          'packages/ui-bridge/src/**/*.test.ts',
          'packages/ui-bridge/src/**/*.test.tsx',
        ],
        // redaction-surface:projection-module-ignores:end
        rules: {
          'no-restricted-syntax': [
            'error',
            ...CLASSNAME_SELECTORS,
            ...REDACTION_L1_SELECTORS,
            ...INTERACTION_PREDICATE_SELECTORS,
            ...REDACTION_L2_SELECTORS,
          ],
        },
      },
    ];
  })()
);
