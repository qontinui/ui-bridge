import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: ['cjs', 'esm'],
  // DTS generation is handled by `tsc -p tsconfig.build.json` in the build
  // script; tsup's worker pool can't resolve the monorepo's root tsconfig
  // which still has a deprecated baseUrl flag.
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['playwright'],
  treeshake: true,
  // Preserve the `#!/usr/bin/env node` shebang from src/cli.ts.
  shims: false,
});
