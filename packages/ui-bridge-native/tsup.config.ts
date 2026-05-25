import { defineConfig } from 'tsup';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('./package.json') as { version: string };

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
  // Inject the package.json version as a build-time constant so the on-device
  // /health endpoint reports the real installed SDK version instead of a
  // stale hardcoded string. See `__SDK_VERSION__` in src/server/handlers.ts.
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
});
