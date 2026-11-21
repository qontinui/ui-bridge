import { defineConfig } from 'vitest/config';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('./package.json') as { version: string };

export default defineConfig({
  // Mirror the tsup build-time constant so files that reference
  // `__SDK_VERSION__` (e.g. UIBridgeProviderInit) compile cleanly under
  // vitest. Source-of-truth is `package.json`'s `version` field.
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // The suite is ~390 files under jsdom, and many tests dynamically import
    // the provider/handler tree on first use. On a loaded CI runner that cold
    // import alone has taken 5-10 s, so vitest's 5 s test / 10 s hook defaults
    // failed main on timing, not behavior (e.g. 8 timeouts across 7 files on
    // bccd14d1 while the same commit was green on its merge candidate). A
    // generous ceiling keeps a genuinely hung test bounded.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', '.worktrees', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/index.ts'],
    },
  },
});
