import { buildIfStale } from '../../test-support/build-if-stale.mjs';

/**
 * Runs once, in vitest's main process, before any test worker starts: builds
 * this package when its dist is missing or stale (test-support/build-if-stale.mjs;
 * the templates under src/ count as inputs, and the build copies them into
 * dist/templates). Test files never build; they only read dist. Watch mode does
 * not re-run a globalSetup, so after a source edit under `vitest` (watch)
 * restart it or run `npm run build`.
 */
export default async function setup(): Promise<void> {
  await buildIfStale([
    {
      dir: 'packages/create-ui-bridge-wrapper',
      outputs: ['dist/cli.js', 'dist/cli.d.ts', 'dist/templates/transport-api.ts.tpl'],
    },
  ]);
}
