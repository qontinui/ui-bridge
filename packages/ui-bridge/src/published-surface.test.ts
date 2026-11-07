/**
 * The published surface of `@qontinui/ui-bridge` is an allowlist.
 *
 * Plan `2026-11-06-verification-stores-nothing-writes-are-deleted-and-their-open-write-doors-close`,
 * Phase 7 (decision K-D7). The package used to publish a `./verification-layers`
 * subpath, also re-exported from the root. Its API layer fetched with the
 * browser's default credentials, so a business-state check it reported was
 * read through the very page session it claimed to check independently. Its
 * DB layer called a runner command that always errors. Nothing consumed it,
 * and it was deleted rather than repaired.
 *
 * Nothing else checks a published surface: `tsc`, the linter and the rest of
 * the suite all pass a package that exports one entry more than it should. So
 * the `exports` map is pinned here as a literal allowlist, which makes adding
 * or removing a subpath a reviewed edit of this file. The deleted layer is
 * pinned absent at every door a consumer could reach it through: a subpath
 * key or target, the root barrel's re-exports, the root module's runtime
 * namespace, and any production source that could feed another subpath.
 *
 * A sibling plan rewrote files of the deleted layer in parallel, so one merge
 * order meets a modify/delete conflict. Keeping the rewritten copy would pass
 * every other gate, because nothing imports it; the source scan below fails it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as root from './index';

const srcRoot = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(srcRoot, '..');

/**
 * Every subpath the package publishes. `./contracts` stays: the SDK's
 * contracts export has its own executor, validator and tests, and is kept as
 * an embedder API (D4 of plan
 * `2026-11-06-what-the-fleet-records-and-advertises-matches-what-actually-ran`,
 * whose Phase 7 deletes only the runner's executor-less Contracts view).
 */
const PUBLISHED_SUBPATHS = [
  '.',
  './injected',
  './injected/bundle.global.js',
  './package.json',
  './core',
  './diagnostics',
  './observation',
  './react',
  './control',
  './render-log',
  './debug',
  './vision',
  './ai',
  './idle',
  './annotations',
  './specs',
  './discovery',
  './server',
  './server/express',
  './server/nextjs',
  './server/standalone',
  './server/handlers',
  './native',
  './native/core',
  './native/react',
  './native/control',
  './native/debug',
  './contracts',
  './ctr',
  './ctr/migrate',
  './artifacts',
];

/** The deleted layer's module directory, as a subpath, a build target or an import names it. */
const LAYER_MODULE = 'verification-layers';

/**
 * The runtime values the deleted layer exported. `ApiLayerExecutor` is the
 * session-sharing verifier; `MatrixExecutor` is the orchestrator that ran it.
 */
const RETIRED_VALUES = [
  'ApiLayerExecutor',
  'MatrixExecutor',
  'UiLayerExecutor',
  'IpcLayerExecutor',
  'MATRIX_FILE_EXTENSION',
];

/** Any declaration, export or import of the layer: its values, its result type, or its module. */
const RETIRED_CODE = new RegExp(
  `\\b(?:${[...RETIRED_VALUES, 'MatrixExecutionResult'].join('|')})\\b|${LAYER_MODULE}`
);

function manifestExports(): Record<string, unknown> {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
  };
  return manifest.exports;
}

/** Every file path an `exports` entry resolves to, at any condition depth. */
function exportTargets(entry: unknown): string[] {
  if (typeof entry === 'string') return [entry];
  if (entry !== null && typeof entry === 'object')
    return Object.values(entry).flatMap(exportTargets);
  return [];
}

/** Every production TypeScript file under `src/`, test files excluded. */
function productionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : productionSources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Source text with comments removed, so prose about a deleted name does not count. */
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the published surface of @qontinui/ui-bridge', () => {
  it('publishes exactly the allowlisted subpaths', () => {
    const subpaths = Object.keys(manifestExports());
    expect([...subpaths].sort()).toEqual([...PUBLISHED_SUBPATHS].sort());
    // The allowlist keeps the SDK's own contracts executor (see PUBLISHED_SUBPATHS).
    expect(subpaths).toContain('./contracts');
  });

  it('no session-sharing verification layer', () => {
    // No subpath key, and no file any key resolves to, names the layer.
    const exportsMap = manifestExports();
    expect(Object.keys(exportsMap).filter((key) => key.includes(LAYER_MODULE))).toEqual([]);
    expect(exportTargets(exportsMap).filter((target) => target.includes(LAYER_MODULE))).toEqual([]);

    // The root barrel re-exports no module of the layer. It was read: it
    // re-exports the modules that stay.
    const barrel = code(join(srcRoot, 'index.ts'));
    expect(barrel).toMatch(/export \* from '\.\/artifacts';/);
    expect(barrel).toMatch(/export \* from '\.\/contracts';/);
    expect(barrel).not.toContain(LAYER_MODULE);

    // The root module carries none of the layer's values at runtime. It
    // loaded: it carries the artifact store and the contracts executor.
    expect(typeof root.MemoryArtifactStore).toBe('function');
    expect(typeof root.ContractExecutor).toBe('function');
    expect(RETIRED_VALUES.filter((name) => name in root)).toEqual([]);

    // No production source declares, exports or imports the layer, so no
    // other subpath can publish it either.
    const sources = productionSources(srcRoot);
    expect(sources.length).toBeGreaterThan(100);
    const offenders = sources
      .filter((path) => RETIRED_CODE.test(code(path)))
      .map((path) => relative(srcRoot, path));
    expect(offenders).toEqual([]);
  });

  it('records no matrix result or matrix id in an artifact', () => {
    // The layer was the only producer of both, so the envelope dropped them.
    const types = code(join(srcRoot, 'artifacts', 'types.ts'));
    expect(types).toMatch(/export type ArtifactResult\b/);
    expect(types).not.toMatch(/\bMatrixExecutionResult\b|\bmatrixId\b/);
    expect(code(join(srcRoot, 'artifacts', 'memory-store.ts'))).not.toMatch(/\bmatrixId\b/);
  });
});
