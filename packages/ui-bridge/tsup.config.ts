import { defineConfig } from 'tsup';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('./package.json') as { version: string };

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
      'idle/index': 'src/idle/index.ts',
      'annotations/index': 'src/annotations/index.ts',
      'specs/index': 'src/specs/index.ts',
      'contracts/index': 'src/contracts/index.ts',
      'ctr/index': 'src/ctr/index.ts',
      'ctr/migrate': 'src/ctr/migrate-specs-to-ctr.ts',
      'verification-layers/index': 'src/verification-layers/index.ts',
      'artifacts/index': 'src/artifacts/index.ts',
    },
    format: ['cjs', 'esm'],
    // DTS rollup traverses transitive types from node_modules; a handful
    // of upstream packages still ship tsconfigs with the deprecated
    // `baseUrl` option, which TS 6+ rejects. `ignoreDeprecations: "6.0"`
    // keeps the DTS build green until those upstream configs migrate.
    // Our own tsconfigs no longer set baseUrl.
    dts: {
      // Resolve types across node_modules so stale / missing upstream
      // dts surfaces as a hard error instead of a silent empty rollup
      // (Phase 3 Item 8 guard).
      resolve: true,
      compilerOptions: {
        ignoreDeprecations: '6.0',
      },
    },
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    // Inject the package.json version as a build-time constant so the SDK
    // can publish itself as `window.__UI_BRIDGE__.version` without pulling
    // package.json into the bundle. See `UIBridgeProviderInit.ts`.
    define: {
      __SDK_VERSION__: JSON.stringify(pkg.version),
    },
    external: [
      'react',
      'react-dom',
      'react-native',
      'express',
      'next',
      'ws',
      'http',
      'path',
      'url',
      'fs',
      '@qontinui/ui-bridge-auto',
      '@tauri-apps/api',
      '@tauri-apps/api/event',
    ],
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
    define: {
      __SDK_VERSION__: JSON.stringify(pkg.version),
    },
    external: ['react', 'react-native'],
  },
]);
