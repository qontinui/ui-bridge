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
// A module reaches a real browser when it has a VALUE import of `playwright`
// or `playwright-core` (or of a package re-exporting their launchers; see
// BROWSER_MODULES), static, side-effect, dynamic or require, or an
// `executablePath(` call. Both are read from the TypeScript AST, so a comment, a
// string, a type-only import or a `vi.mock('playwright', ...)` factory, none of
// which launches anything, does not count.
//
// A test file reaches a real browser when it does so itself OR through a module
// it imports by a RELATIVE specifier, followed transitively: static imports,
// side-effect imports, re-exports, `import x = require()`, and `import()`,
// `require()` and `vi.importActual()` with a literal specifier. So a non-test
// helper that imports playwright and exports `existsSync(chromium.executablePath())`
// is read as part of every test that imports it. test-support/chromium-gate.mjs
// itself is exempt: it is the gate, and it refuses misplaced callers at run time.
//
// A reached module that is a package's own SOURCE (under `src/`, not a test file,
// not under a test-only directory; isPackageSource) is read for the skip-gate
// shape alone, an `executablePath(` call. Product code imports Playwright and
// loads modules by computed specifiers by design (the headless launcher, the
// wrapper's transports), and unit tests import it with Playwright mocked, so
// reading it like test code would refuse every one of them.
//
// What this cannot read, it refuses in a test that test:smoke does not select:
// a `createRequire` (under any local name, the require it returns cannot be
// followed), an `import()` or `require()` whose specifier is not a literal, and
// a relative specifier that resolves to no file, each in the test file or in a
// reached module that is not package source. A test file that test:smoke selects
// is not refused for those: it runs where Chromium is installed anyway.
//
// Anywhere, test:smoke file or not, a `chromiumAvailable()` call inside a `try`
// block is refused: a `catch` around it swallows the throw that is the gate's
// whole enforcement, misplaced file and missing Chromium alike.
//
// LIMITS. Package source is read for `executablePath(` only, so a skip gate
// exported from a `src/` module that reaches Chromium another way (its own
// playwright import with a computed `chromium[ep]()`) passes. A package import is
// never followed, a workspace package included
// (`@qontinui/ui-bridge-headless`), and neither is a path alias (`@/x`): only the
// BROWSER_MODULES names count among package imports, so a skip gate living in
// another package passes. Code that reaches a browser without naming it to the
// AST passes too: a computed property on a module this check never sees as a
// browser (`launchers[name][ep]()`), `eval` and `new Function`,
// `process.getBuiltinModule('module')['create' + 'Require']`, and a
// `chromiumAvailable` bound by destructuring a dynamic import. Helpers are read
// from the working tree, the test files from the commit.
//
// The test files are every TRACKED `*.test.*`, `*.spec.*` and `*.e2e.*` file
// (git ls-files), so the verdict is a property of the commit rather than of the
// working tree. Whether test:smoke selects one is test-support/smoke-selection.mjs,
// the same answer the runtime gate uses.
//
// Usage:
//   node scripts/check-browser-test-placement.mjs        # verify (CI)
//   node scripts/check-browser-test-placement.test.mjs   # its table tests

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
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
const TEST_FILE = /\.(test|spec|e2e)\.[cm]?[jt]sx?$/;
/** The one module this check does not read or follow into: the gate itself. */
export const GATE = path.join(REPO_ROOT, 'test-support', 'chromium-gate.mjs');
const SCRIPT = /\.[cm]?[jt]sx?$/;
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
/** A compiled specifier names its TypeScript source too: `./x.js` is `./x.ts`. */
const TS_SOURCES = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] };

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

const relative = (node) =>
  node !== undefined && ts.isStringLiteralLike(node) && /^\.\.?(\/|$)/.test(node.text);

/**
 * What one module's source says, read from its AST:
 * - `uses`: where it reaches a real browser, each value import of a
 *   BROWSER_MODULES package and each `executablePath(` call;
 * - `imports`: the relative specifiers it loads at run time, to follow;
 * - `unreadable`: what loads code this check cannot follow;
 * - `swallowed`: each `chromiumAvailable()` call inside a `try` block.
 * Each entry carries its line.
 */
export function moduleFacts(source, fileName) {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName)
  );
  const facts = { uses: [], imports: [], unreadable: [], swallowed: [] };
  const lineOf = (node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const add = (list, node, what) => facts[list].push({ line: lineOf(node), what });
  const browserModule = (node) =>
    node !== undefined && ts.isStringLiteralLike(node) && BROWSER_MODULES.has(node.text);

  // The local names chromiumAvailable is imported under (`as gate`).
  const gateNames = new Set(['chromiumAvailable']);
  for (const statement of file.statements) {
    const named = statement.importClause?.namedBindings;
    if (!ts.isImportDeclaration(statement) || named === undefined || !ts.isNamedImports(named))
      continue;
    for (const element of named.elements) {
      if ((element.propertyName ?? element.name).text === 'chromiumAvailable')
        gateNames.add(element.name.text);
    }
  }

  /** A module loaded by `how` from `specifier`: a browser, a file to follow, or unreadable. */
  const loads = (node, how, specifier) => {
    if (browserModule(specifier)) add('uses', node, `${how}('${specifier.text}')`);
    else if (relative(specifier))
      facts.imports.push({ line: lineOf(node), specifier: specifier.text });
    else if (specifier === undefined || !ts.isStringLiteralLike(specifier))
      add('unreadable', node, `${how}() with a computed specifier`);
  };

  const visit = (node, inTry) => {
    if (ts.isTryStatement(node)) {
      visit(node.tryBlock, true);
      if (node.catchClause) visit(node.catchClause, inTry);
      if (node.finallyBlock) visit(node.finallyBlock, inTry);
      return;
    }
    if (ts.isImportDeclaration(node)) {
      const typeOnlyImport = node.importClause !== undefined && typeOnly(node.importClause);
      if (browserModule(node.moduleSpecifier) && !typeOnlyImport) {
        add('uses', node, `import from '${node.moduleSpecifier.text}'`);
      } else if (relative(node.moduleSpecifier) && !typeOnlyImport) {
        facts.imports.push({ line: lineOf(node), specifier: node.moduleSpecifier.text });
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      if (browserModule(node.moduleSpecifier)) {
        add('uses', node, `export from '${node.moduleSpecifier.text}'`);
      } else if (relative(node.moduleSpecifier)) {
        facts.imports.push({ line: lineOf(node), specifier: node.moduleSpecifier.text });
      }
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      loads(node, 'require', node.moduleReference.expression);
    } else if (ts.isIdentifier(node) && node.text === 'createRequire') {
      add('unreadable', node, 'createRequire');
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const [first] = node.arguments;
      const calleeName = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : undefined;
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        loads(node, 'import', first);
      } else if (ts.isIdentifier(callee) && callee.text === 'require') {
        loads(node, 'require', first);
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        (calleeName === 'importActual' || calleeName === 'requireActual')
      ) {
        loads(node, `vi.${calleeName}`, first);
      } else if (calleeName === 'executablePath') {
        add('uses', node, 'executablePath(');
      } else if (
        inTry &&
        ((ts.isIdentifier(callee) && gateNames.has(callee.text)) ||
          (ts.isPropertyAccessExpression(callee) && calleeName === 'chromiumAvailable'))
      ) {
        add('swallowed', node, `${callee.getText(file)}() inside a try block`);
      }
    }
    ts.forEachChild(node, (child) => visit(child, inTry));
  };
  visit(file, false);
  return facts;
}

/**
 * Where this source reaches a real browser by itself: each value import of
 * playwright or playwright-core and each `executablePath(` call, with its line.
 */
export function browserUses(source, fileName) {
  return moduleFacts(source, fileName).uses;
}

/**
 * Whether a module is a package's own source rather than test code: under a
 * `src/` directory, and neither a test file nor under a test-only directory.
 */
export function isPackageSource(file) {
  const where = path.relative(REPO_ROOT, file).split(path.sep).join('/');
  return (
    /(^|\/)src\//.test(where) &&
    !TEST_FILE.test(where) &&
    !/(^|\/)(__tests__|__mocks__|tests?|test-support|test-utils|testing|fixtures)\//.test(where)
  );
}

/** The working tree's file at `file`, or undefined when there is no such file. */
function readFromDisk(file) {
  try {
    return statSync(file).isFile() ? readFileSync(file, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The module a relative `specifier` in `fromFile` loads, as node and the
 * TypeScript bundlers here resolve it: `{ file }`, `{ asset: true }` for a file
 * that is not code (`./x.json`, `./x.css`), or `{}` when it names no file.
 */
export function resolveRelative(fromFile, specifier, read = readFromDisk) {
  const target = path.resolve(path.dirname(fromFile), specifier.replace(/[?#].*$/, ''));
  const ext = path.extname(target);
  const candidates = [];
  if (SCRIPT.test(target)) {
    candidates.push(
      target,
      ...(TS_SOURCES[ext] ?? []).map((ts) => target.slice(0, -ext.length) + ts)
    );
  }
  candidates.push(
    ...EXTENSIONS.map((e) => target + e),
    ...EXTENSIONS.map((e) => path.join(target, `index${e}`))
  );
  for (const candidate of candidates) {
    if (read(candidate) !== undefined) return { file: candidate };
  }
  return read(target) !== undefined ? { asset: true } : {};
}

/**
 * Of `files` (absolute paths, with their source), those that reach a real
 * browser, themselves or through the relative imports they follow; among them
 * the `violations`, those test:smoke does not select (with what they reach and
 * what cannot be read); and `swallowed`, every `chromiumAvailable()` call in a
 * `try` block in any test file or module one reaches. `read` returns a module's
 * source, or undefined when the file does not exist.
 */
export function checkPlacement(files, { read = readFromDisk } = {}) {
  const given = new Map(files.map(({ file, source }) => [file, source]));
  const sourceOf = (file) => (given.has(file) ? given.get(file) : read(file));
  const cache = new Map();
  const factsOf = (file) => {
    if (!cache.has(file)) cache.set(file, moduleFacts(sourceOf(file), file));
    return cache.get(file);
  };

  const reaching = [];
  const violations = [];
  const swallowed = [];
  const swallowedSeen = new Set();
  for (const { file } of files) {
    const uses = [];
    const unreadable = [];
    const seen = new Set([file]);
    const queue = [file];
    while (queue.length > 0) {
      const module = queue.shift();
      const facts = factsOf(module);
      const where = (entry) => (module === file ? entry : { ...entry, file: module });
      // Package source is read for the skip-gate shape alone (see the header).
      const product = module !== file && isPackageSource(module);
      uses.push(
        ...facts.uses.filter((use) => !product || use.what === 'executablePath(').map(where)
      );
      if (!product) unreadable.push(...facts.unreadable.map(where));
      if (!swallowedSeen.has(module)) {
        swallowedSeen.add(module);
        swallowed.push(...facts.swallowed.map((entry) => ({ ...entry, file: module })));
      }
      for (const { line, specifier } of facts.imports) {
        const resolved = resolveRelative(module, specifier, sourceOf);
        if (resolved.asset) continue;
        if (resolved.file === undefined) {
          if (product) continue;
          unreadable.push(where({ line, what: `'${specifier}', which resolves to no file` }));
        } else if (resolved.file !== GATE && !seen.has(resolved.file)) {
          seen.add(resolved.file);
          queue.push(resolved.file);
        }
      }
    }
    if (uses.length > 0) reaching.push(file);
    if (uses.length === 0 && unreadable.length === 0) continue;
    const selection = smokeSelection(file);
    if (!selection.selected) violations.push({ file, uses, unreadable, ...selection });
  }
  return { reaching, violations, swallowed };
}

const rel = (file) => path.relative(REPO_ROOT, file).split(path.sep).join('/');

const describeFinding = (entry) =>
  `${entry.file ? `${rel(entry.file)} ` : ''}line ${entry.line}: ${entry.what}`;

function describeViolation({ file, uses, unreadable, packageDir, filters }) {
  const why =
    filters.length > 0
      ? `its package's test:smoke (\`vitest run ${filters.join(' ')}\`) does not select it`
      : `${packageDir === null ? 'no package.json is above it' : `${rel(path.join(packageDir, 'package.json'))} has no test:smoke script running \`vitest run <filter>\``}`;
  const reaches =
    uses.length > 0 ? `reaches a real browser (${uses.map(describeFinding).join('; ')})` : '';
  const cannot =
    unreadable.length > 0
      ? `loads code this check cannot read (${unreadable.map(describeFinding).join('; ')})`
      : '';
  return (
    `${rel(file)} ${[reaches, cannot].filter(Boolean).join(' and ')}, but ${why}. ci.yml's ` +
    `browser-smokes job, the only place a Chromium is installed, runs nothing but test:smoke, ` +
    `so a real-browser test here skips everywhere else and runs nowhere. ` +
    (uses.length > 0
      ? 'Move it into a file test:smoke selects (a *-smoke.test.ts file), and gate it with ' +
        'test-support/chromium-gate.mjs.'
      : 'Load the module by a literal relative or package specifier, so this check can read it, ' +
        'or move the test into a file test:smoke selects.')
  );
}

function describeSwallowed(entry) {
  return (
    `${describeFinding(entry)}. A catch around chromiumAvailable() swallows the throw that refuses a ` +
    `test:smoke-unselected file and, under UI_BRIDGE_REQUIRE_CHROMIUM=1, a missing ` +
    `Chromium: call it outside any try block.`
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

/**
 * The check's verdict on `files`, as the script prints it: `{ status, stdout,
 * stderr }`, status 0 when every file passes, 1 on any finding or when there is
 * no file to read.
 */
export function verdict(files, options) {
  if (files.length === 0) {
    return {
      status: 1,
      stdout: '',
      stderr:
        'browser-test placement: git ls-files listed no test files, so nothing was checked. ' +
        'Refusing to pass a check that read nothing.\n',
    };
  }
  const { reaching, violations, swallowed } = checkPlacement(files, options);
  if (violations.length > 0 || swallowed.length > 0) {
    const findings = [...violations.map(describeViolation), ...swallowed.map(describeSwallowed)];
    return {
      status: 1,
      stdout: '',
      stderr:
        `\nReal-browser test placement failed (${findings.length} finding(s)):\n\n` +
        findings.map((finding) => `  - ${finding}\n`).join(''),
    };
  }
  return {
    status: 0,
    stdout:
      `browser-test placement OK: ${files.length} tracked test file(s) read; ${reaching.length} ` +
      `reach a real browser, themselves or through a relative import (a value import of a ` +
      `Playwright package, or an executablePath( call), and test:smoke selects every one.\n`,
    stderr: '',
  };
}

function main() {
  const files = trackedTestFiles().map((relative) => {
    const file = path.join(REPO_ROOT, relative);
    return { file, source: readFileSync(file, 'utf8') };
  });
  const { status, stdout, stderr } = verdict(files);
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  return status;
}

// Run the check only when invoked as a script: importing this module, which
// check-browser-test-placement.test.mjs does, must not start one or set an exit
// code. Both sides are resolved, so a symlinked invocation still counts as one.
const entry = process.argv[1];
const isEntry =
  entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));

if (isEntry) process.exitCode = main();
