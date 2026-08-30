#!/usr/bin/env node
/**
 * Table-driven tests for the parsers and roster checks of
 * scripts/check-docs-symbols.cjs.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every rule pinned below was, when it landed, proved by a HAND EXPERIMENT that
 * left nothing behind — a source file temporarily reverted to its pre-fix
 * content, a bogus symbol pasted into a probe file, a before/after verdict read
 * off a terminal and written into a commit message. Each of those proofs was
 * real and none of them is repeatable, which is verbatim the defect class this
 * gate exists to close, one level up: a hand-fix with nothing left behind is
 * how the next one lands.
 *
 * The stakes are asymmetric and that is what makes the rules worth pinning. A
 * regression here does not turn the gate red; it turns the gate QUIET. Two of
 * the behaviours below were found as measured SILENT PASSES during review —
 * a fence trailing the `@example` tag, which skews the parse so that the
 * example's own import is dropped, and a `//` comment run split by a blank
 * line, which did the same. Both were accepted while their siblings in the same
 * file failed correctly. Nothing about a green run distinguishes a gate that
 * checked 496 blocks from one that checked 495.
 *
 * The inputs are not invented: each fixture is the smallest file that
 * reproduces a shape this repository actually contains — a fenced JSDoc
 * `@example`, an `outExtension` build whose published stem is not its entry
 * key, an `exports` subpath the build never emits.
 *
 * Usage:  node scripts/check-docs-symbols.test.cjs
 * Exit:   0 all passed / 1 one or more failed
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  distStem,
  distTargetToSource,
  tsupEntryMap,
  unbuiltSubpaths,
  unfencedExamples,
} = require('./check-docs-symbols.cjs');

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${e.message.split('\n').slice(0, 6).join('\n       ')}`);
  }
}

/** A throwaway package directory, so the fixtures never touch the real tree. */
const tmpRoots = [];
function fixturePackage({ name, json, tsup, files = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uib-docsym-'));
  tmpRoots.push(dir);
  if (tsup !== undefined) fs.writeFileSync(path.join(dir, 'tsup.config.ts'), tsup);
  for (const [rel, body] of Object.entries(files)) {
    const at = path.join(dir, rel);
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, body);
  }
  return [name, { dir, json }];
}

// ---------------------------------------------------------------------------
// unfencedExamples — the comment surface's roster check
// ---------------------------------------------------------------------------
//
// The file argument only picks a ScriptKind, so these parse from the string
// and never touch disk.

const findings = (source) => unfencedExamples('fixture.ts', source);

test('a fenced @example is content, not a finding', () => {
  assert.deepEqual(
    findings(
      ['/**', ' * @example', ' * ```ts', " * import { a } from 'x';", ' * ```', ' */'].join('\n')
    ),
    []
  );
});

test('an @example with no fence is a finding, at the tag', () => {
  const out = findings(
    ['/**', ' * Doc.', ' * @example', " * import { a } from 'x';", ' */'].join('\n')
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].line, 3, 'cites the 1-based source line of the tag');
  assert.match(out[0].why, /carries no fence/);
});

test('a fence trailing the tag opens no block, and is its own finding', () => {
  // The measured silent pass: `@example ```ts` opens nothing, so the intended
  // CLOSING fence is read as an opening one and the example's import is dropped.
  const out = findings(
    ['/**', ' * @example ```ts', " * import { a } from 'x';", ' * ```', ' */'].join('\n')
  );
  assert.equal(out.length, 1);
  assert.match(out[0].why, /does not start its own line/);
});

test('an @example shown INSIDE a fenced block is content', () => {
  // CONTRIBUTING.md and this gate's own header both model the convention by
  // showing it. An author must not be failed by one rule for writing what
  // another rule accepts.
  assert.deepEqual(
    findings(
      [
        '/**',
        ' * @example',
        ' * ```ts',
        ' * /**',
        ' *  * @example',
        ' *  * no fence in here, on purpose',
        ' *  *\\/',
        ' * ```',
        ' */',
      ].join('\n')
    ),
    []
  );
});

test('a fenced @example in a `//` run is content, across the blank line', () => {
  // commentRanges merges whitespace-separated `//` tokens for exactly this
  // shape; unfencedExamples reads the same merged ranges, so both surfaces
  // agree about where the example ends.
  assert.deepEqual(
    findings(
      [
        '// @example',
        '// ```ts',
        "// import { a } from 'x';",
        '//',
        '// ```',
        'export const a = 1;',
      ].join('\n')
    ),
    []
  );
});

test('an unfenced @example in a `//` run is still a finding', () => {
  const out = findings(
    ['// @example', "// import { a } from 'x';", 'export const a = 1;'].join('\n')
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].line, 1);
});

test("a later block tag ends the example, so @returns' fence does not rescue it", () => {
  const out = findings(
    [
      '/**',
      ' * @example',
      " * import { a } from 'x';",
      ' * @returns',
      ' * ```ts',
      ' * a',
      ' * ```',
      ' */',
    ].join('\n')
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].line, 2);
  assert.match(out[0].why, /carries no fence/);
});

test('a file that never says @example is not parsed and finds nothing', () => {
  assert.deepEqual(findings("/** Doc. */\nexport const a = 1;\nconst e = 'user@example.com';"), []);
});

test('`user@example.com` in prose is not the tag', () => {
  // The tag is only ever recognised at the start of a marker-blanked line;
  // an address in a sentence is far more common than the tag itself.
  assert.deepEqual(findings(['/**', ' * Mail user@example.com about it.', ' */'].join('\n')), []);
});

test('two unfenced examples in one file are both reported', () => {
  const out = findings(
    [
      '/**',
      ' * @example',
      ' * one',
      ' */',
      'export const a = 1;',
      '/**',
      ' * @example',
      ' * two',
      ' */',
    ].join('\n')
  );
  assert.deepEqual(
    out.map((f) => f.line),
    [2, 7]
  );
});

// ---------------------------------------------------------------------------
// distStem — the shared reading of a published target
// ---------------------------------------------------------------------------

test('distStem strips the published extension and the dist/ prefix', () => {
  assert.equal(distStem('./dist/react/index.mjs'), 'react/index');
  assert.equal(distStem('./dist/index.d.ts'), 'index');
  assert.equal(distStem('./dist/server/express.js'), 'server/express');
  assert.equal(distStem('./dist/injected/bundle.global.js'), 'injected/bundle.global');
});

test('distStem returns null for a target that is not build output', () => {
  assert.equal(distStem('./package.json'), null);
  assert.equal(distStem('./src/index.ts'), null);
  assert.equal(distStem(undefined), null);
});

// ---------------------------------------------------------------------------
// unbuiltSubpaths — a published subpath the build never emits
// ---------------------------------------------------------------------------

const TSUP = (entries) =>
  `import { defineConfig } from 'tsup';\nexport default defineConfig({\n  entry: {\n${entries
    .map(([k, v]) => `    '${k}': '${v}',`)
    .join('\n')}\n  },\n});\n`;

test('a subpath whose entry the build declares is clean', () => {
  const pkg = fixturePackage({
    name: '@x/ok',
    json: {
      name: '@x/ok',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs' } },
    },
    tsup: TSUP([['index', 'src/index.ts']]),
  });
  assert.deepEqual(unbuiltSubpaths(new Map([pkg])), []);
});

test('an outExtension build is clean: the published stem may suffix the entry key', () => {
  // `entry: { 'injected/bundle': … }` with `outExtension` emits
  // dist/injected/bundle.global.js. The file IS emitted, which is all this
  // check asks.
  const pkg = fixturePackage({
    name: '@x/iife',
    json: {
      name: '@x/iife',
      exports: { './injected/bundle.global.js': './dist/injected/bundle.global.js' },
    },
    tsup: TSUP([['injected/bundle', 'src/injected/bootstrap.ts']]),
  });
  assert.deepEqual(unbuiltSubpaths(new Map([pkg])), []);
});

test('a subpath no entry emits is reported, with every target it names', () => {
  // The live instance: `"./discovery"` published against a build that had no
  // `discovery/index` entry, while src/discovery/index.ts made it look healthy.
  const pkg = fixturePackage({
    name: '@x/gap',
    json: {
      name: '@x/gap',
      exports: {
        '.': './dist/index.js',
        './discovery': {
          types: './dist/discovery/index.d.ts',
          import: './dist/discovery/index.mjs',
        },
      },
    },
    tsup: TSUP([['index', 'src/index.ts']]),
    files: { 'src/discovery/index.ts': 'export const discoverWebApps = 1;\n' },
  });
  const out = unbuiltSubpaths(new Map([pkg]));
  assert.equal(out.length, 1);
  assert.equal(out[0].subpath, './discovery');
  assert.deepEqual(out[0].missing, ['./dist/discovery/index.d.ts', './dist/discovery/index.mjs']);
  assert.match(out[0].config, /tsup\.config\.ts$/);
});

test('a package whose build declares nothing readable is skipped, not failed', () => {
  // An empty entry map is UNKNOWN — the config is absent, is not tsup, or
  // states its entries in a form no AST read can settle. Rendering that as
  // "emits nothing" would fail every dist target on a read that did not happen.
  const pkg = fixturePackage({
    name: '@x/no-config',
    json: { name: '@x/no-config', exports: { '.': './dist/index.js' } },
  });
  assert.deepEqual(unbuiltSubpaths(new Map([pkg])), []);
});

test('a non-dist target is not build output and is ignored', () => {
  const pkg = fixturePackage({
    name: '@x/manifest',
    json: { name: '@x/manifest', exports: { './package.json': './package.json' } },
    tsup: TSUP([['index', 'src/index.ts']]),
  });
  assert.deepEqual(unbuiltSubpaths(new Map([pkg])), []);
});

// ---------------------------------------------------------------------------
// The resolver, and where it deliberately disagrees with the roster check
// ---------------------------------------------------------------------------

test('the build declaration answers a renamed entry the mirror cannot', () => {
  const [, pkg] = fixturePackage({
    name: '@x/renamed',
    json: { name: '@x/renamed' },
    tsup: TSUP([['ctr/migrate', 'src/ctr/migrate-specs-to-ctr.ts']]),
    files: { 'src/ctr/migrate-specs-to-ctr.ts': 'export const migrate = 1;\n' },
  });
  assert.equal(
    distTargetToSource(pkg, './dist/ctr/migrate.d.ts'),
    path.join(pkg.dir, 'src/ctr/migrate-specs-to-ctr.ts')
  );
});

test('the declaration wins over a mirror path that also exists', () => {
  // The reason the declaration is consulted FIRST. Reversed, this package is
  // name-checked against the file it does not publish, silently.
  const [, pkg] = fixturePackage({
    name: '@x/both',
    json: { name: '@x/both' },
    tsup: TSUP([['react/index', 'src/react/entry.ts']]),
    files: {
      'src/react/entry.ts': 'export const published = 1;\n',
      'src/react/index.ts': 'export const notPublished = 1;\n',
    },
  });
  assert.equal(
    distTargetToSource(pkg, './dist/react/index.mjs'),
    path.join(pkg.dir, 'src/react/entry.ts')
  );
});

test("the resolver does NOT adopt the roster check's suffix match", () => {
  // unbuiltSubpaths accepts `injected/bundle.global` against the entry key
  // `injected/bundle` because the file is emitted. The resolver must not: the
  // question it asks is which src file the entry IS, and for an IIFE built for
  // a bare page realm the honest answer is none. Matching here would let a doc
  // block name-check against a module surface that is not published.
  const [, pkg] = fixturePackage({
    name: '@x/iife2',
    json: { name: '@x/iife2' },
    tsup: TSUP([['injected/bundle', 'src/injected/bootstrap.ts']]),
    files: { 'src/injected/bootstrap.ts': 'export const boot = 1;\n' },
  });
  assert.equal(distTargetToSource(pkg, './dist/injected/bundle.global.js'), null);
});

test('tsupEntryMap collects through a call wrapper and rejects a non-src value', () => {
  // packages/ui-bridge wraps its entries in `realEntries({ … })`; the scope is
  // the initializer's whole subtree, call wrapper included. A value outside
  // src/ is not an entry this gate can map back.
  const [, pkg] = fixturePackage({
    name: '@x/wrapped',
    json: { name: '@x/wrapped' },
    tsup:
      "import { defineConfig } from 'tsup';\n" +
      'const realEntries = (e) => e;\n' +
      'export default defineConfig({\n' +
      '  entry: realEntries({\n' +
      "    index: 'src/index.ts',\n" +
      "    vendored: 'vendor/thing.ts',\n" +
      '  }),\n' +
      "  external: ['src/not-an-entry.ts'],\n" +
      '});\n',
  });
  assert.deepEqual([...tsupEntryMap(pkg).entries()], [['index', 'src/index.ts']]);
});

// ---------------------------------------------------------------------------

for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });

if (failed) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log('\ncheck-docs-symbols.test.cjs OK');
