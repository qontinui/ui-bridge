import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
  },
  format: ['esm'],
  // DTS generation is handled by `tsc -p tsconfig.build.json` in the build
  // script — mirrors the ui-bridge-wrapper / ui-bridge-headless convention.
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Preserve the `#!/usr/bin/env node` shebang from src/cli.ts so the bin
  // script stays executable.
  shims: false,
  // Templates are plain text files shipped alongside `dist/cli.js`; we
  // resolve them at runtime via `new URL('../src/templates', import.meta.url)`.
  // Explicitly exclude them from the bundle graph.
  external: ['@inquirer/prompts'],
});
