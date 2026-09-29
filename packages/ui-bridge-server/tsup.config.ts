import { defineConfig } from 'tsup';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('./package.json') as { version: string };

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    express: 'src/express.ts',
    nextjs: 'src/nextjs.ts',
    standalone: 'src/standalone.ts',
    handlers: 'src/handlers.ts',
  },
  format: ['cjs', 'esm'],
  // DTS generation is handled by `tsc -p tsconfig.build.json` in the build
  // script; tsup's worker pool can't resolve the monorepo's root tsconfig
  // which still has a deprecated baseUrl flag.
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['express', 'next', 'ws', '@qontinui/ui-bridge'],
  treeshake: true,
  // Inject the package.json version so `provenance.producer.version` of the
  // `sdk-server/page-health` observation names the real installed version.
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
});
