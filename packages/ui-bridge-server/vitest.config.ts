import { defineConfig } from 'vitest/config';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('./package.json') as { version: string };

export default defineConfig({
  // Mirror tsup's build-time `__SDK_VERSION__` injection (producer version).
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
