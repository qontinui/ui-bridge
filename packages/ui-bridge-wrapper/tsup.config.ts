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
    // CLI binaries. CJS-only with a shebang banner so they run as executables;
    // DTS not needed for a bin. Does NOT set `clean` — only the main config
    // cleans, and it runs first. All three bins resolve the engine bundle from
    // the wrapper package's own module tree (injected transport's
    // createRequire(import.meta.url)), so they run from any CWD once installed.
    entry: {
      'inject-cli': 'src/inject-cli.ts',
      'login-web-cli': 'src/login-web-cli.ts',
      'capture-specs-cli': 'src/capture-specs-cli.ts',
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
