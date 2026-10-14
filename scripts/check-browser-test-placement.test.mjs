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
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  browserUses,
  checkPlacement,
  GATE,
  isPackageSource,
  moduleFacts,
  resolveRelative,
  verdict,
} from './check-browser-test-placement.mjs';

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

/** A module reader over `modules` ({ absolute path: source }), then the real tree. */
function reader(modules) {
  return (file) => {
    if (Object.hasOwn(modules, file)) return modules[file];
    try {
      return statSync(file).isFile() ? readFileSync(file, 'utf8') : undefined;
    } catch {
      return undefined;
    }
  };
}
/** checkPlacement over one test file, with `modules` as the helpers it may import. */
const checkWith = (file, source, modules = {}) =>
  checkPlacement([{ file, source }], { read: reader(modules) });
const where = (entries) =>
  entries.map(
    (entry) =>
      `${entry.file ? `${path.relative(REPO_ROOT, entry.file)} ` : ''}${entry.line}: ${entry.what}`
  );

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
// The sixth review's probes: a browser reached through a helper (A), through
// a renamed createRequire and a computed property (B), and through a computed
// import() (D). Each went unread when only the test file was.
// ---------------------------------------------------------------------------

const HELPER = inWrapperTests('support/have-chromium.ts');
const HELPER_SOURCE = [
  "import { existsSync } from 'node:fs';",
  "import { chromium } from 'playwright';",
  '',
  'export const HAVE_CHROMIUM = existsSync(chromium.executablePath());',
].join('\n');
const USES_HELPER = [
  "import { describe, it } from 'vitest';",
  "import { HAVE_CHROMIUM } from './support/have-chromium.js';",
  "describe.skipIf(!HAVE_CHROMIUM)('a real-Chromium test', () => it('runs', () => {}));",
].join('\n');

test('(A) a non-smoke test importing a helper that gates on Chromium is refused', () => {
  const { violations, reaching } = checkWith(inWrapperTests('frame-pixels.test.ts'), USES_HELPER, {
    [HELPER]: HELPER_SOURCE,
  });
  assert.equal(violations.length, 1);
  assert.deepEqual(reaching, [inWrapperTests('frame-pixels.test.ts')]);
  assert.deepEqual(where(violations[0].uses), [
    "packages/ui-bridge-wrapper/tests/support/have-chromium.ts 2: import from 'playwright'",
    'packages/ui-bridge-wrapper/tests/support/have-chromium.ts 4: executablePath(',
  ]);
});

test('(A) the same import from a test:smoke file is admitted', () => {
  const { violations } = checkWith(inWrapperTests('frame-pixels-smoke.test.ts'), USES_HELPER, {
    [HELPER]: HELPER_SOURCE,
  });
  assert.deepEqual(violations, []);
});

test('(A) the helper is followed through a re-export and an index file', () => {
  const source = "import { HAVE_CHROMIUM } from './support';\nexport { HAVE_CHROMIUM };";
  const { violations } = checkWith(inWrapperTests('frame-pixels.test.ts'), source, {
    [inWrapperTests('support/index.ts')]: "export * from './gate-reexport.js';",
    [inWrapperTests('support/gate-reexport.ts')]:
      "export { HAVE_CHROMIUM } from './have-chromium';",
    [HELPER]: HELPER_SOURCE,
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].uses.length, 2);
});

test('(A) the helper is followed through a literal dynamic import() and require()', () => {
  for (const source of [
    "const { HAVE_CHROMIUM } = await import('./support/have-chromium.js');",
    "const { HAVE_CHROMIUM } = require('./support/have-chromium');",
    "import gate = require('./support/have-chromium');",
  ]) {
    const { violations } = checkWith(inWrapperTests('frame-pixels.test.ts'), source, {
      [HELPER]: HELPER_SOURCE,
    });
    assert.equal(violations.length, 1, source);
  }
});

test('(A) a type-only import of the helper is not followed', () => {
  const source = "import type { Gate } from './support/have-chromium.js';";
  const { violations, reaching } = checkWith(inWrapperTests('frame-pixels.test.ts'), source, {
    [HELPER]: HELPER_SOURCE,
  });
  assert.deepEqual([violations, reaching], [[], []]);
});

const CREATE_REQUIRE = [
  "import { createRequire as makeLoader } from 'node:module';",
  'const load = makeLoader(import.meta.url);',
  "const { chromium } = load('playwright');",
  "const ep = 'executable' + 'Path';",
  'export const HAVE = Boolean(chromium[ep]());',
].join('\n');

test('(B) a renamed createRequire with a computed executablePath is refused as unreadable', () => {
  const violations = refused(inWrapperTests('frame-pixels.test.ts'), CREATE_REQUIRE);
  assert.equal(violations.length, 1);
  assert.deepEqual(violations[0].uses, []);
  assert.deepEqual(where(violations[0].unreadable), ['1: createRequire']);
});

test('(B) module.createRequire in a reached helper is refused as unreadable', () => {
  const { violations } = checkWith(
    inWrapperTests('frame-pixels.test.ts'),
    "import './support/loader.mjs';",
    {
      [inWrapperTests('support/loader.mjs')]:
        "import module from 'node:module';\nconst req = module.createRequire(import.meta.url);",
    }
  );
  assert.deepEqual(where(violations[0].unreadable), [
    'packages/ui-bridge-wrapper/tests/support/loader.mjs 2: createRequire',
  ]);
});

test('(B) createRequire in a test:smoke file is admitted', () => {
  assert.deepEqual(refused(inWrapperTests('frame-pixels-smoke.test.ts'), CREATE_REQUIRE), []);
});

test('(D) import() with a computed module name is refused as unreadable', () => {
  const source = [
    "const name = ['play', 'wright'].join('');",
    'const { chromium } = await import(name);',
  ].join('\n');
  const violations = refused(inWrapperTests('frame-pixels.test.ts'), source);
  assert.equal(violations.length, 1);
  assert.deepEqual(where(violations[0].unreadable), ['2: import() with a computed specifier']);
});

test('(D) a template import() and a computed require() are refused too', () => {
  assert.deepEqual(
    moduleFacts('await import(`./${x}.js`);\nrequire(name);', 'x.test.ts').unreadable.map(
      (entry) => entry.what
    ),
    ['import() with a computed specifier', 'require() with a computed specifier']
  );
});

test('an import cycle is read once per module and ends', () => {
  const { violations } = checkWith(
    inWrapperTests('frame-pixels.test.ts'),
    "import './support/a.js';",
    {
      [inWrapperTests('support/a.ts')]: "import './b.js';",
      [inWrapperTests('support/b.ts')]:
        "import './a.js';\nimport '../frame-pixels.test.ts';\nimport './have-chromium.js';",
      [HELPER]: HELPER_SOURCE,
    }
  );
  assert.equal(violations.length, 1);
  assert.equal(violations[0].uses.length, 2);
});

test('a relative import that resolves to no file is refused as unreadable', () => {
  const violations = refused(
    inWrapperTests('frame-pixels.test.ts'),
    "import { x } from './support/no-such-helper.js';"
  );
  assert.deepEqual(where(violations[0].unreadable), [
    "1: './support/no-such-helper.js', which resolves to no file",
  ]);
});

test('an import of a file that is not code is not followed', () => {
  const { violations } = checkWith(
    inWrapperTests('frame-pixels.test.ts'),
    "import data from './fixtures/frame.json';\nimport svg from './fixtures/frame.svg?raw';",
    {
      [inWrapperTests('fixtures/frame.json')]: '{"executablePath": 1}',
      [inWrapperTests('fixtures/frame.svg')]: '<svg/>',
    }
  );
  assert.deepEqual(violations, []);
});

test('the gate itself is not followed', () => {
  const source = "import { chromiumAvailable } from '../../../test-support/chromium-gate.mjs';";
  assert.equal(
    resolveRelative(inWrapperTests('x.test.ts'), '../../../test-support/chromium-gate.mjs').file,
    GATE
  );
  assert.deepEqual(refused(inWrapperTests('frame-pixels.test.ts'), source), []);
});

test('package source is read for executablePath( alone', () => {
  const launcher = path.join(REPO_ROOT, 'packages/ui-bridge-wrapper/src/launch-fake.ts');
  assert.equal(isPackageSource(launcher), true);
  assert.equal(isPackageSource(HELPER), false);
  assert.equal(isPackageSource(path.join(REPO_ROOT, 'packages/x/src/__tests__/helper.ts')), false);
  const source = "import { launch } from '../src/launch-fake.js';";
  // Product code importing Playwright, loading by a computed specifier: not refused.
  const quiet = checkWith(inWrapperTests('frame-pixels.test.ts'), source, {
    [launcher]: "import { chromium } from 'playwright';\nawait import(name);\nimport './gone.js';",
  });
  assert.deepEqual([quiet.violations, quiet.reaching], [[], []]);
  // ...but a skip gate exported from it is.
  const gated = checkWith(inWrapperTests('frame-pixels.test.ts'), source, {
    [launcher]:
      "import { chromium } from 'playwright';\nexport const ok = chromium.executablePath();",
  });
  assert.deepEqual(where(gated.violations[0].uses), [
    'packages/ui-bridge-wrapper/src/launch-fake.ts 2: executablePath(',
  ]);
});

test("vi.importActual('playwright') reaches a browser", () => {
  assert.deepEqual(whats("const pw = await vi.importActual('playwright');"), [
    "vi.importActual('playwright')",
  ]);
});

// ---------------------------------------------------------------------------
// A chromiumAvailable() call inside a try block: its catch swallows the gate's
// throw, so the test skips silently instead. Refused even in a test:smoke file.
// ---------------------------------------------------------------------------

test('chromiumAvailable() inside a try block is refused, in a smoke file too', () => {
  const source = [
    "import { chromiumAvailable } from '../../../test-support/chromium-gate.mjs';",
    'let HAVE = false;',
    'try {',
    '  HAVE = chromiumAvailable();',
    '} catch {}',
  ].join('\n');
  const { swallowed, violations } = checkWith(inWrapperTests('frame-pixels-smoke.test.ts'), source);
  assert.deepEqual(violations, []);
  assert.deepEqual(where(swallowed), [
    'packages/ui-bridge-wrapper/tests/frame-pixels-smoke.test.ts 4: chromiumAvailable() inside a try block',
  ]);
});

test('the call is refused under a renamed import, a namespace, and in a helper', () => {
  const renamed = [
    "import { chromiumAvailable as gate } from '../../../test-support/chromium-gate.mjs';",
    'try { gate(); } catch {}',
  ].join('\n');
  assert.deepEqual(
    moduleFacts(renamed, 'x.test.ts').swallowed.map((entry) => entry.what),
    ['gate() inside a try block']
  );
  const namespace = "import * as g from './gate.mjs';\ntry { g.chromiumAvailable(); } finally {}";
  assert.equal(moduleFacts(namespace, 'x.test.ts').swallowed.length, 1);
  const shared = { [inWrapperTests('support/h.mjs')]: 'try { chromiumAvailable(); } catch {}' };
  const twice = checkPlacement(
    [
      { file: inWrapperTests('a-smoke.test.ts'), source: "import './support/h.mjs';" },
      { file: inWrapperTests('b-smoke.test.ts'), source: "import './support/h.mjs';" },
    ],
    { read: reader(shared) }
  );
  assert.equal(twice.swallowed.length, 1, 'a helper two tests share is reported once');
  const { swallowed } = checkWith(
    inWrapperTests('frame-pixels-smoke.test.ts'),
    "import './support/h.mjs';",
    {
      [inWrapperTests('support/h.mjs')]: 'try { chromiumAvailable(); } catch {}',
    }
  );
  assert.equal(swallowed.length, 1);
});

test('the call is refused under a name a relative module re-exports the gate as', () => {
  const GATE_FROM_SUPPORT = '../../../../test-support/chromium-gate.mjs';
  const smoke = inWrapperTests('frame-pixels-smoke.test.ts');
  const calling =
    "import { haveChromium } from './support/g.js';\ntry { haveChromium(); } catch {}";
  const swallowedVia = (modules, source = calling) =>
    where(checkWith(smoke, source, modules).swallowed);
  const expected = [
    'packages/ui-bridge-wrapper/tests/frame-pixels-smoke.test.ts 2: haveChromium() inside a try block',
  ];
  // export { chromiumAvailable as haveChromium } from <the gate>
  assert.deepEqual(
    swallowedVia({
      [inWrapperTests('support/g.ts')]:
        `export { chromiumAvailable as haveChromium } from '${GATE_FROM_SUPPORT}';`,
    }),
    expected
  );
  // A local export of the imported gate, under a new name.
  assert.deepEqual(
    swallowedVia({
      [inWrapperTests('support/g.ts')]: [
        `import { chromiumAvailable as gate } from '${GATE_FROM_SUPPORT}';`,
        'export { gate as haveChromium };',
      ].join('\n'),
    }),
    expected
  );
  // Through a barrel's `export *` and a second rename, imported under a third name.
  assert.deepEqual(
    swallowedVia(
      {
        [inWrapperTests('support/index.ts')]: "export * from './g.js';",
        [inWrapperTests('support/g.ts')]: "export { inner as haveChromium } from './inner.js';",
        [inWrapperTests('support/inner.ts')]:
          `export * from '${GATE_FROM_SUPPORT}';\nexport { chromiumAvailable as inner } from '${GATE_FROM_SUPPORT}';`,
      },
      "import { haveChromium as hc } from './support';\nbeforeAll(() => { try { hc(); } catch {} });"
    ),
    ['packages/ui-bridge-wrapper/tests/frame-pixels-smoke.test.ts 2: hc() inside a try block']
  );
  // Re-exported by name from a specifier this check does not follow.
  assert.deepEqual(
    swallowedVia({
      [inWrapperTests('support/g.ts')]:
        "export { chromiumAvailable as haveChromium } from '#test-support/chromium-gate.mjs';",
    }),
    expected
  );
  // A local export of a name a relative module gave the gate.
  assert.deepEqual(
    swallowedVia({
      [inWrapperTests('support/g.ts')]:
        "import { inner } from './inner.js';\nexport { inner as haveChromium };",
      [inWrapperTests('support/inner.ts')]:
        `export { chromiumAvailable as inner } from '${GATE_FROM_SUPPORT}';`,
    }),
    expected
  );
  // A re-export cycle ends, and a name that is not the gate is not refused.
  assert.deepEqual(
    swallowedVia({
      [inWrapperTests('support/g.ts')]:
        "export * from './h.js';\nexport { other as haveChromium } from './h.js';",
      [inWrapperTests('support/h.ts')]: "export * from './g.js';\nexport const other = () => true;",
    }),
    []
  );
});

test('the call is refused under a default import of a module default-exporting the gate', () => {
  const GATE_FROM_SUPPORT = '../../../../test-support/chromium-gate.mjs';
  const smoke = inWrapperTests('frame-pixels-smoke.test.ts');
  const calling = "import hc from './support/g.js';\ntry { hc(); } catch {}";
  const swallowedVia = (modules, source = calling) =>
    where(checkWith(smoke, source, modules).swallowed);
  const expected = [
    'packages/ui-bridge-wrapper/tests/frame-pixels-smoke.test.ts 2: hc() inside a try block',
  ];
  // export default <the imported gate>
  assert.deepEqual(
    swallowedVia({
      [inWrapperTests('support/g.ts')]:
        `import { chromiumAvailable } from '${GATE_FROM_SUPPORT}';\nexport default chromiumAvailable;`,
    }),
    expected
  );
  // export { chromiumAvailable as default } from <the gate>
  assert.deepEqual(
    swallowedVia({
      [inWrapperTests('support/g.ts')]:
        `export { chromiumAvailable as default } from '${GATE_FROM_SUPPORT}';`,
    }),
    expected
  );
  // export default <a name a relative module gave the gate>, imported beside a named import.
  assert.deepEqual(
    swallowedVia(
      {
        [inWrapperTests('support/g.ts')]:
          "import { inner } from './inner.js';\nexport default inner;\nexport const x = 1;",
        [inWrapperTests('support/inner.ts')]:
          `export { chromiumAvailable as inner } from '${GATE_FROM_SUPPORT}';`,
      },
      "import hc, { x } from './support/g.js';\ntry { hc(x); } catch {}"
    ),
    ['packages/ui-bridge-wrapper/tests/frame-pixels-smoke.test.ts 2: hc() inside a try block']
  );
  // `export *` forwards no default, and a default that is not the gate is not refused.
  assert.deepEqual(
    swallowedVia({
      [inWrapperTests('support/g.ts')]: "export * from './inner.js';",
      [inWrapperTests('support/inner.ts')]:
        `export { chromiumAvailable as default } from '${GATE_FROM_SUPPORT}';`,
    }),
    []
  );
  assert.deepEqual(
    swallowedVia({
      [inWrapperTests('support/g.ts')]: 'export default function hc() { return true; }',
    }),
    []
  );
});

test('import.meta.glob() is refused as unreadable, in a test file and in a helper', () => {
  const glob = "const mods = import.meta.glob('./support/*.ts', { eager: true });";
  assert.deepEqual(where(refused(inWrapperTests('frame-pixels.test.ts'), glob)[0].unreadable), [
    '1: import.meta.glob()',
  ]);
  const { violations } = checkWith(
    inWrapperTests('frame-pixels.test.ts'),
    "import './support/l.js';",
    {
      [inWrapperTests('support/l.ts')]: 'export const all = import.meta.globEager("./*.ts");',
    }
  );
  assert.deepEqual(where(violations[0].unreadable), [
    'packages/ui-bridge-wrapper/tests/support/l.ts 1: import.meta.globEager()',
  ]);
  assert.deepEqual(refused(inWrapperTests('frame-pixels-smoke.test.ts'), glob), []);
  const meta = "const u = import.meta.url;\nconst p = import.meta.resolve('./x.js');";
  assert.deepEqual(moduleFacts(meta, 'x.test.ts').unreadable, []);
});

test('the verdict fails on a swallowed call alone, and on a violation alone', () => {
  const swallowing = verdict([
    {
      file: inWrapperTests('frame-pixels-smoke.test.ts'),
      source: 'try { chromiumAvailable(); } catch {}',
    },
  ]);
  assert.equal(swallowing.status, 1);
  assert.match(swallowing.stderr, /failed \(1 finding\(s\)\)[\s\S]*inside a try block/);
  const misplaced = verdict([{ file: inWrapperTests('frame-pixels.test.ts'), source: OWN_GATE }]);
  assert.equal(misplaced.status, 1);
  assert.match(misplaced.stderr, /frame-pixels\.test\.ts reaches a real browser/);
  const clean = verdict([{ file: inWrapperTests('plain.test.ts'), source: 'x();' }]);
  assert.deepEqual([clean.status, clean.stderr], [0, '']);
  assert.equal(verdict([]).status, 1);
});

test('the call outside a try block, or in its catch or finally, is not', () => {
  const source = [
    'const HAVE = chromiumAvailable();',
    'try { x(); } catch { chromiumAvailable(); } finally { chromiumAvailable(); }',
  ].join('\n');
  assert.deepEqual(moduleFacts(source, 'x.test.ts').swallowed, []);
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

test('it reads every tracked *.test.*, *.spec.* and *.e2e.* file', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((file) => /\.(test|spec|e2e)\.[cm]?[jt]sx?$/.test(file));
  assert.ok(
    tracked.some((file) => file.endsWith('.e2e.ts')),
    'the tree has an *.e2e.ts file'
  );
  const out = execFileSync(process.execPath, [CHECK], { encoding: 'utf8' });
  assert.match(out, new RegExp(`^browser-test placement OK: ${tracked.length} tracked test file`));
});

if (failed) {
  console.error(`\n${failed} of ${failed + passed} test(s) failed.`);
  process.exit(1);
}
console.log(`\ncheck-browser-test-placement.test.mjs OK (${passed} passed)`);
