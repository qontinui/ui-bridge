#!/usr/bin/env node
// Dynamic-import hint ratchet — refuses a built package whose dist carries an
// `import()` with a computed specifier that a consumer's bundler would try, and
// fail, to resolve.
//
// WHY THIS EXISTS
//
// `@qontinui/ui-bridge`'s Redis relay bus used to load ioredis with
// `const specifier = 'ioredis'; await import(specifier)`. The variable kept tsc
// and tsup from resolving what was then an optional dependency, and it shipped
// as a bare `import(specifier)` in dist/server/index.{js,mjs}. A consumer that
// BUNDLES the SDK — qontinui-web's Next.js route handlers, through webpack —
// cannot resolve a computed request at build time, so webpack turns it into an
// expression context ("Critical dependency: the request of a dependency is an
// expression") whose runtime lookup throws `Cannot find module 'ioredis'`, even
// though ioredis was installed and traced into the function. The deployed relay
// bus never started (plan 2026-11-09-webpack-bundles-the-relay-sdks-ioredis-
// import-so-the-deployed-relay-bus-never-starts, Why 1-2). ui-bridge-wrapper's
// import of its optional peer @qontinui/ui-bridge-headless had the same shape.
//
// An import that has to stay computed is fixed with the magic comments the SDK's
// Tauri loader carries (packages/ui-bridge/src/ai/change-tracker.ts,
// `loadTauriEventModule`): `webpackIgnore: true` tells webpack, and
// `turbopackIgnore: true` tells Turbopack, to leave the import to the runtime.
// tsup keeps those comments in dist — but nothing checked that EVERY computed
// import carried them, so the next one would have shipped bare too.
//
// WHAT IT CHECKS
//
// Every `import(...)` in packages/*/dist/**/*.{js,mjs,cjs} whose specifier is
// not a string literal must carry BOTH `webpackIgnore: true` and
// `turbopackIgnore: true`, in a comment inside the call's parentheses — where
// both bundlers read them. Files are PARSED with the TypeScript compiler (which
// the root `npm ci` already installs), not grepped: tsup splits a commented call
// across lines, and a parser cannot take `import(` inside a string or a comment
// for a call.
//
// A literal specifier (`import('ws')`) is not checked: a bundler resolves it at
// build time like a static import, so it is bundled, or the consumer's build
// fails loudly — never the silent runtime miss this check exists to stop.
//
// EXCLUDED: `**/*.global.js`. Those are tsup `iife` bundles (today
// packages/ui-bridge/dist/injected/bundle.global.js) that a driver reads as a
// FILE and injects into a page with Playwright's `addInitScript`: no consumer
// bundler parses them. They are also built with `minify: true`, which strips
// every comment, so a hint could not survive into them anyway.
//
// EXCLUDED: every package whose package.json says `"private": true` (today
// packages/ui-bridge-extension). A private package is never published, so no
// consumer's bundler ever reads its dist: the extension's dist is loaded by
// Chrome from its manifest. Its esbuild bundles also inline ui-bridge-wrapper's
// SOURCE and drop every comment, so the wrapper's hinted import of its optional
// headless peer reappears bare there; the wrapper's OWN dist, which is what a
// consumer installs, is checked. Excluded packages are named in the tally.
//
// A RUN THAT CHECKED NOTHING IS NOT A PASS. It exits 2 (UNKNOWN), never 0, when
// it finds no dist file to read; when a workspace package that declares a
// `build` script has no dist/ (a partial build would otherwise pass on whatever
// happened to be built); or when a dist file does not parse (its imports were
// never read). A definite failure (exit 1) outranks an UNKNOWN.
//
// Usage:
//   node scripts/check-dynamic-import-hints.cjs              # verify packages/*/dist (CI, after "Build again")
//   node scripts/check-dynamic-import-hints.cjs --root <dir> # verify <dir>/packages/*/dist (the self-test's fixtures)
//   node scripts/check-dynamic-import-hints.test.cjs         # the fixture self-test
//
// Exit codes: 0 every computed import() carries both hints / 1 at least one does
// not / 2 UNKNOWN — nothing, or not everything, was checked.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

/** The comments a computed `import()` must carry, each read inside the call's parentheses. */
const REQUIRED_HINTS = [
  { name: 'webpackIgnore: true', pattern: /\bwebpackIgnore\s*:\s*true\b/ },
  { name: 'turbopackIgnore: true', pattern: /\bturbopackIgnore\s*:\s*true\b/ },
];

const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

/** tsup `iife` bundles: injected as files, never parsed by a consumer bundler (header). */
const EXCLUDED_SUFFIX = '.global.js';

const HINTED_FORM =
  'import(/* @vite-ignore */ /* turbopackIgnore: true */ /* webpackIgnore: true */ specifier)';

function parseArgs(argv) {
  let root = path.resolve(__dirname, '..');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--root' && argv[i + 1]) {
      root = path.resolve(argv[i + 1]);
      i += 1;
    } else {
      process.stderr.write(
        `check-dynamic-import-hints: unknown argument ${JSON.stringify(argv[i])}\n`
      );
      process.exit(2);
    }
  }
  return { root };
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** `pkgDir/package.json`, or null when there is none (e.g. packages/ui-bridge-python). */
function readManifest(pkgDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** True when the manifest declares a `build` script, so the package should have a dist/. */
function declaresBuild(pkg) {
  return Boolean(pkg) && typeof (pkg.scripts && pkg.scripts.build) === 'string';
}

function walk(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort(byName)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, onFile);
    else if (entry.isFile()) onFile(full);
  }
}

/** Every dist file the check reads, the ones it deliberately skips, and the packages it could not read. */
function collectTargets(root) {
  const targets = { files: [], excluded: [], unbuilt: [], privatePackages: [], packages: 0 };
  const packagesDir = path.join(root, 'packages');
  if (!fs.existsSync(packagesDir)) return targets;

  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true }).sort(byName)) {
    if (!entry.isDirectory()) continue;
    const pkgDir = path.join(packagesDir, entry.name);
    const distDir = path.join(pkgDir, 'dist');
    const manifest = readManifest(pkgDir);
    if (manifest && manifest.private === true) {
      targets.privatePackages.push(entry.name); // never published, so never bundled by a consumer (header)
      continue;
    }
    if (!fs.existsSync(distDir)) {
      if (declaresBuild(manifest)) targets.unbuilt.push(entry.name);
      continue;
    }
    targets.packages += 1;
    walk(distDir, (file) => {
      if (!SCANNED_EXTENSIONS.has(path.extname(file))) return;
      if (file.endsWith(EXCLUDED_SUFFIX)) targets.excluded.push(file);
      else targets.files.push(file);
    });
  }
  return targets;
}

/**
 * The comment trivia ts reports at `pos`. A run of trivia is split between the
 * two calls — "trailing" is what sits on pos's own line, "leading" what follows
 * the first newline — so both are read to see every comment in it.
 */
function commentsAt(text, pos) {
  return [
    ...(ts.getTrailingCommentRanges(text, pos) || []),
    ...(ts.getLeadingCommentRanges(text, pos) || []),
  ];
}

/** The text of every comment inside `call`'s parentheses, wherever between the tokens it sits. */
function commentsInside(call, text) {
  const found = new Map();
  const collect = (pos) => {
    for (const range of commentsAt(text, pos)) {
      if (range.pos >= call.expression.end && range.end <= call.end) {
        found.set(range.pos, text.slice(range.pos, range.end));
      }
    }
  };
  collect(call.expression.end); // between `import` and `(`
  collect(call.arguments.end); // after a trailing comma
  const visit = (node) => {
    collect(node.pos);
    collect(node.end);
    ts.forEachChild(node, visit);
  };
  call.arguments.forEach(visit);
  return [...found.values()];
}

function isLiteralSpecifier(node) {
  return Boolean(node) && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
}

/** Parse one file and classify each `import()` in it. */
function scanFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

  // `parseDiagnostics` is the parser's own error list. An AST built from a file
  // that did not parse can be missing the very call this check looks for, so a
  // file with any parse error, or a compiler that no longer exposes the list,
  // counts as NOT READ rather than as clean.
  if (!Array.isArray(source.parseDiagnostics)) {
    return {
      unreadable: 'this typescript version exposes no parseDiagnostics to confirm the parse',
    };
  }
  if (source.parseDiagnostics.length > 0) {
    const first = source.parseDiagnostics[0];
    const { line } = source.getLineAndCharacterOfPosition(first.start || 0);
    const message = ts.flattenDiagnosticMessageText(first.messageText, ' ');
    return { unreadable: `does not parse (line ${line + 1}: ${message})` };
  }

  const imports = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      if (isLiteralSpecifier(specifier)) {
        imports.push({ literal: true });
      } else {
        const comments = commentsInside(node, text);
        const missing = REQUIRED_HINTS.filter(
          (hint) => !comments.some((c) => hint.pattern.test(c))
        ).map((hint) => hint.name);
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
        imports.push({
          literal: false,
          missing,
          line: line + 1,
          column: character + 1,
          specifier: specifier ? specifier.getText(source).replace(/\s+/g, ' ').slice(0, 80) : '',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports };
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const rel = (file) => path.relative(root, file).split(path.sep).join('/');

  const targets = collectTargets(root);
  const unhinted = [];
  const unreadable = [];
  let hinted = 0;
  let literal = 0;

  for (const file of targets.files) {
    const result = scanFile(file);
    if (result.unreadable) {
      unreadable.push(`${rel(file)}: ${result.unreadable}`);
      continue;
    }
    for (const found of result.imports) {
      if (found.literal) literal += 1;
      else if (found.missing.length === 0) hinted += 1;
      else unhinted.push({ ...found, file: rel(file) });
    }
  }

  const tally =
    `${targets.files.length} file(s) in ${targets.packages} package dist(s); ` +
    `${literal} literal-specifier import() call(s) not checked; ` +
    `${targets.excluded.length} ${EXCLUDED_SUFFIX} file(s) excluded; ` +
    `${targets.privatePackages.length} private package(s) excluded` +
    (targets.privatePackages.length > 0 ? ` (${targets.privatePackages.join(', ')})` : '');

  const unknown = [];
  if (targets.files.length === 0) {
    unknown.push(
      `no built file to read under ${rel(path.join(root, 'packages'))}/*/dist — run \`npm run build\` first`
    );
  }
  for (const name of targets.unbuilt) {
    unknown.push(
      `packages/${name} declares a build script but has no dist/ — its output was never checked`
    );
  }
  unknown.push(...unreadable.map((line) => `${line} — its imports were never read`));

  if (unhinted.length > 0) {
    process.stderr.write(
      `\nDynamic import hint check FAILED: ${unhinted.length} computed import() call(s) lack the ` +
        `bundler-ignore hints.\n\n`
    );
    for (const f of unhinted) {
      process.stderr.write(
        `  ${f.file}:${f.line}:${f.column}  import(${f.specifier}) — missing ${f.missing.join(', ')}\n`
      );
    }
    process.stderr.write(
      `\nA consumer that bundles one of these files (webpack, Turbopack) cannot resolve a computed\n` +
        `specifier at build time: webpack turns it into an expression context, and the import then\n` +
        `throws "Cannot find module" at run time even where the module is installed. Fix the SOURCE:\n` +
        `  - make the dependency a static import, or have the caller inject it (the relay bus takes\n` +
        `    the consumer's Redis constructor for exactly this reason); or\n` +
        `  - keep it computed and mark it as packages/ui-bridge/src/ai/change-tracker.ts does:\n` +
        `      ${HINTED_FORM}\n` +
        `then rebuild and re-run. (${hinted} hinted; ${tally}.)\n`
    );
    for (const line of unknown) process.stderr.write(`  also UNKNOWN: ${line}\n`);
    process.exit(1);
  }

  if (unknown.length > 0) {
    process.stderr.write(
      `\nDynamic import hint check UNKNOWN — not everything was checked, so this is not a pass:\n`
    );
    for (const line of unknown) process.stderr.write(`  - ${line}\n`);
    process.stderr.write(`(${hinted} hinted; ${tally}.)\n`);
    process.exit(2);
  }

  process.stdout.write(
    `Dynamic import hints ok: ${hinted} computed import() call(s) checked, each carrying ` +
      `${REQUIRED_HINTS.map((h) => h.name).join(' and ')} (${tally}).\n`
  );
}

main();
