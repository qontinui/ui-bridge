import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'src/templates'],
    // cli-smoke spawns the built CLI and runs it against a tmpdir — that
    // can take a few seconds on Windows for the first run.
    testTimeout: 60_000,
  },
});
