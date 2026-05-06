import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'core/index': 'src/core/index.ts',
    'react/index': 'src/react/index.ts',
    'control/index': 'src/control/index.ts',
    'server/index': 'src/server/index.ts',
    'design/index': 'src/design/index.ts',
    'debug/index': 'src/debug/index.ts',
  },
  format: ['cjs', 'esm'],
  // DTS generation is handled by `tsc -p tsconfig.build.json` in the build
  // script; tsup's worker pool can't resolve the monorepo's root tsconfig
  // which still has a deprecated baseUrl flag.
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-native', 'react-native-tcp-socket'],
  treeshake: true,
});
