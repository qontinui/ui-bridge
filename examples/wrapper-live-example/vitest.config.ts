import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Smoke test spawns a real runner over the supervisor — give it room.
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
