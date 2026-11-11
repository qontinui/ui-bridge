#!/usr/bin/env node
/**
 * Fixture tests for scripts/check-dynamic-import-hints.cjs, the ratchet that
 * refuses a computed `import()` in any built package dist unless it carries
 * `webpackIgnore: true` and `turbopackIgnore: true`.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * That check runs on built output, and a regression in it does not turn it red —
 * it turns it QUIET: a parser that stops seeing a call split across lines, a
 * file extension it stops reading, or a run that finds nothing to read and exits
 * 0 all look exactly like a clean dist. So each shape the check must judge is
 * pinned here against a fixture tree, both ways round, and it runs BEFORE the
 * check in CI (the same order as the repo's other ratchet self-tests).
 *
 * Every fixture is a throwaway tree under the OS temp dir, passed to the check
 * with --root, so this needs no build.
 *
 * Usage:  node scripts/check-dynamic-import-hints.test.cjs
 * Exit:   0 all passed / 1 one or more failed
 */

'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHECK = path.resolve(__dirname, 'check-dynamic-import-hints.cjs');

let failed = 0;
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${e.message.split('\n').slice(0, 8).join('\n       ')}`);
  }
}

const BUILD_PKG = JSON.stringify({ name: 'fixture', scripts: { build: 'tsup' } });

/**
 * Build a fixture tree and run the check on it. `files` maps a path under the
 * tree root to its contents; a package.json declaring a build script is added
 * to every package that has a file under dist/, unless the map gives its own.
 */
function runOn(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-import-hints-'));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      const pkg = rel.match(/^packages\/([^/]+)\/dist\//);
      const manifest = pkg && path.join(root, 'packages', pkg[1], 'package.json');
      if (manifest && !(`packages/${pkg[1]}/package.json` in files) && !fs.existsSync(manifest)) {
        fs.writeFileSync(manifest, BUILD_PKG);
      }
    }
    const run = spawnSync(process.execPath, [CHECK, '--root', root], { encoding: 'utf8' });
    return { status: run.status, stdout: run.stdout, stderr: run.stderr, out: run.stdout + run.stderr };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// How tsup emits a commented call: one line per comment (dist/server/index.mjs).
const MULTI_LINE_HINTED = [
  'async function loadTauriEventModule(specifier) {',
  '  return import(',
  '    /* @vite-ignore */',
  '    /* turbopackIgnore: true */',
  '    /* webpackIgnore: true */',
  '    specifier',
  '  );',
  '}',
  '',
].join('\n');

const BARE = [
  'async function load() {',
  "  const specifier = 'ioredis';",
  '  const mod = await import(specifier);',
  '  return mod.default;',
  '}',
  '',
].join('\n');

test('a commented multi-line call passes, and is counted', () => {
  const r = runOn({ 'packages/sdk/dist/server/index.mjs': MULTI_LINE_HINTED });
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /Dynamic import hints ok: 1 computed import\(\) call\(s\) checked/);
  assert.match(r.stdout, /1 file\(s\) in 1 package dist\(s\)/);
});

test('a single-line commented call passes (both hints on the call line)', () => {
  const r = runOn({
    'packages/sdk/dist/index.js':
      'const m = await import(/* @vite-ignore */ /* turbopackIgnore: true */ /* webpackIgnore: true */ specifier);\n',
  });
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /ok: 1 computed import\(\) call\(s\) checked/);
});

test('a bare import(specifier) fails, naming file, line and column', () => {
  const r = runOn({ 'packages/sdk/dist/server/index.mjs': BARE });
  assert.equal(r.status, 1, r.out);
  assert.match(
    r.stderr,
    /packages\/sdk\/dist\/server\/index\.mjs:3:21 {2}import\(specifier\) — missing webpackIgnore: true, turbopackIgnore: true/
  );
  assert.match(r.stderr, /FAILED: 1 computed import\(\) call\(s\)/);
});

test('one hint alone is not enough: the missing one is named', () => {
  const r = runOn({
    'packages/sdk/dist/index.js': 'const m = await import(/* webpackIgnore: true */ specifier);\n',
  });
  assert.equal(r.status, 1, r.out);
  assert.match(r.stderr, /import\(specifier\) — missing turbopackIgnore: true\n/);
  assert.doesNotMatch(r.stderr, /missing webpackIgnore/);
});

test('a hint after the specifier, inside the parentheses, counts', () => {
  const r = runOn({
    'packages/sdk/dist/index.js':
      'const m = await import(\n  specifier\n  /* webpackIgnore: true */\n  /* turbopackIgnore: true */\n);\n',
  });
  assert.equal(r.status, 0, r.out);
});

test('a hint OUTSIDE the parentheses does not count', () => {
  const r = runOn({
    'packages/sdk/dist/index.js':
      '/* webpackIgnore: true */ /* turbopackIgnore: true */\nconst m = await import(specifier);\n',
  });
  assert.equal(r.status, 1, r.out);
  assert.match(r.stderr, /index\.js:2:17 {2}import\(specifier\) — missing webpackIgnore: true, turbopackIgnore: true/);
});

test('a literal import("x") is not checked, and is counted as such', () => {
  const r = runOn({
    'packages/sdk/dist/index.js': "await import('x');\nawait import(\"y\");\nawait import(`z`);\n",
  });
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /ok: 0 computed import\(\) call\(s\) checked/);
  assert.match(r.stdout, /3 literal-specifier import\(\) call\(s\) not checked/);
});

test('a template literal WITH a substitution is computed, so it is checked', () => {
  const r = runOn({ 'packages/sdk/dist/index.js': 'await import(`./locale/${lang}.js`);\n' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.stderr, /import\(`\.\/locale\/\$\{lang\}\.js`\) — missing/);
});

test('"import(" inside a string, a comment, a method name or import.meta is not a call', () => {
  const r = runOn({
    'packages/sdk/dist/index.js': [
      'const doc = "await import(specifier)";',
      '// const m = await import(specifier);',
      '/* return import(t) */',
      'loader.import(specifier);',
      'const here = import.meta.url;',
      '',
    ].join('\n'),
  });
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /ok: 0 computed import\(\) call\(s\) checked/);
});

test('a minified return import(t) in a *.global.js file is excluded', () => {
  const r = runOn({
    'packages/sdk/dist/injected/bundle.global.js': '"use strict";(()=>{async function a(t){return import(t)}})();\n',
    'packages/sdk/dist/index.js': MULTI_LINE_HINTED,
  });
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /1 \.global\.js file\(s\) excluded/);
});

test('the same minified call under any other name is read, and fails (the exclusion is by name)', () => {
  const r = runOn({
    'packages/sdk/dist/injected/bundle.js': '"use strict";(()=>{async function a(t){return import(t)}})();\n',
  });
  assert.equal(r.status, 1, r.out);
  assert.match(r.stderr, /packages\/sdk\/dist\/injected\/bundle\.js:1:47 {2}import\(t\) — missing/);
});

test('a bare import in a .cjs file fails', () => {
  const r = runOn({ 'packages/wrapper/dist/inject-cli.cjs': `"use strict";\n${BARE}` });
  assert.equal(r.status, 1, r.out);
  assert.match(r.stderr, /packages\/wrapper\/dist\/inject-cli\.cjs:4:21 {2}import\(specifier\) — missing/);
});

test('declaration, source-map and json files are not read', () => {
  const r = runOn({
    'packages/sdk/dist/index.d.ts': 'export declare const m: typeof import(specifier);\n',
    'packages/sdk/dist/index.js.map': '{"sourcesContent":["await import(specifier)"]}\n',
    'packages/sdk/dist/data.json': '{"x":"import(specifier)"}\n',
    'packages/sdk/dist/index.js': MULTI_LINE_HINTED,
  });
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /1 file\(s\) in 1 package dist\(s\)/);
});

test('an empty tree is UNKNOWN (exit 2), never a pass', () => {
  const r = runOn({});
  assert.equal(r.status, 2, r.out);
  assert.match(r.stderr, /UNKNOWN — not everything was checked/);
  assert.match(r.stderr, /no built file to read/);
  assert.equal(r.stdout, '');
});

test('a package that declares a build but has no dist/ is UNKNOWN, even beside a clean one', () => {
  const r = runOn({
    'packages/sdk/dist/index.js': MULTI_LINE_HINTED,
    'packages/unbuilt/package.json': BUILD_PKG,
  });
  assert.equal(r.status, 2, r.out);
  assert.match(r.stderr, /packages\/unbuilt declares a build script but has no dist\//);
});

test('a package with no build script and no dist/ is not expected to have one', () => {
  const r = runOn({
    'packages/sdk/dist/index.js': MULTI_LINE_HINTED,
    'packages/python/pyproject.toml': '[project]\nname = "x"\n',
  });
  assert.equal(r.status, 0, r.out);
});

test('a dist file that does not parse is UNKNOWN: its imports were never read', () => {
  const r = runOn({
    'packages/sdk/dist/index.js': MULTI_LINE_HINTED,
    'packages/sdk/dist/broken.js': 'export const a = (;\n',
  });
  assert.equal(r.status, 2, r.out);
  assert.match(r.stderr, /packages\/sdk\/dist\/broken\.js: does not parse \(line 1: .+\) — its imports were never read/);
});

test('a definite failure outranks UNKNOWN (exit 1), and still reports the UNKNOWN part', () => {
  const r = runOn({
    'packages/sdk/dist/index.js': BARE,
    'packages/unbuilt/package.json': BUILD_PKG,
  });
  assert.equal(r.status, 1, r.out);
  assert.match(r.stderr, /also UNKNOWN: packages\/unbuilt declares a build script but has no dist\//);
});

if (failed) {
  console.error(`\n${failed} of ${failed + passed} test(s) failed.`);
  process.exit(1);
}
console.log(`\ncheck-dynamic-import-hints.test.cjs OK (${passed} passed)`);
