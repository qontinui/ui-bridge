import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  // DTS disabled due to complex Babel types - types are provided via separate .d.ts file
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: ['@babel/core', '@babel/types', '@babel/helper-plugin-utils'],
});
