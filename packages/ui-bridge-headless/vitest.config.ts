import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every test in this package lives under src/ (the include vitest found
    // before this config existed).
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Builds cli-args and this package once, before any worker starts.
    globalSetup: ['./vitest.global-setup.ts'],
  },
});
