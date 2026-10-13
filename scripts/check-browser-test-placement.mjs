#!/usr/bin/env node
// Real-browser test placement: refuses a test file that reaches a real browser
// where ci.yml's browser-smokes job never runs it.
//
// WHY THIS EXISTS
//
// A real-Chromium test is only ever EXECUTED in ci.yml's browser-smokes job,
// the one place a Chromium is installed, and that job runs nothing but each
// package's `test:smoke`. Everywhere else such a test skips, in lint-and-test
// and on the .qontinui/ci.toml lane alike. So a test file that test:smoke does
// not select runs nowhere, and every run stays green.
// test-support/chromium-gate.mjs refuses that at run time for a test that calls
// it. This refuses it statically for a test that does NOT: one with its own
// playwright import or `executablePath(` gate (Phase 9 review, case iii).
//
// A test file reaches a real browser when it has a VALUE import of `playwright`
// or `playwright-core` (or of a package re-exporting their launchers; see
// BROWSER_MODULES), static, side-effect, dynamic or require, or an
// `executablePath(` call. Both are read from the TypeScript AST, so a comment, a
// string, a type-only import or a `vi.mock('playwright', ...)` factory, none of
// which launches anything, does not count.
//
// The test files are every TRACKED `*.test.*` / `*.spec.*` file (git ls-files),
// so the verdict is a property of the commit rather than of the working tree.
// Whether test:smoke selects one is test-support/smoke-selection.mjs, the same
// answer the runtime gate uses.
//
// Usage:
//   node scripts/check-browser-test-placement.mjs        # verify (CI)
//   node scripts/check-browser-test-placement.test.mjs   # its table tests

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { smokeSelection } from '../test-support/smoke-selection.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The packages that launch a browser: playwright and playwright-core, plus the two
// that re-export their launchers (@playwright/test exports `chromium` as well).
const BROWSER_MODULES = new Set([
  'playwright',
  'playwright-core',
  'playwright-chromium',
  '@playwright/test',
]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

function scriptKind(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/.test(file)) return ts.ScriptKind.TS;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

/** `import type { X }`, or `import { type X, type Y }` with nothing else imported. */
function typeOnly(clause) {
  if (clause.isTypeOnly) return true;
  const named = clause.namedBindings;
  return (
    clause.name === undefined &&
    named !== undefined &&
    ts.isNamedImports(named) &&
    named.elements.length > 0 &&
    named.elements.every((element) => element.isTypeOnly)
  );
}

/**
 * Where this source reaches a real browser: each value import of playwright or
 * playwright-core and each `executablePath(` call, with its line.
 */
export function browserUses(source, fileName) {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName)
  );
  const uses = [];
  const add = (node, what) =>
    uses.push({ line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, what });
  const browserModule = (node) =>
    node !== undefined && ts.isStringLiteralLike(node) && BROWSER_MODULES.has(node.text);

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && browserModule(node.moduleSpecifier)) {
      if (node.importClause === undefined || !typeOnly(node.importClause)) {
        add(node, `import from '${node.moduleSpecifier.text}'`);
      }
    } else if (
      ts.isExportDeclaration(node) &&
      browserModule(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      add(node, `export from '${node.moduleSpecifier.text}'`);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const [first] = node.arguments;
      if (callee.kind === ts.SyntaxKind.ImportKeyword && browserModule(first)) {
        add(node, `import('${first.text}')`);
      } else if (ts.isIdentifier(callee) && callee.text === 'require' && browserModule(first)) {
        add(node, `require('${first.text}')`);
      } else if (
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'executablePath') ||
        (ts.isIdentifier(callee) && callee.text === 'executablePath')
      ) {
        add(node, 'executablePath(');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return uses;
}

/**
 * Of `files` (absolute paths, with their source), those that reach a real
 * browser, and among them those test:smoke does not select.
 */
export function checkPlacement(files) {
  const reaching = [];
  const violations = [];
  for (const { file, source } of files) {
    const uses = browserUses(source, file);
    if (uses.length === 0) continue;
    reaching.push(file);
    const selection = smokeSelection(file);
    if (!selection.selected) violations.push({ file, uses, ...selection });
  }
  return { reaching, violations };
}

const rel = (file) => path.relative(REPO_ROOT, file).split(path.sep).join('/');

function describeViolation({ file, uses, packageDir, filters }) {
  const where = uses.map((use) => `line ${use.line}: ${use.what}`).join('; ');
  const why =
    filters.length > 0
      ? `its package's test:smoke (\`vitest run ${filters.join(' ')}\`) does not select it`
      : `${packageDir === null ? 'no package.json is above it' : `${rel(path.join(packageDir, 'package.json'))} has no test:smoke script running \`vitest run <filter>\``}`;
  return (
    `${rel(file)} reaches a real browser (${where}), but ${why}. ci.yml's browser-smokes ` +
    `job, the only place a Chromium is installed, runs nothing but test:smoke, so this test ` +
    `skips everywhere else and runs nowhere. Move it into a file test:smoke selects ` +
    `(a *-smoke.test.ts file), and gate it with test-support/chromium-gate.mjs.`
  );
}

function trackedTestFiles() {
  let listing;
  try {
    listing = execFileSync('git', ['ls-files', '-z'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    throw new Error(
      `git ls-files failed (${String(e.message).split('\n')[0]}). This check reads the ` +
        'TRACKED test files, so it needs git on PATH and a real work tree.'
    );
  }
  return listing.split('\0').filter((file) => TEST_FILE.test(file));
}

function main() {
  const files = trackedTestFiles().map((relative) => {
    const file = path.join(REPO_ROOT, relative);
    return { file, source: readFileSync(file, 'utf8') };
  });
  if (files.length === 0) {
    process.stderr.write(
      'browser-test placement: git ls-files listed no test files, so nothing was checked. ' +
        'Refusing to pass a check that read nothing.\n'
    );
    return 1;
  }
  const { reaching, violations } = checkPlacement(files);
  if (violations.length > 0) {
    process.stderr.write(
      `\nReal-browser test placement failed (${violations.length} file(s)):\n\n`
    );
    for (const violation of violations)
      process.stderr.write(`  - ${describeViolation(violation)}\n`);
    return 1;
  }
  process.stdout.write(
    `browser-test placement OK: ${files.length} tracked test file(s) read; ${reaching.length} ` +
      `reach a real browser directly (a value import of a Playwright package, or an ` +
      `executablePath( call), and test:smoke selects every one.\n`
  );
  return 0;
}

// Run the check only when invoked as a script: importing this module, which
// check-browser-test-placement.test.mjs does, must not start one or set an exit
// code. Both sides are resolved, so a symlinked invocation still counts as one.
const entry = process.argv[1];
const isEntry =
  entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));

if (isEntry) process.exitCode = main();
