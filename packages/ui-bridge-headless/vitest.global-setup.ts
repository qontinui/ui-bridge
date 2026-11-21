import { CLI_ARGS, buildIfStale } from '../../test-support/build-if-stale.mjs';

/**
 * Runs once, in vitest's main process, before any test worker starts: builds
 * cli-args (which tsup inlines here) and then this package when either dist is
 * missing or stale. Test files never build; they only read dist.
 */
export default function setup(): void {
  buildIfStale([
    CLI_ARGS,
    {
      dir: 'packages/ui-bridge-headless',
      outputs: [
        'dist/cli.js',
        'dist/cli.cjs',
        'dist/cli.d.ts',
        'dist/index.js',
        'dist/index.cjs',
        'dist/index.d.ts',
      ],
      inlines: [CLI_ARGS.dir],
    },
  ]);
}
