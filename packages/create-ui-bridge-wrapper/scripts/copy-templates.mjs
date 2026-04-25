#!/usr/bin/env node
/**
 * Copy `src/templates/**` → `dist/templates/**` after tsup finishes.
 *
 * The CLI resolves templates relative to its own `import.meta.url`, so
 * the compiled bin script needs a sibling `templates/` directory.
 * Tsup doesn't move non-JS assets, so we do it here.
 */

import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = dirname(here);
const src = join(pkgRoot, 'src', 'templates');
const dest = join(pkgRoot, 'dist', 'templates');

await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });

process.stdout.write(`[copy-templates] ${src} -> ${dest}\n`);
