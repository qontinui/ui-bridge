import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_ARGS_PREREQUISITE, ensureBuilt } from '../../../test-support/ensure-built.mjs';

/**
 * Build-output guard: `@qontinui/ui-bridge-cli-args` is INLINED into this
 * package's bundles, never required at runtime, and never named by the
 * published types.
 *
 * cli-args has never reached npm past 0.1.0 (its publish 404s), so a published
 * `ui-bridge-tab` that still `require`d it — through a `dependencies` entry
 * tsup externalises by default — would fail to install or crash on startup for
 * every consumer, and a `.d.ts` that imports it would not resolve for a
 * TypeScript consumer. It is therefore a devDependency and tsup bundles it.
 * This test fails if a reference to it reappears in any built bundle or
 * declaration file under `dist/`, or if the manifest lists it as a runtime
 * dependency again.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, '..');
const DIST_DIR = join(PKG_DIR, 'dist');
const CLI_ARGS = '@qontinui/ui-bridge-cli-args';
const RUNTIME_BLOCKS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const;
/** Any quoted module specifier naming the package (or a subpath of it). */
const SPECIFIER = /["'`]@qontinui\/ui-bridge-cli-args(?:\/[^"'`]*)?["'`]/;
/** What ships from dist and is loaded by node or by tsc: bundles and declarations. */
const SHIPPED = /\.(?:c|m)?js$|\.d\.(?:c|m)?ts$/;
const OUTPUTS = ['cli.js', 'cli.cjs', 'cli.d.ts', 'index.js', 'index.cjs', 'index.d.ts'].map(
  (name) => join(DIST_DIR, name)
);

function walk(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs, keep));
    else if (keep(entry.name)) out.push(abs);
  }
  return out;
}

describe('cli-args is bundled into dist, not a runtime dependency', () => {
  beforeAll(() => {
    ensureBuilt(PKG_DIR, OUTPUTS, { prerequisites: [CLI_ARGS_PREREQUISITE] });
  }, 1_200_000);

  it('the manifest does not list cli-args as a runtime dependency', () => {
    const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const block of RUNTIME_BLOCKS) {
      expect(pkg[block]?.[CLI_ARGS], `${CLI_ARGS} is in ${block}`).toBeUndefined();
    }
  });

  it('no built bundle or declaration file references cli-args as a module specifier', () => {
    // The bin, both entry formats and their types must exist, or this proves nothing.
    for (const out of OUTPUTS) {
      expect(existsSync(out), `${relative(PKG_DIR, out)} missing`).toBe(true);
    }
    const offenders = walk(DIST_DIR, (name) => SHIPPED.test(name))
      .filter((f) => SPECIFIER.test(readFileSync(f, 'utf8')))
      .map((f) => relative(PKG_DIR, f));
    expect(offenders).toEqual([]);
  });

  it('the CLI bundle carries the inlined parser', () => {
    // Positive control: the CLI uses cli-args, so with the import gone its code
    // must be inside the bundle — otherwise the import was dropped, not inlined.
    for (const bundle of ['cli.js', 'cli.cjs']) {
      const text = readFileSync(join(DIST_DIR, bundle), 'utf8');
      expect(text, `dist/${bundle} lacks the inlined consumeValue`).toMatch(
        /function consumeValue\b/
      );
    }
  });
});
