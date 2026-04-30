import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['cjs', 'esm'],
  // DTS generation handled by `tsc -p tsconfig.build.json` in the build script.
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['eslint', '@typescript-eslint/utils', '@typescript-eslint/parser'],
  treeshake: true,
  shims: false,
});
