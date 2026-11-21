import { buildIfStale } from '../../test-support/build-if-stale.mjs';

/**
 * Runs once, in vitest's main process, before any test worker starts: builds
 * this package when its dist is missing or stale (test-support/build-if-stale.mjs).
 * The templates under src/ and scripts/copy-templates.mjs count as inputs, so
 * editing either rebuilds, which copies the templates into dist/templates. Test
 * files never build; they only read dist. Watch mode does not re-run a
 * globalSetup, so after a source edit under `vitest` (watch) restart it or run
 * `npm run build`.
 */
export default async function setup(): Promise<void> {
  await buildIfStale([
    {
      dir: 'packages/create-ui-bridge-wrapper',
      // dist/templates is left out of the outputs on every platform. Measured on
      // Windows (Node 24): the build's fs.cp kept each copied template's source
      // mtime, so a copy was never newer than its source and the package read
      // stale straight after a successful build. Other platforms were not
      // measured; the templates stay build inputs either way.
      outputs: ['dist/cli.js', 'dist/cli.d.ts'],
      extraInputs: ['scripts/copy-templates.mjs'],
    },
  ]);
}
