#!/usr/bin/env node
/**
 * Self-test of the density vendoring gate (scripts/sync-density.mjs).
 *
 * The gate is an oracle: when its check passes, CI believes the headless copy
 * IS the canonical core. A check that cannot fail would pass exactly the drift
 * it exists to catch, so each way it must fail is pinned here, on temporary
 * fixture trees, before the gate itself runs in CI:
 *
 *   - a copy that differs by one byte          -> drifted
 *   - a copy that is not there                 -> missing
 *   - a copy whose source no longer exists     -> stale
 *   - each forbidden import form               -> refused (bare specifier, a
 *     relative path outside the set, `node:fs`, a dynamic `import()`, a
 *     `require()`, and any import at all in the envelope)
 *
 * and the shapes that must NOT be refused (a sibling with or without `.js`,
 * the envelope import, `import type`, a multi-line import, `export … from`, and
 * `require(` / `import(` inside a comment, a string or a regex).
 *
 * Usage:  node scripts/sync-density.test.mjs
 * Exit:   0 all passed / 1 one or more failed
 *
 * Plan: 2026-11-23-ui-bridge-measures-information-density-as-reach-per-role-and-plans-the-change, Phase 2.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  DENSITY_SOURCE_DIR,
  DENSITY_TARGET_DIR,
  OBSERVATION_SOURCE,
  OBSERVATION_TARGET_DIR,
  checkDensityCopies,
  expectedDensityCopies,
  forbiddenImports,
  main,
  moduleEdges,
  syncDensityCopies,
} from './sync-density.mjs';

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

const made = [];
function put(root, rel, text) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

/** A fixture tree with a two-file core and an envelope, already synced. */
function fixture({ extraSource } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sync-density-'));
  made.push(root);
  put(root, `${DENSITY_SOURCE_DIR}/a.ts`, "import { b } from './b';\nexport const a = b + 1;\n");
  put(
    root,
    `${DENSITY_SOURCE_DIR}/b.ts`,
    "import { Observation } from '../observation/observation';\nexport const b = typeof Observation === 'object' ? 1 : 0;\n"
  );
  put(root, `${DENSITY_SOURCE_DIR}/__tests__/a.test.ts`, "import { a } from '../a';\n");
  put(root, OBSERVATION_SOURCE, 'export const Observation = {};\n');
  if (extraSource) put(root, `${DENSITY_SOURCE_DIR}/${extraSource.name}`, extraSource.text);
  return root;
}

const silent = { log() {}, error() {} };
const clean = () => ({ drifted: [], missing: [], stale: [] });

const refusalsOf = (text, { envelope = false } = {}) =>
  forbiddenImports('x.ts', text, ['a', 'b', 'schema'], envelope);

console.log('sync-density: the check fails on drift');

test('a synced fixture checks clean (the control every failure below departs from)', () => {
  const root = fixture();
  syncDensityCopies(root);
  assert.deepEqual(checkDensityCopies(root), clean());
  assert.equal(main(['--check'], root, silent), 0);
});

test('a copy that differs by one byte is drifted, and --check exits 1', () => {
  const root = fixture();
  syncDensityCopies(root);
  const target = join(root, `${DENSITY_TARGET_DIR}/a.ts`);
  writeFileSync(target, readFileSync(target, 'utf8').replace('b + 1', 'b + 2'));
  assert.deepEqual(checkDensityCopies(root), {
    drifted: [`${DENSITY_TARGET_DIR}/a.ts`],
    missing: [],
    stale: [],
  });
  assert.equal(main(['--check'], root, silent), 1);
});

test('an edited canonical source drifts its copy too', () => {
  const root = fixture();
  syncDensityCopies(root);
  put(root, OBSERVATION_SOURCE, 'export const Observation = { v: 2 };\n');
  assert.deepEqual(checkDensityCopies(root).drifted, [`${OBSERVATION_TARGET_DIR}/observation.ts`]);
  assert.equal(main(['--check'], root, silent), 1);
});

test('a copy that is not there is missing, and --check exits 1', () => {
  const root = fixture();
  syncDensityCopies(root);
  rmSync(join(root, `${DENSITY_TARGET_DIR}/b.ts`));
  assert.deepEqual(checkDensityCopies(root), {
    drifted: [],
    missing: [`${DENSITY_TARGET_DIR}/b.ts`],
    stale: [],
  });
  assert.equal(main(['--check'], root, silent), 1);
});

test('a never-synced tree reports every copy missing', () => {
  const root = fixture();
  assert.deepEqual(checkDensityCopies(root).missing, [
    `${DENSITY_TARGET_DIR}/a.ts`,
    `${DENSITY_TARGET_DIR}/b.ts`,
    `${OBSERVATION_TARGET_DIR}/observation.ts`,
  ]);
});

test('a copy whose source no longer exists is stale, and --check exits 1', () => {
  const root = fixture({ extraSource: { name: 'c.ts', text: 'export const c = 3;\n' } });
  syncDensityCopies(root);
  rmSync(join(root, `${DENSITY_SOURCE_DIR}/c.ts`));
  assert.deepEqual(checkDensityCopies(root), {
    drifted: [],
    missing: [],
    stale: [`${DENSITY_TARGET_DIR}/c.ts`],
  });
  assert.equal(main(['--check'], root, silent), 1);
});

test('any extra file under a target directory is stale, and sync deletes it', () => {
  const root = fixture();
  syncDensityCopies(root);
  put(root, `${OBSERVATION_TARGET_DIR}/extra.ts`, 'export {};\n');
  put(root, `${DENSITY_TARGET_DIR}/__tests__/x.test.ts`, 'export {};\n');
  assert.deepEqual(checkDensityCopies(root).stale, [
    `${DENSITY_TARGET_DIR}/__tests__/x.test.ts`,
    `${OBSERVATION_TARGET_DIR}/extra.ts`,
  ]);
  syncDensityCopies(root);
  assert.deepEqual(checkDensityCopies(root), clean());
});

test('tests under __tests__/ are not sources and are not copied', () => {
  const root = fixture();
  assert.deepEqual([...expectedDensityCopies(root).keys()].sort(), [
    `${DENSITY_TARGET_DIR}/a.ts`,
    `${DENSITY_TARGET_DIR}/b.ts`,
    `${OBSERVATION_TARGET_DIR}/observation.ts`,
  ]);
});

test('each copy is the @generated header followed by the source, byte for byte', () => {
  const root = fixture();
  const text = expectedDensityCopies(root).get(`${DENSITY_TARGET_DIR}/a.ts`);
  assert.equal(
    text,
    `// @generated by scripts/sync-density.mjs from ${DENSITY_SOURCE_DIR}/a.ts — do not edit.\n` +
      '// Edit the canonical file, then run `npm run density:sync`; CI runs\n' +
      '// `npm run density:check` and fails on any drift.\n\n' +
      "import { b } from './b';\nexport const a = b + 1;\n"
  );
});

console.log('sync-density: a source importing outside the allowed set is refused');

const FORBIDDEN = [
  ['a bare specifier', "import { x } from 'lodash';\n", "'lodash' is a bare specifier"],
  [
    'a bare specifier naming the SDK',
    "import { y } from '@qontinui/ui-bridge';\n",
    "'@qontinui/ui-bridge' is a bare specifier",
  ],
  [
    'a relative path outside the set',
    "import { z } from '../core/registry';\n",
    "'../core/registry' is outside the allowed set",
  ],
  [
    'a sibling that is not a source',
    "import { q } from './nope';\n",
    "'./nope' is outside the allowed set",
  ],
  ['a node builtin', "import { readFileSync } from 'node:fs';\n", "'node:fs' is a Node builtin"],
  [
    'a dynamic import()',
    "export const m = () => import('./a');\n",
    'a dynamic import() is not allowed',
  ],
  ['a require()', "const fs = require('fs');\n", 'require() is not allowed'],
  [
    'a re-export from a bare specifier',
    "export { thing } from 'some-pkg';\n",
    "'some-pkg' is a bare specifier",
  ],
  ['a side-effect import', "import './polyfill';\n", "'./polyfill' is outside the allowed set"],
  [
    'a multi-line import from a builtin',
    "import {\n  readFileSync,\n  writeFileSync,\n} from 'node:fs';\n",
    "x.ts:4: 'node:fs' is a Node builtin",
  ],
];

for (const [what, text, expected] of FORBIDDEN) {
  test(`refuses ${what}`, () => {
    const problems = refusalsOf(text);
    assert.equal(problems.length, 1, `expected one refusal, got ${JSON.stringify(problems)}`);
    assert.ok(problems[0].includes(expected), `${problems[0]} does not say "${expected}"`);
  });
}

test('the envelope may import nothing, not even a sibling', () => {
  assert.deepEqual(refusalsOf("import { a } from './a';\n", { envelope: true }), [
    "x.ts:1: the Observation envelope must have zero imports (found './a')",
  ]);
});

test('a forbidden import makes both sync and --check refuse, and nothing is written', () => {
  const root = fixture({
    extraSource: { name: 'bad.ts', text: "import { readFileSync } from 'node:fs';\nexport {};\n" },
  });
  assert.throws(() => syncDensityCopies(root), /'node:fs' is a Node builtin/);
  assert.throws(() => checkDensityCopies(root), /density:sync refused/);
  assert.equal(main([], root, silent), 1);
  assert.equal(main(['--check'], root, silent), 1);
  assert.throws(() => readFileSync(join(root, `${DENSITY_TARGET_DIR}/a.ts`)), /ENOENT/);
});

console.log('sync-density: allowed shapes are not refused');

const ALLOWED = [
  ['a sibling', "import { a } from './a';\n"],
  ['a sibling with a .js extension', "import { a } from './a.js';\n"],
  ['the envelope', "import { Observation } from '../observation/observation';\n"],
  ['import type', "import type { S } from './schema';\n"],
  ['a multi-line import', "import {\n  a,\n  type A,\n} from './a';\n"],
  ['export * from a sibling', "export * from './b';\n"],
  ['export { … } from a sibling', "export {\n  a,\n  type A,\n} from './a';\n"],
  ['require( in a line comment', "// never require('fs') here\nexport {};\n"],
  ['import( in a block comment', "/* a dynamic import('x') would be refused */\nexport {};\n"],
  ['require( in a string', "export const msg = 'do not require(x)';\n"],
  ['import( in a template', 'export const msg = `no import("x")`;\n'],
  ['from in a regex', "export const re = /from 'node:fs'|require\\(/;\n"],
  ['import.meta is not an import()', 'export const u = typeof import.meta;\n'],
];

for (const [what, text] of ALLOWED) {
  test(`allows ${what}`, () => assert.deepEqual(refusalsOf(text), []));
}

test('moduleEdges reports the line of each edge', () => {
  assert.deepEqual(
    moduleEdges(
      "// c\nimport { a } from './a';\n\nexport * from './b';\nconst x = require('y');\n"
    ),
    [
      { kind: 'static', specifier: './a', line: 2 },
      { kind: 'static', specifier: './b', line: 4 },
      { kind: 'require', specifier: null, line: 5 },
    ]
  );
});

for (const root of made) rmSync(root, { recursive: true, force: true });

console.log(`\nsync-density self-test: ${passed} passed, ${failed} failed`);
if (passed === 0) {
  console.error('ERROR: no test ran');
  process.exit(1);
}
process.exit(failed === 0 ? 0 : 1);
