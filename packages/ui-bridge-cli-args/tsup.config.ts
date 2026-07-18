import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['cjs', 'esm'],
  // DTS generation is handled by `tsc -p tsconfig.build.json` in the build
  // script — matches the sibling package convention (headless/wrapper) and keeps
  // tsup away from the monorepo root tsconfig's deprecated options.
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
