import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

// The package is ESM ("type": "module"), so the manifest is read, not required.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'density-cli': 'src/density-cli.ts',
  },
  // The version `ui-bridge-density` reports as its producer version (plan D-E):
  // the package that ran the density core, never the SDK's.
  define: {
    __HEADLESS_VERSION__: JSON.stringify(pkg.version),
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
