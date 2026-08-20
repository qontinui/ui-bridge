import { defineConfig } from 'tsup';

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
});
