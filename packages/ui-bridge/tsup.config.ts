import { defineConfig } from 'tsup';

export default defineConfig([
  {
    // Main entry points (DTS enabled)
    entry: {
      index: 'src/index.ts',
      'core/index': 'src/core/index.ts',
      'react/index': 'src/react/index.ts',
      'control/index': 'src/control/index.ts',
      'render-log/index': 'src/render-log/index.ts',
      'debug/index': 'src/debug/index.ts',
      'ai/index': 'src/ai/index.ts',
      'server/index': 'src/server/index.ts',
      'server/express': 'src/server/express.ts',
      'server/nextjs': 'src/server/nextjs.ts',
      'server/standalone': 'src/server/standalone.ts',
      'server/handlers': 'src/server/handlers.ts',
      'annotations/index': 'src/annotations/index.ts',
      'specs/index': 'src/specs/index.ts',
      'swc-plugin/index': 'src/swc-plugin/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    external: [
      'react',
      'react-dom',
      'react-native',
      'express',
      'next',
      'ws',
      '@babel/core',
      '@babel/types',
      '@babel/helper-plugin-utils',
      'http',
      'path',
      'url',
    ],
  },
  {
    // Babel plugin: DTS disabled (Babel types too complex for rollup-dts)
    entry: {
      'babel-plugin/index': 'src/babel-plugin/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: false,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    external: ['@babel/core', '@babel/types', '@babel/helper-plugin-utils'],
  },
  {
    // Native: DTS disabled (react-native types not available at build time)
    entry: {
      'native/index': 'src/native/index.ts',
      'native/core/index': 'src/native/core/index.ts',
      'native/react/index': 'src/native/react/index.ts',
      'native/control/index': 'src/native/control/index.ts',
      'native/server/index': 'src/native/server/index.ts',
      'native/debug/index': 'src/native/debug/index.ts',
    },
    format: ['cjs', 'esm'],
    dts: false,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    external: ['react', 'react-native'],
  },
]);
