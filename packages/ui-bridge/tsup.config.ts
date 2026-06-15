import { defineConfig } from 'tsup';
import { existsSync, mkdirSync, copyFileSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require('./package.json') as { version: string };

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));

// OS-real absolute path of a package-relative file. `realpathSync.native`
// (unlike the plain JS variant) resolves Windows `subst` drives, so on this
// repo's `subst` setup `D:\qontinui-root\…` becomes `C:\Users\…\qontinui-root\…`.
//
// Why this matters for the .d.ts rollup: TypeScript canonicalizes EVERY input
// file through the OS realpath (→ `C:`), but tsup resolves the rollup ENTRY
// paths against the `D:` cwd. A single dts program then contains both `C:` and
// `D:` paths, which share no common ancestor, so the `rootDir: "./src"` pinned
// in `tsconfig.json` can never contain all files — TS6059 ("File X is not under
// rootDir") / TS5009 ("cannot find the common subdirectory") fail the
// declaration build on EVERY local run (the named file is non-deterministic).
// Pre-resolving each entry to its native-real path makes the entries `C:` too,
// so the whole program is uniformly canonicalized and `rootDir` agrees.
//
// On CI and ordinary (non-subst) clones `realpathSync.native` returns the path
// unchanged, so this is a no-op there — the transform is portable, not a
// Windows-only patch.
function realEntry(rel: string): string {
  const abs = resolve(CONFIG_DIR, rel);
  try {
    return realpathSync.native(abs);
  } catch {
    return abs;
  }
}
const realSrcDir = realEntry('src');
function realEntries(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, realEntry(v)]));
}

export default defineConfig([
  {
    // Main entry points (DTS enabled).
    //
    // Entry paths are pre-resolved to their OS-real (subst-resolved) form via
    // `realEntries` so the .d.ts rollup's program is canonicalized to the same
    // drive TypeScript resolves imported files to — without this the dts build
    // fails with TS6059/TS5009 on subst drives (see `realEntry` above). No-op
    // on CI / non-subst clones.
    entry: realEntries({
      index: 'src/index.ts',
      'core/index': 'src/core/index.ts',
      'diagnostics/index': 'src/diagnostics/index.ts',
      'react/index': 'src/react/index.ts',
      'control/index': 'src/control/index.ts',
      'render-log/index': 'src/render-log/index.ts',
      'debug/index': 'src/debug/index.ts',
      'vision/index': 'src/vision/index.ts',
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
      'injected/index': 'src/injected/index.ts',
    }),
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
        // Match `rootDir` to the OS-real `src` so it agrees with both the
        // pre-resolved entries (see `realEntries` above) and TypeScript's
        // realpath-canonicalized imports — eliminating the TS6059/TS5009
        // drive-split failures on subst drives. No-op on non-subst clones.
        rootDir: realSrcDir,
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
    // CLI binary (`npx @qontinui/ui-bridge explain <CODE>`). CJS-only with a
    // shebang banner so it runs as an executable; DTS not needed for a bin.
    // `onSuccess` copies the single-source `diagnostics/codes.json` into
    // `dist/` so the installed package can read the bundled catalog at
    // runtime (plan Phase 2 — "must read the bundled codes.json").
    entry: {
      cli: 'src/cli.ts',
    },
    format: ['cjs'],
    dts: false,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    banner: { js: '#!/usr/bin/env node' },
    define: {
      __SDK_VERSION__: JSON.stringify(pkg.version),
    },
    external: ['fs', 'path', 'url'],
    async onSuccess() {
      const src = resolve(CONFIG_DIR, '..', '..', 'diagnostics', 'codes.json');
      const dest = resolve(CONFIG_DIR, 'dist', 'codes.json');
      if (existsSync(src)) {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
      }
    },
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
  {
    // Injected runtime bundle. A SELF-CONTAINED IIFE a driver injects via
    // Playwright `addInitScript` into a page that ships no UI Bridge code
    // (injected-transport plan §3.2). Output: `dist/injected/bundle.global.js`.
    //
    // No `external` — the bundle must run in a bare page realm with no module
    // loader, so everything it references is inlined. `executeCommand`'s
    // runtime graph is React-free and Node-free (the two react-importing
    // modules, `debug/inspector` and `toast/use-ui-bridge-toasts`, are not in
    // its path), so the bundle stays small and browser-safe. If a future edit
    // drags `react`/`ws`/a Node builtin into the graph, this build surfaces it
    // (bundled or unresolved) rather than letting it 404 at inject time.
    entry: {
      'injected/bundle': 'src/injected/bootstrap.ts',
    },
    format: ['iife'],
    dts: false,
    splitting: false,
    sourcemap: true,
    treeshake: true,
    minify: true,
    define: {
      __SDK_VERSION__: JSON.stringify(pkg.version),
    },
    outExtension() {
      return { js: '.global.js' };
    },
  },
]);
