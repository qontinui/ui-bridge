import { defineConfig } from 'vitest/config';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('./package.json') as { version: string };

export default defineConfig({
  // Mirror tsup's build-time `__SDK_VERSION__` injection so the health
  // handler resolves the same package.json version under test as in a
  // real bundle. See src/server/handlers.ts.
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
