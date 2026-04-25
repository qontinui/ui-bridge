import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: '{{#IF_UI}}src/index.tsx{{/IF_UI}}{{#IF_NODE}}src/index.ts{{/IF_NODE}}',
  },
  format: ['cjs', 'esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
  external: [
    '@qontinui/ui-bridge',
    '@qontinui/ui-bridge-wrapper',
    '@qontinui/ui-bridge-headless',
    'playwright',
    'react',
    'react-dom',
    'ws',
  ],
});
