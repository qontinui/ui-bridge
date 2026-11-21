import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';

const isWatch = process.argv.includes('--watch');
const outdir = 'dist';

// Ensure output directories exist
const dirs = [
  `${outdir}/background`,
  `${outdir}/content`,
  `${outdir}/popup`,
  `${outdir}/sidepanel`,
  `${outdir}/icons`,
];
for (const dir of dirs) {
  mkdirSync(dir, { recursive: true });
}

// Copy static files
function copyStatic() {
  // Manifest
  copyFileSync('manifest.json', `${outdir}/manifest.json`);

  // Popup HTML/CSS
  copyFileSync('src/popup/popup.html', `${outdir}/popup/popup.html`);
  copyFileSync('src/popup/popup.css', `${outdir}/popup/popup.css`);

  // Side panel HTML/CSS
  copyFileSync('src/sidepanel/sidepanel.html', `${outdir}/sidepanel/sidepanel.html`);
  copyFileSync('src/sidepanel/sidepanel.css', `${outdir}/sidepanel/sidepanel.css`);

  // Icons
  const iconsDir = 'src/icons';
  if (existsSync(iconsDir)) {
    for (const file of readdirSync(iconsDir)) {
      if (file.endsWith('.png')) {
        copyFileSync(join(iconsDir, file), `${outdir}/icons/${file}`);
      }
    }
  }

  console.log('Static files copied.');
}

copyStatic();

// Build configuration for each entry point.
//
// `externals` lets us exclude Node-only / browser-incompatible modules from a
// given bundle. The live relay imports the wrapper's BROWSER-SAFE entry,
// `@qontinui/ui-bridge-wrapper/live`, which reaches no Node builtin and none of
// the Playwright transports; tests/content-bundle-node-free.test.ts fails the
// built bundle if any Node builtin require appears in it. So the externals list
// below is a belt-and-braces guard only, not what keeps the bundle loadable.
const builds = [
  {
    entryPoints: ['src/background/service-worker.ts'],
    outfile: `${outdir}/background/service-worker.js`,
    format: 'esm',
  },
  {
    entryPoints: ['src/content/index.ts'],
    outfile: `${outdir}/content/index.js`,
    format: 'iife',
  },
  {
    entryPoints: ['src/content/live-relay.ts'],
    outfile: `${outdir}/content/live-relay.js`,
    format: 'iife',
    // Belt and braces: the `/live` entry this script imports reaches none of
    // these, so today nothing is marked external in practice. If a future
    // import pulls one in, it stays a runtime require that throws in a content
    // script — and the node-free bundle test fails the build output. Both
    // spellings of every built-in are listed, because esbuild matches
    // `external` literally against the specifier (`fs` does not cover
    // `node:fs`).
    //
    // Build order: the root `build` script builds ui-bridge-wrapper before the
    // `--workspaces` pass, so even a clean first build bundles the wrapper
    // here. (`npm run build --workspaces` alone runs this package before the
    // wrapper; the relay's import then stays unbundled — esbuild prints no
    // warning for it and the build succeeds — and the node-free test's
    // positive control catches it.)
    external: [
      '@qontinui/ui-bridge-headless',
      'playwright',
      'playwright-core',
      'ws',
      'http',
      'node:http',
      'https',
      'node:https',
      'fs',
      'node:fs',
      'net',
      'node:net',
      'tty',
      'node:tty',
      'os',
      'node:os',
      'path',
      'node:path',
      'stream',
      'node:stream',
      'url',
      'node:url',
      'util',
      'node:util',
      'crypto',
      'node:crypto',
      'zlib',
      'node:zlib',
      'child_process',
      'node:child_process',
      'events',
      'node:events',
      'module',
      'node:module',
    ],
  },
  {
    entryPoints: ['src/popup/popup.ts'],
    outfile: `${outdir}/popup/popup.js`,
    format: 'iife',
  },
  {
    entryPoints: ['src/sidepanel/sidepanel.ts'],
    outfile: `${outdir}/sidepanel/sidepanel.js`,
    format: 'iife',
  },
];

async function build() {
  for (const config of builds) {
    const { external, ...rest } = config;
    const ctx = await esbuild.context({
      ...rest,
      bundle: true,
      sourcemap: true,
      target: 'es2020',
      external: external ?? [],
      define: {
        'process.env.NODE_ENV': '"production"',
      },
    });

    if (isWatch) {
      await ctx.watch();
      console.log(`Watching ${config.entryPoints[0]}...`);
    } else {
      await ctx.rebuild();
      await ctx.dispose();
      console.log(`Built ${config.outfile}`);
    }
  }

  if (!isWatch) {
    console.log('Build complete.');
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
