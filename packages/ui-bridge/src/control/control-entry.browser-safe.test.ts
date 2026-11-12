/**
 * The `@qontinui/ui-bridge/control` entry is browser-safe: nothing it reaches
 * imports a Node builtin.
 *
 * Post-merge follow-up to qontinui/ui-bridge#348, which re-exported the
 * component-action split from `../server/component-action-invocation` through
 * this entry. `server/` is otherwise the Node-side tree, and #348's reviewer
 * noted that nothing stopped a later `node:` import in `component-action-
 * invocation.ts` or `reserved-caller.ts` from reaching every browser consumer
 * of `./control`. The runner's webview and qontinui-web import this entry, and
 * a Node builtin there fails their bundles, not this repo's tests.
 *
 * So this walks the STATIC import graph from `control/index.ts` and refuses
 * any `node:` specifier or bare builtin name. Specifiers come from
 * TypeScript's own `preProcessFile` (comments, `export * from`, side-effect
 * imports, `import()` and `require()` all handled), and type-only imports are
 * included, because an `import type` becomes a value import with a one-word
 * edit. The whole graph is guarded, not only the two server files, because the
 * entry is the contract.
 *
 * Limit: only relative specifiers are followed. An npm dependency is not
 * walked, so a package that itself needs Node would pass here.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const entryRoot = resolve(__dirname, '..');
const controlEntry = resolve(__dirname, 'index.ts');

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function label(file: string): string {
  return toPosix(relative(entryRoot, file));
}

function resolveRelative(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    base,
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function isNodeBuiltin(spec: string): boolean {
  if (spec.startsWith('node:')) return true;
  return builtinModules.includes(spec.split('/')[0]);
}

/** Walk the graph; return every file reached and every offending import. */
function walkImports(entry: string): {
  files: Set<string>;
  builtins: string[];
  unresolved: string[];
} {
  const files = new Set<string>();
  const builtins: string[] = [];
  const unresolved: string[] = [];
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    const { importedFiles } = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
    for (const { fileName: spec } of importedFiles) {
      if (spec.startsWith('.')) {
        const target = resolveRelative(file, spec);
        if (target) pending.push(target);
        else unresolved.push(`${label(file)}: ${spec}`);
      } else if (isNodeBuiltin(spec)) {
        builtins.push(`${label(file)}: ${spec}`);
      }
    }
  }
  return { files, builtins, unresolved };
}

describe('@qontinui/ui-bridge/control is browser-safe', () => {
  const graph = walkImports(controlEntry);

  it('reaches the server-side component-action split it re-exports', () => {
    // Proves the walk actually crosses into `server/`; a walk that stopped at
    // the entry would pass the builtin check vacuously.
    const reached = [...graph.files].map(label);
    expect(reached).toContain('server/component-action-invocation.ts');
    expect(reached).toContain('server/reserved-caller.ts');
    // The graph was 109 files when this was written. The floor catches a walk
    // that silently stops early (a parser or resolver regression).
    expect(graph.files.size).toBeGreaterThan(50);
  });

  it('resolves every relative import it follows', () => {
    expect(graph.unresolved).toEqual([]);
  });

  it('imports no Node builtin anywhere in the graph', () => {
    expect(graph.builtins).toEqual([]);
  });
});
