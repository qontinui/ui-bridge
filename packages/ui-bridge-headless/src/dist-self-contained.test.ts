import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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
 * The SDK itself, or a subpath of it such as `@qontinui/ui-bridge/density` —
 * but not a sibling package whose name only starts with it
 * (`@qontinui/ui-bridge-headless`, `-cli-args`).
 */
const SDK_SPECIFIER = /^@qontinui\/ui-bridge(?:\/|$)/;

/**
 * Every module specifier a shipped file loads, read from TypeScript's own
 * parse of it: `import`/`export … from`, `import x = require()`, `import('…')`
 * (value or type), and `require('…')`. A comment or a string that merely names
 * a package is not a specifier, so prose saying the SDK is NOT imported cannot
 * trip the check, and no comment-stripping can hide one that is.
 */
function moduleSpecifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const kind = /\.d\.(?:c|m)?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const out: string[] = [];
  const literal = (n: ts.Node | undefined): void => {
    if (n !== undefined && ts.isStringLiteralLike(n)) out.push(n.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) literal(node.moduleSpecifier);
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      literal(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      literal(node.argument.literal);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      literal(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
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
    const shipped = walk(DIST_DIR, (name) => SHIPPED.test(name));
    // The reader is not vacuous: the CLI bundle's own imports are found.
    expect(moduleSpecifiers(join(DIST_DIR, 'density-cli.js'))).toContain('fs');
    const offenders = shipped.flatMap((f) =>
      moduleSpecifiers(f)
        .filter((s) => SDK_SPECIFIER.test(s))
        .map((s) => `${relative(PKG_DIR, f)}: ${s}`)
    );
    expect(offenders).toEqual([]);
  });

  it('the density bundle carries the core itself', () => {
    // Positive control for the test above: with no SDK import, the core's code
    // must be inside the bundle. The token is a message only the snapshot
    // adapter's body holds (density/capture-from-snapshot.ts), so the CLI's own
    // text cannot satisfy it — the schema id, by contrast, is also in USAGE.
    const ADAPTER_ONLY = 'the snapshot has no `elements` array';
    const cli = readFileSync(join(PKG_DIR, 'src', 'density-cli.ts'), 'utf8');
    expect(cli, 'the token must not occur in the CLI itself').not.toContain(ADAPTER_ONLY);
    for (const bundle of ['density-cli.js', 'density-cli.cjs']) {
      expect(readFileSync(join(DIST_DIR, bundle), 'utf8'), `dist/${bundle}`).toContain(
        ADAPTER_ONLY
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
