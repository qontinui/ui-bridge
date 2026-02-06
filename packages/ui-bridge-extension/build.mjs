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

// Build configuration for each entry point
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
    const ctx = await esbuild.context({
      ...config,
      bundle: true,
      sourcemap: true,
      target: 'es2020',
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
