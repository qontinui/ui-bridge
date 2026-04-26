import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The api transport has no browser cold-start or WS handshake; default
    // 5s timeouts are plenty. We match the sibling examples' shape but use
    // a tighter budget to keep the smoke fast.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
