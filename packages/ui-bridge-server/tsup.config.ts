import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    express: 'src/express.ts',
    nextjs: 'src/nextjs.ts',
    standalone: 'src/standalone.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['express', 'next', 'ws', 'ui-bridge'],
  treeshake: true,
});
