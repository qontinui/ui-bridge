import { readFileSync } from 'node:fs';
import { CLI_ARGS, buildIfStale } from '../../test-support/build-if-stale.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  bin: Record<string, string>;
};

/**
 * Runs once, in vitest's main process, before any test worker starts: builds
 * cli-args (which tsup inlines here) and then this package when either dist is
 * missing or stale (test-support/build-if-stale.mjs). Test files never build;
 * they only read dist. The bin roster comes from package.json, so a new bin is
 * required automatically. Watch mode does not re-run a globalSetup, so after a
 * source edit under `vitest` (watch) restart it or run `npm run build`.
 */
export default async function setup(): Promise<void> {
  await buildIfStale([
    CLI_ARGS,
    {
      dir: 'packages/ui-bridge-wrapper',
      outputs: [
        ...Object.values(pkg.bin).map((rel) => rel.replace(/^\.\//, '')),
        'dist/index.js',
        'dist/index.cjs',
        'dist/index.d.ts',
        'dist/react/index.js',
        'dist/react/index.cjs',
        'dist/react/index.d.ts',
      ],
      inlines: [CLI_ARGS.dir],
    },
  ]);
}
