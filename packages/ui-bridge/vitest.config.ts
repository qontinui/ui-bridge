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
