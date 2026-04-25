/**
 * Template walker for `create-ui-bridge-wrapper`.
 *
 * Given a template directory (e.g. `src/templates/_common`) and an output
 * directory, walks the template tree, renders every `.tpl` file through
 * the tiny engine in `render.ts`, and writes the result.
 *
 * The walker decides which files to emit by applying two simple rules:
 *
 *   1. Files that end in `.tpl` are rendered and their `.tpl` suffix stripped.
 *      Any other file is copied verbatim.
 *   2. The caller can supply a `filter(relativePath)` hook to skip files —
 *      that's how the CLI omits `index.tsx` when `--no-ui` is chosen.
 *
 * We also rewrite a handful of path-level tokens so template authors can
 * encode conditional paths in filenames themselves (e.g. picking between
 * `src/index.tsx.tpl` and `src/index-node.ts.tpl` via the filter).
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { renderTemplate, type RenderContext } from './render.js';

export interface CopyOptions extends RenderContext {
  /** Source directory containing `.tpl` files (and any verbatim assets). */
  sourceDir: string;
  /** Destination directory. Created if absent; caller is responsible for existence checks. */
  destDir: string;
  /**
   * Return `false` to skip a file. `relativePath` is the path relative to
   * `sourceDir`, using forward slashes regardless of platform.
   */
  filter?: (relativePath: string) => boolean;
  /**
   * Rewrite the destination path (relative, forward slashes, with `.tpl`
   * already stripped). Return the string unchanged to use the default.
   * Used by the CLI to rename `src/index-node.ts.tpl` → `src/index.ts`.
   */
  rename?: (relativePath: string) => string;
  /** Record each file we wrote (absolute paths). */
  onWrite?: (absPath: string) => void;
}

export async function renderTree(opts: CopyOptions): Promise<string[]> {
  const written: string[] = [];
  await walk(opts.sourceDir, opts, written);
  return written;
}

async function walk(dir: string, opts: CopyOptions, written: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = toForwardSlashes(relative(opts.sourceDir, abs));
    if (entry.isDirectory()) {
      await walk(abs, opts, written);
      continue;
    }
    if (!entry.isFile()) continue;
    if (opts.filter && !opts.filter(rel)) continue;

    const stripped = stripTplSuffix(rel);
    const destRel = opts.rename ? opts.rename(stripped) : stripped;
    const destAbs = join(opts.destDir, destRel);
    await mkdir(dirname(destAbs), { recursive: true });

    if (rel.endsWith('.tpl')) {
      const source = await readFile(abs, 'utf8');
      const rendered = renderTemplate(source, {
        vars: opts.vars,
        flags: opts.flags,
      });
      await writeFile(destAbs, rendered, 'utf8');
    } else {
      const buf = await readFile(abs);
      await writeFile(destAbs, buf);
    }

    written.push(destAbs);
    opts.onWrite?.(destAbs);
  }
}

function stripTplSuffix(path: string): string {
  return path.endsWith('.tpl') ? path.slice(0, -'.tpl'.length) : path;
}

function toForwardSlashes(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}
