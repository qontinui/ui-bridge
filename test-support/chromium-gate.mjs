/**
 * THE gate for every real-Chromium test in this repo. It enforces two rules, so
 * that neither is a convention a reader has to remember.
 *
 * WHERE. Each caller passes its own `import.meta.url`:
 *
 *   const PLAYWRIGHT_AVAILABLE = chromiumAvailable(import.meta.url);
 *   describe.skipIf(!PLAYWRIGHT_AVAILABLE)(...)
 *
 * and the gate THROWS, flag or no flag, unless that file is one its package's
 * `test:smoke` script selects. ci.yml's browser-smokes job is the only place a
 * Chromium is installed, and it runs nothing but `test:smoke`, so a gated test
 * anywhere else would skip in lint-and-test and run nowhere. The throw fails its
 * suite in lint-and-test instead, on the PR that put it there.
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
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/** The flag browser-smokes sets. */
export const REQUIRE_CHROMIUM_ENV = 'UI_BRIDGE_REQUIRE_CHROMIUM';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHELL_OPERATORS = new Set(['&&', '||', ';', '|']);

/**
 * The file filters a `test:smoke` script hands vitest: the words after
 * `vitest run` that are not options, up to the first shell operator. An
 * option's separate value (`--reporter dot`) would read as a filter, so spell
 * options `--flag=value`, as every `test:smoke` here does.
 */
export function smokeFilters(script) {
  const words = typeof script === 'string' ? script.split(/\s+/).filter(Boolean) : [];
  const run = words.findIndex((word, i) => word === 'run' && words[i - 1] === 'vitest');
  const filters = [];
  if (run < 0) return filters;
  for (const word of words.slice(run + 1)) {
    if (SHELL_OPERATORS.has(word)) break;
    if (!word.startsWith('-')) filters.push(word);
  }
  return filters;
}

/**
 * Whether `npm run test:smoke` runs this test file, by vitest's own rule
 * (`filterFiles` in its CLI): the file's path relative to the package root,
 * where `test:smoke` runs, lower-cased, contains one of the script's filters.
 * The package is the nearest directory above the file that holds a package.json.
 */
export function smokeSelection(testFile) {
  let packageDir = dirname(testFile);
  while (!existsSync(join(packageDir, 'package.json'))) {
    const parent = dirname(packageDir);
    if (parent === packageDir) {
      return { packageDir: null, relativePath: testFile, filters: [], selected: false };
    }
    packageDir = parent;
  }
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const filters = smokeFilters(manifest.scripts?.['test:smoke']);
  const relativePath = relative(packageDir, testFile).split(sep).join('/');
  const lower = relativePath.toLowerCase();
  return {
    packageDir,
    relativePath,
    filters,
    selected: filters.some((filter) => lower.includes(filter.toLowerCase())),
  };
}

const shown = (file) => {
  const fromRoot = relative(REPO_ROOT, file);
  return fromRoot.startsWith('..') ? file : fromRoot.split(sep).join('/');
};

/**
 * True when a Playwright Chromium is installed, false when it is not. Throws
 * when the calling test file is not one `test:smoke` selects, and, under the
 * flag, when Chromium is missing.
 *
 * @param {string} callerUrl the calling test file's `import.meta.url`
 */
export function chromiumAvailable(callerUrl) {
  if (typeof callerUrl !== 'string' || !callerUrl.startsWith('file:')) {
    throw new TypeError(
      `chromiumAvailable(import.meta.url): pass the calling test file's import.meta.url, so ` +
        `the gate can check that browser-smokes runs it (got ${String(callerUrl)}).`
    );
  }
  const testFile = fileURLToPath(callerUrl);
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
