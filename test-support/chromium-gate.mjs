/**
 * THE gate for every real-Chromium test in this repo. It enforces two rules, so
 * that neither is a convention a reader has to remember.
 *
 *   const PLAYWRIGHT_AVAILABLE = chromiumAvailable();
 *   describe.skipIf(!PLAYWRIGHT_AVAILABLE)(...)
 *
 * WHERE. The gate THROWS, flag or no flag, unless the test file vitest is
 * collecting is one its package's `test:smoke` script selects
 * (smoke-selection.mjs). ci.yml's browser-smokes job is the only place a
 * Chromium is installed, and it runs nothing but `test:smoke`, so a gated test
 * anywhere else would skip in lint-and-test and run nowhere. The throw fails its
 * suite in lint-and-test instead, on the PR that put it there.
 *
 * The file comes from vitest's runtime (`expect.getState().testPath`), never
 * from the caller, so neither a helper whose own name says "smoke" nor a
 * made-up URL can admit a test file that test:smoke does not run. It takes no
 * argument, and refuses one. LIMIT: a helper that calls the gate is judged
 * against each test file that imports it only because every vitest config here
 * isolates test files, which is vitest's default. Under `isolate: false` a
 * cached helper is evaluated, and judged, for its first importer alone.
 *
 * A test that gates on Chromium WITHOUT this gate (its own playwright import or
 * `executablePath(` call) is the other half: scripts/check-browser-test-placement.mjs
 * refuses one outside a test:smoke file, in its own lint-and-test step.
 *
 * WHETHER. With no Playwright Chromium installed a gated test skips, which is
 * right on a developer box, in lint-and-test and on the .qontinui/ci.toml lane,
 * none of which install a browser. Under UI_BRIDGE_REQUIRE_CHROMIUM=1, which
 * ONLY browser-smokes sets, a missing Chromium THROWS instead: that run exists
 * to execute them. `assert-no-skipped-tests.mjs` beside this file catches a test
 * that skips there for any other reason.
 *
 * Plain .mjs with a .d.mts beside it, so a type-checked test inside a package
 * whose rootDir is `src` (ui-bridge-headless) can import it.
 */
import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from 'vitest';
import { smokeSelection } from './smoke-selection.mjs';

/** The flag browser-smokes sets. */
export const REQUIRE_CHROMIUM_ENV = 'UI_BRIDGE_REQUIRE_CHROMIUM';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const shown = (file) => {
  const fromRoot = relative(REPO_ROOT, file);
  return fromRoot.startsWith('..') ? file : fromRoot.split(sep).join('/');
};

/** The test file vitest is collecting or running in this worker. */
function runningTestFile() {
  let testPath;
  try {
    testPath = expect.getState().testPath;
  } catch {
    testPath = undefined;
  }
  if (typeof testPath !== 'string' || testPath === '') {
    throw new Error(
      'chromiumAvailable() must be called while vitest collects or runs a test file: it ' +
        "reads that file from vitest's runtime (expect.getState().testPath) and found none."
    );
  }
  return testPath;
}

/**
 * True when a Playwright Chromium is installed, false when it is not. Throws
 * when the test file vitest is collecting is not one `test:smoke` selects, and,
 * under the flag, when Chromium is missing.
 */
export function chromiumAvailable(...args) {
  if (args.length > 0) {
    throw new TypeError(
      'chromiumAvailable() takes no argument: the test file it checks comes from vitest, ' +
        `not from the caller (got ${String(args[0])}).`
    );
  }
  const testFile = runningTestFile();
  const { packageDir, filters, selected } = smokeSelection(testFile);
  if (!selected) {
    let reason = `its package's test:smoke (\`vitest run ${filters.join(' ')}\`) does not select it`;
    let fix = `Move the test into a file whose path contains "${filters[0]}", such as *-smoke.test.ts.`;
    if (filters.length === 0) {
      reason =
        packageDir === null
          ? 'no package.json is above it'
          : `${shown(join(packageDir, 'package.json'))} has no test:smoke script running ` +
            '`vitest run <filter>`';
      fix = "Give its package a test:smoke script like packages/ui-bridge-wrapper's.";
    }
    throw new Error(
      `${shown(testFile)} runs a real-Chromium test, but ${reason}, and ci.yml's browser-smokes ` +
        `job runs nothing else: it would skip in lint-and-test and run nowhere. ${fix}`
    );
  }

  let executable = '<unresolved>';
  let present = false;
  try {
    executable = chromium.executablePath();
    present = existsSync(executable);
  } catch {
    present = false;
  }
  if (!present && process.env[REQUIRE_CHROMIUM_ENV] === '1') {
    throw new Error(
      `${REQUIRE_CHROMIUM_ENV}=1, but there is no Playwright Chromium at ${executable}: ` +
        `every real-Chromium test would skip, and this run exists to execute them. ` +
        `Install it with \`npx playwright install chromium\`.`
    );
  }
  return present;
}
