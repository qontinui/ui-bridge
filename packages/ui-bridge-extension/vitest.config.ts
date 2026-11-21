import { defineConfig } from 'vitest/config';

// `@qontinui/ui-bridge-wrapper` resolves to the wrapper's built dist/, as it
// does in the extension bundle: CI runs `npm run build` before `npm run test`.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
