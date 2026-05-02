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
  // Only `eslint` itself stays external — consumers provide it via peer dep.
  // @typescript-eslint/utils is bundled in so the plugin is self-contained
  // when consumers use file:/link: protocol. Without bundling, transitive
  // deps don't resolve through symlinked file: paths in CI environments
  // that only check out one repo at a time.
  // tsup defaults all package.json `dependencies` to external; `noExternal`
  // explicitly forces them into the bundle.
  external: ['eslint'],
  noExternal: ['@typescript-eslint/utils'],
  treeshake: true,
  shims: false,
});
