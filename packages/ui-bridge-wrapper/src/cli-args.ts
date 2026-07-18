/**
 * Shared CLI argument primitives for the wrapper bins (`ui-bridge-login-web`,
 * `ui-bridge-capture-specs`, `ui-bridge-inject`).
 *
 * The primitives themselves now live in the zero-dependency leaf package
 * `@qontinui/ui-bridge-cli-args`, so the sibling `@qontinui/ui-bridge-headless`
 * bin (`ui-bridge-tab`) can import the same swallow guard without a dependency
 * cycle (the wrapper AND the engine both depend *down* onto headless, so neither
 * could host code headless imports). This file stays as a stable re-export so the
 * three bins' `import … from './cli-args.js'` keep working — no bin churn.
 */
export * from '@qontinui/ui-bridge-cli-args';
