import { defineConfig } from 'tsup';

const EXTERNAL = [
  'react',
  'react-dom',
  'playwright',
  '@qontinui/ui-bridge',
  '@qontinui/ui-bridge-headless',
  'ws',
];

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'react/index': 'src/react/index.ts',
    },
    format: ['cjs', 'esm'],
    // DTS generation is handled by `tsc -p tsconfig.build.json` in the build
    // script — matches the ui-bridge-headless package convention and keeps
    // tsup away from transitive tsconfigs that still use deprecated options.
    dts: false,
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    outExtension({ format }) {
      return { js: format === 'cjs' ? '.cjs' : '.js' };
    },
    external: EXTERNAL,
  },
  {
    // `ui-bridge-inject` CLI binary. CJS-only with a shebang banner so it runs
    // as an executable; DTS not needed for a bin. Does NOT set `clean` — only
    // the main config cleans, and it runs first.
    entry: {
      'inject-cli': 'src/inject-cli.ts',
    },
    format: ['cjs'],
    dts: false,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    banner: { js: '#!/usr/bin/env node' },
    outExtension({ format }) {
      return { js: format === 'cjs' ? '.cjs' : '.js' };
    },
    external: EXTERNAL,
  },
]);
