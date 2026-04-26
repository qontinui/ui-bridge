import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Playwright cold-starts (first Chromium launch on a fresh profile) can
    // run 10-30s; give the smoke generous headroom.
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
