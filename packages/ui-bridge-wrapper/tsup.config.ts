import { defineConfig } from 'tsup';

export default defineConfig({
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
  external: [
    'react',
    'react-dom',
    'playwright',
    '@qontinui/ui-bridge',
    '@qontinui/ui-bridge-headless',
    'ws',
  ],
});
