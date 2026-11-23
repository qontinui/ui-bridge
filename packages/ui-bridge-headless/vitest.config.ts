import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

// The package is ESM ("type": "module"), so the manifest is read, not required.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  // Mirror tsup's build-time constant so src/density-cli.ts compiles under vitest.
  define: {
    __HEADLESS_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    // Every test in this package lives under src/ (the include vitest found
    // before this config existed).
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Builds cli-args and this package once, before any worker starts.
    globalSetup: ['./vitest.global-setup.ts'],
  },
});
