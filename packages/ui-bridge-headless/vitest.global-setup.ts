import { CLI_ARGS, HEADLESS, buildIfStale } from '../../test-support/build-if-stale.mjs';

/**
 * Runs once, in vitest's main process, before any test worker starts: builds
 * cli-args (which tsup inlines here) and then this package when either dist is
 * missing or stale (test-support/build-if-stale.mjs). Test files never build;
 * they only read dist. Watch mode does not re-run a globalSetup, so after a
 * source edit under `vitest` (watch) restart it or run `npm run build`.
 */
export default async function setup(): Promise<void> {
  await buildIfStale([CLI_ARGS, HEADLESS]);
}
