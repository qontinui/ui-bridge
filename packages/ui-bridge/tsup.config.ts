import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'core/index': 'src/core/index.ts',
    'react/index': 'src/react/index.ts',
    'control/index': 'src/control/index.ts',
    'render-log/index': 'src/render-log/index.ts',
    'debug/index': 'src/debug/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['react', 'react-dom'],
  treeshake: true,
});
