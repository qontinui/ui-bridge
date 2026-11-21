import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Builds cli-args, headless, ui-bridge and this package once, before any worker starts.
    globalSetup: ['./vitest.global-setup.ts'],
  },
});
