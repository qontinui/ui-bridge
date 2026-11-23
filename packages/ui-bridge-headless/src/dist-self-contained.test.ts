import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingOutputMessage } from '../../../test-support/build-if-stale.mjs';

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
const OUTPUTS = [
  'cli.js',
  'cli.cjs',
  'cli.d.ts',
  'density-cli.js',
  'density-cli.cjs',
  'density-cli.d.ts',
  'index.js',
  'index.cjs',
  'index.d.ts',
].map((name) => join(DIST_DIR, name));
/**
 * Any quoted module specifier naming the SDK itself (or a subpath of it, such
 * as `@qontinui/ui-bridge/density`), but not a sibling package whose name only
 * starts with it (`@qontinui/ui-bridge-headless`, `-cli-args`).
 */
const SDK_SPECIFIER = /["'`]@qontinui\/ui-bridge(?:\/[^"'`]*)?["'`]/;

/**
 * Text with its doc comments and whole-line comments removed: prose that names
 * the SDK (a declaration's doc comment saying why it is NOT imported) is not a
 * module specifier. Only `/** … *\/` blocks and lines that START with `//` are
 * removed — never a `//` after code, which may sit inside a string or a regex
 * on a bundle line and would hide the rest of that line from the check.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

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
    // Built once by vitest.global-setup.ts before any worker starts.
    for (const out of OUTPUTS) expect(existsSync(out), missingOutputMessage(out)).toBe(true);
  });

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
    // beforeAll already required every output (OUTPUTS), so this cannot pass vacuously.
    const offenders = walk(DIST_DIR, (name) => SHIPPED.test(name))
      .filter((f) => SPECIFIER.test(readFileSync(f, 'utf8')))
      .map((f) => relative(PKG_DIR, f));
    expect(offenders).toEqual([]);
  });

  it('no built bundle or declaration file references the SDK as a module specifier', () => {
    // The SDK depends on this package (an optional peer), so headless must
    // never load it: `ui-bridge-density` runs the generated copy of the density
    // core (scripts/sync-density.mjs, plan D-A), bundled into its own output.
    const offenders = walk(DIST_DIR, (name) => SHIPPED.test(name))
      .filter((f) => SDK_SPECIFIER.test(withoutComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(PKG_DIR, f));
    expect(offenders).toEqual([]);
  });

  it('the density bundle carries the core itself', () => {
    // Positive control for the test above: with no SDK import, the core's code
    // must be inside the bundle — its capture schema id is a literal of it.
    for (const bundle of ['density-cli.js', 'density-cli.cjs']) {
      expect(readFileSync(join(DIST_DIR, bundle), 'utf8'), `dist/${bundle}`).toContain(
        'ui-bridge/density-capture@1'
      );
    }
  });

  it('the CLI bundle carries the inlined parser', () => {
    // Positive control: the CLI uses cli-args, so with the import gone its code
    // must be inside the bundle — otherwise the import was dropped, not inlined.
    for (const bundle of ['cli.js', 'cli.cjs', 'density-cli.js', 'density-cli.cjs']) {
      const text = readFileSync(join(DIST_DIR, bundle), 'utf8');
      expect(text, `dist/${bundle} lacks the inlined consumeValue`).toMatch(
        /function consumeValue\d*\b/
      );
    }
  });
});
