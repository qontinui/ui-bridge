/**
 * Which test files `npm run test:smoke` runs: the one answer both placement
 * checks share. chromium-gate.mjs asks it at run time about the test file vitest
 * is collecting; scripts/check-browser-test-placement.mjs asks it about every
 * tracked test file that reaches a real browser. ci.yml's browser-smokes job,
 * the only place a Chromium is installed, runs nothing but test:smoke.
 *
 * Imports nothing but node built-ins, so the CI check can load it without
 * loading Playwright.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

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
