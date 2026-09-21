import { requireActionEffectRule } from './rules/require-action-effect';
import { requireStateAnnotationRule } from './rules/require-state-annotation';

/**
 * `meta`, `rules` and `configs` are exported BOTH as named exports and on the
 * default export, and that is load-bearing rather than belt-and-braces.
 *
 * The build emits CJS (see `tsup.config.ts` — the bundled
 * `@typescript-eslint/utils` calls `require('eslint')`, which an ESM bundle
 * breaks). A consumer's flat config is ESM, so `import plugin from
 * '@qontinui/ui-bridge-eslint-plugin'` gets Node's CJS interop: the whole
 * `module.exports` namespace, NOT the value of `export default`. Before this
 * was fixed the namespace carried only `{ default, requireStateAnnotationRule }`
 * — no `rules` key — so `plugins: { 'ui-bridge': plugin }` registered a plugin
 * with no rules, and every `ui-bridge/*` rule name was unresolvable. That went
 * unnoticed because the only consumer had its single rule set to `"off"`, and
 * ESLint does not resolve a rule it is not going to run. Wiring a rule at
 * `"error"` is what surfaced it: `Could not find "require-action-effect" in
 * plugin "@qontinui/ui-bridge"`.
 *
 * Exporting the plugin's own fields at the top level makes the namespace object
 * a valid ESLint plugin in its own right, so `import plugin from …`,
 * `import plugin from ….default` and `require(…)` all work.
 */
export const meta = {
  name: '@qontinui/ui-bridge-eslint-plugin',
  version: '0.2.0',
} as const;

export const rules = {
  'require-state-annotation': requireStateAnnotationRule,
  'require-action-effect': requireActionEffectRule,
} as const;

export const configs = {
  recommended: {
    plugins: ['ui-bridge'],
    rules: {
      'ui-bridge/require-state-annotation': 'warn',
      // `error`, not `warn`: an unannotated component action is UNCLASSIFIED to
      // every autonomous caller, and a ratchet shipped at a severity CI ignores
      // is not a ratchet [policy: `capability-ships-enabled`].
      'ui-bridge/require-action-effect': 'error',
    },
  },
} as const;

const plugin = { meta, rules, configs } as const;

export { requireStateAnnotationRule, requireActionEffectRule };
export default plugin;
