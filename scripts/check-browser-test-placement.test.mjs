#!/usr/bin/env node
/**
 * Table-driven tests for scripts/check-browser-test-placement.mjs: which test
 * files reach a real browser, and that one test:smoke does not select is
 * refused.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The check's misses are silent. A test it does not recognise as reaching a
 * browser passes it, then skips in every lane but browser-smokes, which never
 * runs it, so every run stays green. Review found exactly that: a non-smoke
 * test with its OWN `existsSync(chromium.executablePath())` gate (case iii)
 * passed lint-and-test by skipping. It is pinned first below, then each other
 * way a test file reaches a browser, then the shapes that must NOT count
 * (a type-only import, a vi.mock factory, a comment, a string), whose false
 * positives would block a correct test.
 *
 * The files need not exist: selection reads only the path and the real
 * package.json above it.
 *
 * Usage:  node scripts/check-browser-test-placement.test.mjs
 * Exit:   0 all passed / 1 one or more failed
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { browserUses, checkPlacement } from './check-browser-test-placement.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(REPO_ROOT, 'scripts', 'check-browser-test-placement.mjs');
const inWrapperTests = (name) => path.join(REPO_ROOT, 'packages/ui-bridge-wrapper/tests', name);

let failed = 0;
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${e.message.split('\n').slice(0, 6).join('\n       ')}`);
  }
}

const whats = (source, file = 'x.test.ts') => browserUses(source, file).map((use) => use.what);
const refused = (file, source) => checkPlacement([{ file, source }]).violations;

// Review case (iii): a test that gates on Chromium with no shared gate at all.
const OWN_GATE = [
  "import { existsSync } from 'node:fs';",
  "import { chromium } from 'playwright';",
  "import { describe, expect, it } from 'vitest';",
  '',
  'const PLAYWRIGHT_AVAILABLE = existsSync(chromium.executablePath());',
  '',
  "describe.skipIf(!PLAYWRIGHT_AVAILABLE)('a real-Chromium test', () => {",
  "  it('runs', () => expect(PLAYWRIGHT_AVAILABLE).toBe(true));",
  '});',
].join('\n');

test('(iii) a non-smoke test with its own executablePath( gate is refused', () => {
  const violations = refused(inWrapperTests('frame-pixels.test.ts'), OWN_GATE);
  assert.equal(violations.length, 1);
  assert.deepEqual(
    violations[0].uses.map((use) => `${use.line}: ${use.what}`),
    ["2: import from 'playwright'", '5: executablePath(']
  );
  assert.deepEqual(violations[0].filters, ['smoke']);
});

test('(iii) the same test in a file test:smoke selects is admitted', () => {
  assert.deepEqual(refused(inWrapperTests('frame-pixels-smoke.test.ts'), OWN_GATE), []);
});

test('an executablePath( call alone reaches a browser', () => {
  const source = 'const { chromium } = await browsers();\nexistsSync(chromium.executablePath?.());';
  assert.deepEqual(whats(source), ['executablePath(']);
  assert.equal(refused(inWrapperTests('frame-pixels.test.ts'), source).length, 1);
});

test('a bare executablePath( call reaches a browser', () => {
  assert.deepEqual(whats("import { executablePath } from './x';\nexecutablePath();"), [
    'executablePath(',
  ]);
});

test("a dynamic import('playwright-core') reaches a browser", () => {
  assert.deepEqual(whats("const { chromium } = await import('playwright-core');"), [
    "import('playwright-core')",
  ]);
});

test("require('playwright') reaches a browser", () => {
  assert.deepEqual(whats("const { chromium } = require('playwright');", 'x.test.cjs'), [
    "require('playwright')",
  ]);
});

test("a side-effect import 'playwright' reaches a browser", () => {
  assert.deepEqual(whats("import 'playwright';"), ["import from 'playwright'"]);
});

test('a default or namespace import reaches a browser', () => {
  assert.deepEqual(
    whats("import pw from 'playwright';\nimport * as core from 'playwright-core';"),
    ["import from 'playwright'", "import from 'playwright-core'"]
  );
});

test('an import mixing a type with a value reaches a browser', () => {
  assert.deepEqual(whats("import { chromium, type Page } from 'playwright';"), [
    "import from 'playwright'",
  ]);
});

test('a type-only import does not', () => {
  assert.deepEqual(whats("import type { Page } from 'playwright';"), []);
  assert.deepEqual(whats("import { type Browser, type Page } from 'playwright-core';"), []);
});

test('a vi.mock factory does not, executablePath included', () => {
  const source = [
    "import { vi } from 'vitest';",
    "vi.mock('playwright', () => ({ chromium: { executablePath: () => '/no/browser' } }));",
  ].join('\n');
  assert.deepEqual(whats(source), []);
});

test('a comment or a string naming either does not', () => {
  const source = [
    "// executablePath() is what the real smokes probe; import { chromium } from 'playwright'",
    'const note = "chromium.executablePath() and import(\'playwright\')";',
    "const argv = ['npx', 'playwright', 'install', 'chromium'];",
  ].join('\n');
  assert.deepEqual(whats(source), []);
});

test('a package re-exporting the launchers reaches a browser', () => {
  assert.deepEqual(whats("import { chromium } from '@playwright/test';"), [
    "import from '@playwright/test'",
  ]);
  assert.deepEqual(whats("import { chromium } from 'playwright-chromium';"), [
    "import from 'playwright-chromium'",
  ]);
});

test('a local module named like the browser is not the browser', () => {
  assert.deepEqual(whats("import { chromium } from './playwright';"), []);
});

test('a test file in a package with no test:smoke is refused', () => {
  const violations = refused(path.join(REPO_ROOT, 'e2e', 'tests', 'browser.test.ts'), OWN_GATE);
  assert.equal(violations.length, 1);
  assert.deepEqual(violations[0].filters, []);
});

test('a test file reaching nothing is not counted at all', () => {
  const { reaching, violations } = checkPlacement([
    { file: inWrapperTests('plain.test.ts'), source: "import { it } from 'vitest';" },
  ]);
  assert.deepEqual([reaching, violations], [[], []]);
});

// ---------------------------------------------------------------------------
// The entry-point split, and the tracked tree. Importing the check must not run
// it, or every case above would run a whole-repo check as a side effect; and a
// check that ran nothing when invoked would exit 0, silently.
// ---------------------------------------------------------------------------

test('importing the check does not run it', () => {
  const out = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(pathToFileURL(CHECK).href)}); console.log('quiet');`,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(out.trim(), 'quiet');
});

test('running it as a script checks the tracked tree, which passes', () => {
  const out = execFileSync(process.execPath, [CHECK], { encoding: 'utf8' });
  assert.match(
    out,
    /^browser-test placement OK: \d+ tracked test file\(s\) read; \d+ reach a real browser/
  );
});

if (failed) {
  console.error(`\n${failed} of ${failed + passed} test(s) failed.`);
  process.exit(1);
}
console.log(`\ncheck-browser-test-placement.test.mjs OK (${passed} passed)`);
