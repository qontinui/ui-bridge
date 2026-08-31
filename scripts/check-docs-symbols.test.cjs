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
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  declarationlessStems,
  distStem,
  distTargetToSource,
  extractCodeBlocks,
  extractCommentCodeBlocks,
  tsupEntryMap,
  unbuiltTargets,
  undeclaredTypeTargets,
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
// unbuiltTargets — a published target the build never emits
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
  assert.deepEqual(unbuiltTargets(new Map([pkg])), []);
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
  assert.deepEqual(unbuiltTargets(new Map([pkg])), []);
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
  const out = unbuiltTargets(new Map([pkg]));
  assert.equal(out.length, 1);
  assert.equal(out[0].field, '"exports"."./discovery"');
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
  assert.deepEqual(unbuiltTargets(new Map([pkg])), []);
});

test('a non-dist target is not build output and is ignored', () => {
  const pkg = fixturePackage({
    name: '@x/manifest',
    json: { name: '@x/manifest', exports: { './package.json': './package.json' } },
    tsup: TSUP([['index', 'src/index.ts']]),
  });
  assert.deepEqual(unbuiltTargets(new Map([pkg])), []);
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
  // unbuiltTargets accepts `injected/bundle.global` against the entry key
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
// unbuiltTargets — the manifest fields beyond `exports`
// ---------------------------------------------------------------------------
//
// `exports` is the field the check was born on, but a promise of a built file
// is the same promise wherever the manifest makes it, and the fields below are
// where the earlier reading let one through. Each case is a shape this
// repository actually ships.

test('a bin whose target no entry emits is reported, named by its command', () => {
  // `@qontinui/ui-bridge` ships `"bin": { "ui-bridge": "./dist/cli.js" }` from a
  // second tsup config block. Lose that block and `npx @qontinui/ui-bridge`
  // fails on the first command a new user runs — while every `exports` subpath
  // in the same manifest stays perfectly resolvable, so an exports-only reading
  // reports the package clean.
  const pkg = fixturePackage({
    name: '@x/bin',
    json: {
      name: '@x/bin',
      exports: { '.': './dist/index.js' },
      bin: { 'x-tool': './dist/cli.js' },
    },
    tsup: TSUP([['index', 'src/index.ts']]),
  });
  const out = unbuiltTargets(new Map([pkg]));
  assert.equal(out.length, 1);
  assert.equal(out[0].field, '"bin"."x-tool"');
  assert.deepEqual(out[0].missing, ['./dist/cli.js']);
});

test('a bin given as a bare string is read too', () => {
  const pkg = fixturePackage({
    name: '@x/binstr',
    json: { name: '@x/binstr', bin: './dist/cli.js' },
    tsup: TSUP([['index', 'src/index.ts']]),
  });
  const out = unbuiltTargets(new Map([pkg]));
  assert.equal(out.length, 1);
  assert.equal(out[0].field, '"bin"');
});

test('a package with NO exports map is checked, not skipped', () => {
  // `create-ui-bridge-wrapper` publishes its entry point the legacy way —
  // `main` plus `bin`, no `exports` at all — so the early-out this replaces
  // (`if (!exportsMap) continue`) skipped every target the package has.
  // Measured on the commit that added this check: with its `cli` entry renamed,
  // that reading exits 0 on the whole repository.
  const pkg = fixturePackage({
    name: '@x/legacy',
    json: { name: '@x/legacy', main: './dist/cli.js', bin: { legacy: './dist/cli.js' } },
    tsup: TSUP([['other', 'src/cli.ts']]),
  });
  const out = unbuiltTargets(new Map([pkg]));
  assert.deepEqual(
    out.map((f) => f.field),
    ['"main"', '"bin"."legacy"']
  );
});

test('main/module/types are read, and each reports under its own field', () => {
  const pkg = fixturePackage({
    name: '@x/legacy3',
    json: {
      name: '@x/legacy3',
      main: './dist/index.js',
      module: './dist/index.mjs',
      types: './dist/index.d.ts',
    },
    tsup: TSUP([['other', 'src/index.ts']]),
  });
  assert.deepEqual(
    unbuiltTargets(new Map([pkg])).map((f) => f.field),
    ['"main"', '"module"', '"types"']
  );
});

test('the exports string sugar publishes a target like any other', () => {
  // `"exports": "./dist/index.js"` was skipped outright by the earlier
  // `typeof exportsMap !== 'object'` guard.
  const pkg = fixturePackage({
    name: '@x/sugar',
    json: { name: '@x/sugar', exports: './dist/index.js' },
    tsup: TSUP([['other', 'src/index.ts']]),
  });
  const out = unbuiltTargets(new Map([pkg]));
  assert.equal(out.length, 1);
  assert.equal(out[0].field, '"exports"');
});

test('a condition map with no "." key is the root, not a map of subpaths', () => {
  const pkg = fixturePackage({
    name: '@x/rootcond',
    json: {
      name: '@x/rootcond',
      exports: { types: './dist/index.d.ts', default: './dist/index.js' },
    },
    tsup: TSUP([['other', 'src/index.ts']]),
  });
  const out = unbuiltTargets(new Map([pkg]));
  assert.equal(out.length, 1);
  assert.equal(out[0].field, '"exports"');
  assert.deepEqual(out[0].missing, ['./dist/index.d.ts', './dist/index.js']);
});

test('a pattern key publishes a glob, which no entry map can answer', () => {
  // `resolveSubpath` supports `"./*"` so that adding one does not silently turn
  // every subpath into a false failure. It must not turn into one HERE either:
  // `entry` names concrete stems, so whether a glob is emitted is UNKNOWN, and
  // an unknown is skipped for the same reason an unreadable entry map is.
  const pkg = fixturePackage({
    name: '@x/pattern',
    json: { name: '@x/pattern', exports: { './*': './dist/*.js' } },
    tsup: TSUP([['index', 'src/index.ts']]),
  });
  assert.deepEqual(unbuiltTargets(new Map([pkg])), []);
});

test('a "browser" field is not read: its keys are sources, not published targets', () => {
  // The object form maps a source path to a replacement, so walking it like the
  // other fields would report a file the build is not asked to emit. Reading it
  // correctly is a separate job; reading it wrongly is a false failure.
  const pkg = fixturePackage({
    name: '@x/browser',
    json: { name: '@x/browser', browser: { './dist/node.js': './dist/browser.js' } },
    tsup: TSUP([['index', 'src/index.ts']]),
  });
  assert.deepEqual(unbuiltTargets(new Map([pkg])), []);
});

// ---------------------------------------------------------------------------
// undeclaredTypeTargets — the extension the stem check cannot see
// ---------------------------------------------------------------------------
//
// unbuiltTargets asks whether the build declares an ENTRY for a target's stem,
// which every one of these fixtures satisfies. The declaration is the one file
// a declared entry does not guarantee, so each case below is CLEAN under that
// check and is the whole reason this reader exists.

/** A multi-block tsup config: `[[dts, [[stem, src], …]], …]`. */
const TSUP_BLOCKS = (blocks) =>
  `import { defineConfig } from 'tsup';\nexport default defineConfig([\n${blocks
    .map(
      ([dts, entries]) =>
        `  {\n    entry: {\n${entries
          .map(([k, v]) => `      '${k}': '${v}',`)
          .join('\n')}\n    },\n    format: ['cjs', 'esm'],\n    dts: ${dts},\n  },`
    )
    .join('\n')}\n]);\n`;

const NATIVE_SUBPATHS = ['.', './core', './react', './control', './server', './debug'];
const nativeStem = (subpath) => `native${subpath === '.' ? '' : subpath.slice(1)}/index`;

test('a "types" target whose entry sits in a `dts: false` block is reported', () => {
  // The live instance, measured on 8ba7354: `@qontinui/ui-bridge` publishes
  // `./dist/native/index.d.ts` against an entry in its `dts: false` native
  // block. The `.js`/`.mjs` beside it ARE emitted, so the stem check passes and
  // a TypeScript consumer still gets TS2307 in every installed copy.
  const pkg = fixturePackage({
    name: '@x/rn',
    json: {
      name: '@x/rn',
      scripts: { build: 'tsup' },
      exports: {
        './native': {
          types: './dist/native/index.d.ts',
          import: './dist/native/index.mjs',
          require: './dist/native/index.js',
        },
      },
    },
    tsup: TSUP_BLOCKS([['false', [['native/index', 'src/native/index.ts']]]]),
  });
  assert.deepEqual(unbuiltTargets(new Map([pkg])), [], 'clean under the stem check');
  const { findings, stale } = undeclaredTypeTargets(new Map([pkg]));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].field, '"exports"."./native"');
  // Only the declaration. The JavaScript in the same block is emitted, and
  // reporting it would be the false failure this reader must not introduce.
  assert.deepEqual(findings[0].missing, ['./dist/native/index.d.ts']);
  // Staleness is computed over the package set it is GIVEN, which in main()
  // is the whole workspace; a fixture set naturally leaves the real waivers
  // uncredited, and that is not a property of this package.
  assert.ok(
    stale.every((s) => s.package !== '@x/rn'),
    'no waiver claims this package'
  );
});

test('a `tsc` pass in the build script makes `dts: false` say nothing', () => {
  // Four packages here set `dts: false` and still ship declarations, from a
  // separate `tsc -p tsconfig.build.json`. The flag is evidence about tsup, not
  // about the tarball, so a build that runs tsc is UNKNOWN and must not fail.
  const pkg = fixturePackage({
    name: '@x/tsc-pass',
    json: {
      name: '@x/tsc-pass',
      scripts: { build: 'tsup && tsc -p tsconfig.build.json' },
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs' } },
    },
    tsup: TSUP_BLOCKS([['false', [['index', 'src/index.ts']]]]),
  });
  assert.equal(declarationlessStems(pkg[1]), null, 'UNKNOWN, not an empty set');
  assert.deepEqual(undeclaredTypeTargets(new Map([pkg])).findings, []);
});

test('a build that delegates to another npm script is UNKNOWN too', () => {
  // `tsc` in the build string is only the visible half. `npm run build:types`
  // hides whatever that script runs behind a name this read cannot follow, so
  // treating it as tsup-only would be a false failure on a correct package —
  // the one direction this reader must not fail in, because a `types` target
  // that IS emitted has nothing for its author to fix.
  const pkg = fixturePackage({
    name: '@x/delegated',
    json: {
      name: '@x/delegated',
      scripts: { build: 'tsup && npm run build:types', 'build:types': 'tsc -p tsconfig.build.json' },
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs' } },
    },
    tsup: TSUP_BLOCKS([['false', [['index', 'src/index.ts']]]]),
  });
  assert.equal(declarationlessStems(pkg[1]), null);
  assert.deepEqual(undeclaredTypeTargets(new Map([pkg])).findings, []);
});

test('a package with no build script is UNKNOWN, not declarationless', () => {
  const pkg = fixturePackage({
    name: '@x/no-build',
    json: {
      name: '@x/no-build',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.mjs' } },
    },
    tsup: TSUP_BLOCKS([['false', [['index', 'src/index.ts']]]]),
  });
  assert.equal(declarationlessStems(pkg[1]), null);
  assert.deepEqual(undeclaredTypeTargets(new Map([pkg])).findings, []);
});

test('only the `dts: false` block contributes its own entries', () => {
  // The reason this is a per-BLOCK read rather than a wider tsupEntryMap: a
  // config's blocks disagree about `dts`, and flattening them would report the
  // declaring block's targets as undeclared.
  const pkg = fixturePackage({
    name: '@x/mixed',
    json: {
      name: '@x/mixed',
      scripts: { build: 'tsup' },
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.mjs' },
        './native': { types: './dist/native/index.d.ts', import: './dist/native/index.mjs' },
      },
    },
    tsup: TSUP_BLOCKS([
      ['true', [['index', 'src/index.ts']]],
      ['false', [['native/index', 'src/native/index.ts']]],
    ]),
  });
  assert.deepEqual(
    undeclaredTypeTargets(new Map([pkg])).findings.map((f) => f.field),
    ['"exports"."./native"']
  );
});

test('a waived target is not reported, and is credited to its waiver', () => {
  // Reproduces UNDECLARED_TYPE_WAIVERS' one entry against a fixture rather than
  // against the real tree, so this pins the WAIVER MECHANISM and not the state
  // of the repository on the day it was written.
  const pkg = fixturePackage({
    name: '@qontinui/ui-bridge',
    json: {
      name: '@qontinui/ui-bridge',
      scripts: { build: 'tsup' },
      exports: Object.fromEntries(
        NATIVE_SUBPATHS.map((s) => [
          `./native${s === '.' ? '' : s.slice(1)}`,
          {
            types: `./dist/${nativeStem(s)}.d.ts`,
            import: `./dist/${nativeStem(s)}.mjs`,
          },
        ])
      ),
    },
    tsup: TSUP_BLOCKS([
      ['false', NATIVE_SUBPATHS.map((s) => [nativeStem(s), `src/${nativeStem(s)}.ts`])],
    ]),
  });
  const { findings, stale } = undeclaredTypeTargets(new Map([pkg]));
  assert.deepEqual(findings, [], 'every one is waived');
  assert.deepEqual(stale, [], 'and every waiver is credited');
});

test('a waiver that no longer reproduces fails, so the list can only shrink', () => {
  // The same package with the six `types` conditions dropped — the fix the
  // waiver is holding a place for. Every waiver then waives nothing, and the
  // check demands their deletion rather than leaving them ready to
  // re-authorise whatever moves back into those targets.
  const pkg = fixturePackage({
    name: '@qontinui/ui-bridge',
    json: {
      name: '@qontinui/ui-bridge',
      scripts: { build: 'tsup' },
      exports: Object.fromEntries(
        NATIVE_SUBPATHS.map((s) => [
          `./native${s === '.' ? '' : s.slice(1)}`,
          { import: `./dist/${nativeStem(s)}.mjs` },
        ])
      ),
    },
    tsup: TSUP_BLOCKS([
      ['false', NATIVE_SUBPATHS.map((s) => [nativeStem(s), `src/${nativeStem(s)}.ts`])],
    ]),
  });
  const { findings, stale } = undeclaredTypeTargets(new Map([pkg]));
  assert.deepEqual(findings, []);
  assert.equal(stale.length, 6);
  assert.deepEqual(
    [...new Set(stale.map((s) => s.package))],
    ['@qontinui/ui-bridge'],
    'staleness is keyed on package AND target, not on target alone'
  );
});

// ---------------------------------------------------------------------------
// extractCodeBlocks — which blocks the gate reads at all
// ---------------------------------------------------------------------------
//
// This parser decides the gate's COVERAGE, which is the one property a green
// run cannot report on: a block it fails to open is not checked, and nothing
// says so. Both silent passes found while this gate was being built were
// failures of block extraction, one surface up. It was exported for these cases
// and had none.

test('a longer fence wraps an inner ``` block instead of splitting on it', () => {
  const blocks = extractCodeBlocks(
    ['````md', '```ts', "import { a } from 'x';", '```', '````'].join('\n')
  );
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].lang, 'md');
  assert.deepEqual(blocks[0].lines, ['```ts', "import { a } from 'x';", '```']);
});

test('a Docusaurus info string yields the language, not its attributes', () => {
  const blocks = extractCodeBlocks(['```ts title="x.ts" {1,3}', 'const a = 1;', '```'].join('\n'));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].lang, 'ts');
});

test('a closing fence carrying an info string does not close the block', () => {
  // Only a bare fence closes. Treating an info-string fence as a closer would
  // end the block early and drop everything after it, unchecked.
  const blocks = extractCodeBlocks(['```ts', 'const a = 1;', '```ts', 'const b = 2;'].join('\n'));
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].lines, ['const a = 1;', '```ts', 'const b = 2;']);
});

test('an indented fence has its indent stripped from the body', () => {
  const blocks = extractCodeBlocks(['  ```ts', '  const a = 1;', '  ```'].join('\n'));
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].lines, ['const a = 1;']);
});

test('an unterminated fence still yields its content rather than dropping it', () => {
  const blocks = extractCodeBlocks(['```ts', "import { a } from 'x';"].join('\n'));
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].lines, ["import { a } from 'x';"]);
});

test('startLine is the 1-based line of the first line of code', () => {
  const blocks = extractCodeBlocks(['# Title', '', '```ts', 'const a = 1;', '```'].join('\n'));
  assert.equal(blocks[0].startLine, 4);
});

test('a ~~~ fence is read, and a ``` inside it is content', () => {
  const blocks = extractCodeBlocks(['~~~ts', '```', 'const a = 1;', '~~~'].join('\n'));
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0].lines, ['```', 'const a = 1;']);
});

// ---------------------------------------------------------------------------
// extractCommentCodeBlocks — the same reading, inside source comments
// ---------------------------------------------------------------------------

test('a JSDoc fence is read with its gutter stripped and its source line kept', () => {
  const source = [
    'const before = 1;',
    '/**',
    ' * @example',
    ' * ```ts',
    " * import { a } from 'x';",
    ' * ```',
    ' */',
    'export const a = 1;',
  ].join('\n');
  const blocks = extractCommentCodeBlocks('fixture.ts', source);
  assert.equal(blocks.length, 1);
  assert.deepEqual(
    blocks[0].lines.map((l) => l.trim()),
    ["import { a } from 'x';"]
  );
  // 1-based line of the import in the SOURCE file, not within the comment.
  assert.equal(blocks[0].startLine, 5);
});

test('a `//` run carrying an inline block comment does not swallow the parse', () => {
  // stripCommentMarkers blanks a trailing `*/` only on the last line of a BLOCK
  // comment. Blanking it inside a `//` run instead was a measured silent pass:
  // the line loses its closer, the surviving `/*` eats the rest of the parse,
  // and every import below goes unchecked while the gate reports a pass.
  const source = [
    '// ```ts',
    "// import { a } from 'x'; /* trailing */",
    "// import { b } from 'y';",
    '// ```',
    'export const a = 1;',
  ].join('\n');
  const blocks = extractCommentCodeBlocks('fixture.ts', source);
  assert.equal(blocks.length, 1);
  assert.deepEqual(
    blocks[0].lines.map((l) => l.trim()),
    ["import { a } from 'x'; /* trailing */", "import { b } from 'y';"]
  );
});

test('a source with no fence at all is skipped without an AST', () => {
  assert.deepEqual(extractCommentCodeBlocks('fixture.ts', '// just prose\nexport const a = 1;'), []);
});

// ---------------------------------------------------------------------------
// The entry-point split — the guard that keeps a silent green impossible
// ---------------------------------------------------------------------------
//
// `require.main === module` is what lets this file import the gate without
// starting one. Both directions of that split are load-bearing and neither is
// observable from a passing run, which is exactly why they are pinned here: if
// the detection went wrong the gate would do NOTHING and exit 0 — silent green,
// the one outcome this file may not produce.

const GATE = path.resolve(__dirname, 'check-docs-symbols.cjs');

test('requiring the gate does not run it', () => {
  // The half this whole test file depends on. A `require` that started a
  // whole-repo check would make every case below run the gate as a side effect.
  const out = execFileSync(
    process.execPath,
    ['-e', `require(${JSON.stringify(GATE)}); console.log('quiet');`],
    { encoding: 'utf8' }
  );
  assert.equal(out.trim(), 'quiet');
});

test('argv[1] naming the gate while require.main does not is refused, loudly', () => {
  // The misfire shape: invoked as a script, but not detected as the entry
  // module. It must throw rather than fall through to a clean exit 0.
  let status = null;
  let stderr = '';
  try {
    execFileSync(
      process.execPath,
      ['-e', `process.argv[1] = ${JSON.stringify(GATE)}; require(${JSON.stringify(GATE)});`],
      { stdio: 'pipe' }
    );
  } catch (e) {
    status = e.status;
    stderr = String(e.stderr);
  }
  assert.equal(status, 1, 'the guard must fail the process, not pass silently');
  assert.match(stderr, /did not detect itself as the entry module/);
  assert.match(stderr, /Refusing to exit 0 without running the check/);
});

// ---------------------------------------------------------------------------

for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true });

if (failed) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
}
console.log('\ncheck-docs-symbols.test.cjs OK');
