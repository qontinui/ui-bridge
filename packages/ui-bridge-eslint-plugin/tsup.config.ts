import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  // CJS-only. The bundled @typescript-eslint/utils internally calls
  // `require('eslint')` (which stays external as a peer dep). In an ESM
  // bundle, esbuild rewrites that to a `__require` shim that fails at
  // runtime ("Dynamic require of 'eslint' is not supported"). CJS stays
  // compatible with both classic .eslintrc and flat .config.js configs —
  // eslint loads CJS plugins via interop in either form.
  format: ['cjs'],
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
  // Inline the entire @typescript-eslint/* subtree (utils + its transitive
  // scope-manager, types, typescript-estree, project-service, etc.). The
  // plugin's only require() at runtime then is `eslint` (the peer dep).
  noExternal: [/^@typescript-eslint\//],
  treeshake: true,
  shims: false,
});
