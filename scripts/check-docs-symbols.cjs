#!/usr/bin/env node
// Documentation symbol ratchet.
//
// WHY THIS EXISTS
//
// CI's `docs` job runs exactly one gate: `npm ci` + `npm run build` in
// docs-site. Docusaurus validates LINKS (`onBrokenLinks: 'throw'`) and MDX
// syntax. It never executes, type-checks, or even name-checks a fenced code
// block. So a page could — and did — name a package that has never existed
// (`@anthropic/ui-bridge`, `ui-bridge`), import a subpath the `exports` map
// does not publish, and pull three symbols the library does not export, and
// still build green. Three separate defect classes shipped to the published
// site behind one green check.
//
// This is the checker that makes those three failures observable. For every
// fenced TypeScript-family block on a guarded documentation surface — see
// DOC_SURFACES: `docs-site/docs/**` (the published site), `docs/**` (a separate
// root-level tree of authoring guides), `README.md` (the repo's front door) and
// `packages/*/README.md` (which ARE the npm package pages) — it:
//
//   1. Extracts the block (fence-aware, so a fence inside a longer fence does
//      not terminate it) and parses it with the TypeScript compiler's own
//      parser — NOT a regex over the page. That distinction is load-bearing:
//      the docs legitimately DISCUSS removed and deprecated APIs in prose, and
//      a raw grep for a dead symbol name flags the paragraph explaining that it
//      is dead. Only real import/export statements inside real code fences are
//      in scope.
//
//   2. Resolves each import specifier against the WORKSPACE package names and
//      their package.json `exports` maps (see resolveSpecifier).
//
//   3. Resolves each named import against that entry point's REAL export
//      surface, computed from the `src` entry the `exports` map points at by
//      following `export *`, `export { … } from`, and
//      `export const|function|class|interface|type|enum|…` recursively
//      (see collectExports).
//
// It FAILS on an unknown package, an unknown subpath, or an unknown symbol.
// There is no report-only mode: .qontinui/ci.toml's own header states the
// mirroring rule as "A step that cannot fail is not a gate worth mirroring".
//
// THE DEBT LEDGER (docs-site/docs-symbol-debt.json)
//
// Turning this on found MORE than the sweep that preceded it had. Sixteen
// pages — the whole of ai/, observability/, recovery/, state/ and advanced/ —
// import from `@anthropic/ui-bridge`, a scope this project has never owned, and
// name symbols (`Recorder`, `Player`, `IntentExecutor`, `EmbeddingResolver`,
// `NavigationAssistant`, `VisualContextGenerator`, `UIBridgeClient`,
// `StateMachine`, `announce`, `pressKey`, `createTrace`, …) that the library
// does not export under any name. Those pages do not describe a renamed API;
// they describe a product that was not built. Rewriting ~1600 lines of them
// against the real surface is its own piece of work, and smuggling it into the
// commit that adds a ratchet would make both unreviewable.
//
// So they are QUARANTINED — enumerated one by one in a committed ledger, never
// waved through by a widened pattern. The ledger is EXACT-MATCH and
// SHRINK-ONLY, the same shape as packages/ui-bridge/redaction-surface.manifest.json:
//
//   * a failure NOT in the ledger fails the build — every one of the 45 other
//     pages, and every new code block on a quarantined page, is fully gated;
//   * a ledger entry that no longer reproduces ALSO fails the build, with
//     "delete this line". Debt that gets paid cannot silently stay on the books
//     and re-authorise the same defect later.
//
// Its one disclosed hole: entries are a SET, so a second occurrence of an
// already-quarantined signature on the same page does not add a failure. The
// page is already declared broken for that specifier; counting occurrences
// would make the ledger churn on every unrelated prose edit.
//
// `--update` regenerates it. That is deliberately a visible diff in a reviewed
// commit — the same tradeoff `npm run redaction:surface:update` already makes.
// Growing this file is the reviewable act of declaring new debt, and should be
// refused in review unless that is genuinely the intent.
//
// WHAT IT DELIBERATELY DOES NOT CHECK
//
//   - Third-party specifiers (`react`, `express`, `next/server`,
//     `@tauri-apps/api/window`). They are not this workspace's surface and
//     resolving them would make the gate depend on an install tree the docs
//     lane does not have. Scope is decided by IN_SCOPE_PACKAGE below: a
//     specifier is checked iff its package name mentions `ui-bridge` — which
//     is precisely what makes `ui-bridge` and `@anthropic/ui-bridge` failures
//     rather than "some external package".
//   - The SUBPATH and SYMBOLS of a first-party package this repo declares but
//     does not contain — `@qontinui/ui-bridge-auto`, a `packages/ui-bridge`
//     peer dep that lives in a sibling repo. See readDeclaredExternalPackages.
//     Only its PACKAGE NAME is checked — it must appear in the root or a
//     `packages/*` manifest and sit in an owned scope, so a typo of it still
//     fails. Its SUBPATH and its SYMBOLS are NOT checked: there is no `exports`
//     map and no `src` tree to resolve them against, and resolving from the
//     sibling checkout would make the gate's verdict depend on whether an
//     unrelated repo happens to be checked out — nondeterministic between CI
//     and a developer's box, which is worse than a disclosed hole. So
//     `@qontinui/ui-bridge-auto/no/such/subpath` passes. Every affected
//     `page:line` is listed in the run summary, on passing AND failing runs,
//     so the size of this hole is visible rather than inferred.
//   - Relative (`./x`) and path-alias (`@/lib/ui-bridge`) specifiers. Those
//     name files in the READER's app, which by construction does not exist
//     here.
//   - Whether the code compiles, type-checks or runs. This is a NAME check.
//     A block that imports a real symbol and then calls it with the wrong
//     arguments passes; catching that needs a real tsc program over the docs,
//     which is a different (and much larger) gate.
//   - Property access on an imported value (`bridge.doesNotExist()`), JSX
//     component props, and anything in a non-TypeScript fence (python, bash,
//     http, json, rust, vue, svelte, html).
//
// Usage:
//   node scripts/check-docs-symbols.cjs                     # verify (CI)
//   node scripts/check-docs-symbols.cjs --verbose           # print every accepted import
//   node scripts/check-docs-symbols.cjs --update            # regenerate the debt ledger
//   node scripts/check-docs-symbols.cjs --surface <spec>    # dump one entry point's export surface

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const REPO_ROOT = path.resolve(__dirname, '..');
const PACKAGES_ROOT = path.join(REPO_ROOT, 'packages');
const DEBT_LEDGER = path.join(REPO_ROOT, 'docs-site', 'docs-symbol-debt.json');

/**
 * Every documentation surface this gate guards.
 *
 * `docs-site/docs` is the published site and was this checker's original — and
 * for one release its only — scope. That was a known hole, not an oversight:
 * the plan that commissioned this gate measured the identical defect on three
 * more surfaces and recorded that "extending the checker to README.md and
 * packages/*\/README.md is a one-glob change and should be done in the Phase 4
 * PR, since the cost of a wider glob is a wider glob". It was not done in that
 * PR, so until this commit the repo's front door could re-decay in silence
 * while the site it links to stayed gated.
 *
 * Every surface here must exist, and must be of the kind declared. A configured
 * surface that has silently moved, been deleted, or turned into the other kind
 * is the failure mode this whole script exists to prevent, so it fails loudly
 * rather than shrinking the checked set and reporting a pass.
 *
 * NOT included, deliberately: `examples/**`. Those apps declare
 * `"ui-bridge": "file:../../packages/ui-bridge"`, so the unscoped name is
 * genuinely correct *inside* them; the plan routes fixing that to its own PR
 * because it means editing a buildable app's manifest, not rewriting a doc.
 * Gating their prose against a rule their own code is exempt from would just
 * force the exemption back in as ledger lines.
 */
const DOC_SURFACES = [
  { kind: 'tree', at: path.join(REPO_ROOT, 'docs-site', 'docs') },
  // Root-level `docs/` is a SEPARATE, unrelated directory from `docs-site/docs`
  // — both are real and both carry live authoring guides. Conflating the two
  // is a documented trap in this repo; see the plan's "Files" preamble.
  { kind: 'tree', at: path.join(REPO_ROOT, 'docs') },
  { kind: 'file', at: path.join(REPO_ROOT, 'README.md') },
  { kind: 'file', at: path.join(REPO_ROOT, 'CONTRIBUTING.md') },
  // The whole `packages/` tree, not just `packages/*\/README.md`. For a
  // published package its README IS its npm page — a reader on npmjs.com told
  // to install a name that does not exist is the loudest possible instance of
  // the defect this gate was built for — but a README glob would have missed
  // the two biggest in-package documents there are: `ui-bridge/COOKBOOK.md` and
  // `ui-bridge/docs/`. `packages/ui-bridge`, the flagship, ships NO README, so
  // a README-only glob bought nothing at all for the main published package.
  { kind: 'tree', at: PACKAGES_ROOT },
];

const VERBOSE = process.argv.includes('--verbose');
const UPDATE = process.argv.includes('--update');
const SURFACE_OF = readFlag('--surface');

/**
 * Fence info-string languages whose contents are parsed as TypeScript.
 *
 * `js`/`jsx` are included: TypeScript's parser reads them fine and an import
 * of a nonexistent symbol is exactly as wrong in a JS block. Everything else
 * in the corpus (python, bash, http, json, rust, vue, svelte, html, jsonc) is
 * out of scope — see the header.
 */
const TS_FENCE_LANGS = new Set([
  'ts',
  'tsx',
  'typescript',
  'mts',
  'cts',
  'js',
  'jsx',
  'javascript',
  'mjs',
  'cjs',
]);

/**
 * Fence languages that are NOT TypeScript but EMBED it in a `<script>` block.
 *
 * Left out, these are a real bypass, not a theoretical one: the Svelte example
 * on advanced/cross-framework-support.md imports from
 * `@anthropic/ui-bridge-svelte` inside a ```svelte fence, and every sibling
 * example on that same page — Vue, Angular, vanilla — was caught while that one
 * was invisible purely because of its fence label. A gate whose coverage
 * depends on which framework a page happens to document is not a gate. Only the
 * script block is parsed; the template markup around it is not TypeScript and
 * is left alone.
 */
const SCRIPT_EMBEDDING_FENCE_LANGS = new Set(['svelte', 'vue', 'html']);
const SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Whether a bare package specifier is this workspace's business.
 *
 * Anything naming `ui-bridge` is: every workspace package is either
 * `@qontinui/ui-bridge*` or `create-ui-bridge-wrapper`, so a specifier that
 * mentions `ui-bridge` and is NOT a workspace package is a package that does
 * not exist — which is the defect this gate was built for. Everything else is
 * a third-party dependency of the reader's app and is left alone.
 */
const IN_SCOPE_PACKAGE = (name) => name.toLowerCase().includes('ui-bridge');

/** Export-map conditions, in the order this checker resolves them. */
const EXPORT_CONDITIONS = ['types', 'import', 'module', 'require', 'default', 'node', 'browser'];

const SRC_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.d.ts'];

function readFlag(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) {
    process.stderr.write(`${flag} requires a value\n`);
    process.exit(2);
  }
  return value;
}

const rel = (abs) => path.relative(REPO_ROOT, abs).replace(/\\/g, '/');

// ---------------------------------------------------------------------------
// 1. The workspace: package name -> directory + manifest
// ---------------------------------------------------------------------------

/**
 * Every `packages/*` manifest, keyed by its declared `name`.
 *
 * Read from the directory listing rather than from a hand-kept list so a new
 * package is in scope on the commit that adds it. Private packages are
 * included: `@qontinui/ui-bridge-extension` is unpublishable, and a doc block
 * importing from it is a defect worth naming rather than one worth skipping.
 */
function readWorkspacePackages() {
  const packages = new Map();
  for (const entry of fs.readdirSync(PACKAGES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(PACKAGES_ROOT, entry.name);
    const manifestPath = path.join(dir, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    const json = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (typeof json.name !== 'string') continue;
    packages.set(json.name, { dir, json });
  }
  return packages;
}

/**
 * First-party package names this repo DECLARES a dependency on but does not
 * contain — read from the root manifest and every `packages/*` manifest, across
 * `dependencies`, `devDependencies`, `peerDependencies` and
 * `optionalDependencies`.
 *
 * Why this set has to exist. IN_SCOPE_PACKAGE claims every specifier whose name
 * mentions `ui-bridge`, but the resolution universe is `packages/*` alone. That
 * gap makes the checker assert `unknown-package` — "not a package in this
 * workspace" — about `@qontinui/ui-bridge-auto`, which `packages/ui-bridge`
 * names in its own `peerDependencies` and which lives in a sibling repo that
 * simply is not checked out here. Documenting it is correct; the verdict was
 * the thing that was wrong. Declaring correct documentation to be debt and
 * parking it in the ledger would be the exact "widen the exclusions until it
 * passes" move the ledger exists to refuse.
 *
 * So a name in this set is in scope for NAME checking (it is real) and out of
 * scope for SYMBOL checking (unresolvable here) — the same honest split the
 * `opaque` re-export path already makes, and reported in the same place.
 *
 * TWO restrictions make this set safe, and BOTH are load-bearing. Relaxing
 * either one turns this function into a way to retire the gate.
 *
 * 1. ONLY the root and `packages/*` manifests are read, never `examples/*`.
 *    Each example app declares `"ui-bridge": "file:../../packages/ui-bridge"` —
 *    the UNSCOPED name, as a deliberate local alias. Reading those manifests
 *    would enter `ui-bridge` into this set and silently re-authorise the precise
 *    defect (`npm install ui-bridge`, `from 'ui-bridge'`) that this gate's own
 *    plan was written to eliminate.
 *
 * 2. The name must sit in a scope this project OWNS (OWNED_SCOPE). "Mentions
 *    ui-bridge" is not ownership, and the difference is the whole gate: add
 *    `"@anthropic/ui-bridge": "^1.0.0"` to any manifest and, without this
 *    check, 18 of the 22 quarantined ledger entries stop reproducing at once.
 *    The gate does fail loudly the first time — but the remedy it PRINTS for a
 *    stale ledger is `npm run docs:symbol-debt:update`, after which a scope this
 *    project has never owned is permanently accepted on every page with no
 *    symbol checking and no ledger line. One manifest line plus the blessed
 *    remediation command would retire the ratchet. (Measured, not theorised.)
 */
const OWNED_SCOPE = (name) => name.startsWith('@qontinui/');
function readDeclaredExternalPackages(workspacePackages) {
  const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  const manifests = [path.join(REPO_ROOT, 'package.json')];
  for (const { dir } of workspacePackages.values()) manifests.push(path.join(dir, 'package.json'));

  const declared = new Map();
  for (const manifestPath of manifests) {
    if (!fs.existsSync(manifestPath)) continue;
    const json = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const field of DEP_FIELDS) {
      for (const name of Object.keys(json[field] ?? {})) {
        if (workspacePackages.has(name)) continue;
        // In scope AND in an owned scope — see restriction 2 above. Every other
        // declared dependency is third party, which this checker does not
        // resolve and must not start listing.
        if (!IN_SCOPE_PACKAGE(name) || !OWNED_SCOPE(name)) continue;
        if (!declared.has(name)) declared.set(name, []);
        declared.get(name).push(`${rel(manifestPath)} (${field})`);
      }
    }
  }
  return declared;
}

// ---------------------------------------------------------------------------
// 2. Specifier -> entry point
// ---------------------------------------------------------------------------

/** Split `@scope/name/sub/path` into `{ name: '@scope/name', subpath: './sub/path' }`. */
function splitSpecifier(spec) {
  const parts = spec.split('/');
  if (spec.startsWith('@')) {
    const name = parts.slice(0, 2).join('/');
    const rest = parts.slice(2);
    return { name, subpath: rest.length ? `./${rest.join('/')}` : '.' };
  }
  const name = parts[0];
  const rest = parts.slice(1);
  return { name, subpath: rest.length ? `./${rest.join('/')}` : '.' };
}

/** Pick a file path out of an `exports` condition value (string | nested object | array). */
function resolveConditions(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = resolveConditions(item);
      if (resolved) return resolved;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const condition of EXPORT_CONDITIONS) {
      if (condition in value) {
        const resolved = resolveConditions(value[condition]);
        if (resolved) return resolved;
      }
    }
    // Fall back to any remaining condition rather than reporting "no target":
    // an unrecognised condition name is still a real entry point.
    for (const key of Object.keys(value)) {
      const resolved = resolveConditions(value[key]);
      if (resolved) return resolved;
    }
  }
  return null;
}

/**
 * Resolve a subpath against a package's `exports` map.
 *
 * Returns `{ target }` on success, or `{ error, known }` when the subpath is
 * not published — `known` being the subpaths that ARE, which is the whole
 * value of the failure message.
 */
function resolveSubpath(pkg, subpath) {
  const { json } = pkg;
  const exportsMap = json.exports;

  if (exportsMap === undefined) {
    // No `exports` map: the legacy `main`/`module`/`types` fields publish the
    // root and nothing else. A subpath import against such a package resolves
    // to a raw file path in the reader's node_modules, which is not an API.
    if (subpath !== '.') {
      return { error: 'declares no "exports" map, so it publishes no subpaths', known: ['.'] };
    }
    const target = json.types || json.module || json.main;
    if (!target) return { error: 'declares neither "exports" nor main/module/types', known: [] };
    return { target };
  }

  // `"exports": "./dist/index.js"` and `"exports": { "import": … }` sugar both
  // describe the root only.
  if (typeof exportsMap === 'string' || !Object.keys(exportsMap).some((k) => k.startsWith('.'))) {
    if (subpath !== '.') {
      return { error: 'publishes only its root entry point', known: ['.'] };
    }
    return { target: resolveConditions(exportsMap) };
  }

  const known = Object.keys(exportsMap)
    .filter((k) => k.startsWith('.') && k !== './package.json')
    .sort();

  if (Object.prototype.hasOwnProperty.call(exportsMap, subpath)) {
    return { target: resolveConditions(exportsMap[subpath]) };
  }

  // Pattern keys (`"./*": …`). None today; supported so adding one does not
  // silently turn every subpath into a false failure.
  for (const [key, value] of Object.entries(exportsMap)) {
    if (!key.includes('*')) continue;
    const [prefix, suffix] = key.split('*');
    if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
      const star = subpath.slice(prefix.length, subpath.length - suffix.length || undefined);
      const target = resolveConditions(value);
      return { target: typeof target === 'string' ? target.replace('*', star) : target };
    }
  }

  return { error: 'is not a published subpath', known };
}

/**
 * Map a published `dist/…` target back to the `src` file it is built from.
 *
 * The `exports` maps all point at build output, which does not exist on a
 * clean checkout — and the gate must not require a build to run. src mirrors
 * dist one-for-one in every package here, so the mapping is mechanical:
 * `./dist/server/express.d.ts` -> `src/server/express.ts`,
 * `./dist/react/index.mjs` -> `src/react/index.ts`.
 */
function distTargetToSource(pkg, target) {
  if (typeof target !== 'string') return null;
  let relTarget = target.replace(/^\.\//, '');
  if (!relTarget.startsWith('dist/')) return null;
  let stem = relTarget.slice('dist/'.length).replace(/\.(d\.ts|d\.mts|d\.cts|mjs|cjs|js|ts)$/, '');
  const srcRoot = path.join(pkg.dir, 'src');
  const candidates = [];
  for (const ext of SRC_EXTENSIONS) candidates.push(path.join(srcRoot, stem + ext));
  for (const ext of SRC_EXTENSIONS) candidates.push(path.join(srcRoot, stem, 'index' + ext));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. The real export surface of a src entry point
// ---------------------------------------------------------------------------

/** Resolve a relative module specifier from `fromFile` to a concrete src file. */
function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.(m|c)?js$/, ''));
  const candidates = [];
  for (const ext of SRC_EXTENSIONS) candidates.push(base + ext);
  for (const ext of SRC_EXTENSIONS) candidates.push(path.join(base, 'index' + ext));
  candidates.push(base);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const sourceFileCache = new Map();
function parseSourceFile(file) {
  if (!sourceFileCache.has(file)) {
    const text = fs.readFileSync(file, 'utf8');
    sourceFileCache.set(
      file,
      ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file))
    );
  }
  return sourceFileCache.get(file);
}

function scriptKindFor(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.cjs')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Every binding name in a (possibly destructuring) declaration name node. */
function bindingNames(nameNode, out) {
  if (ts.isIdentifier(nameNode)) {
    out.push(nameNode.text);
    return;
  }
  if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    for (const element of nameNode.elements) {
      if (ts.isBindingElement(element)) bindingNames(element.name, out);
    }
  }
}

const hasExportModifier = (node) =>
  (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const surfaceCache = new Map();

/**
 * The transitive set of names an entry file exports.
 *
 * `opaque` collects re-exports this checker could not follow (an
 * `export * from '<external package>'`, or a relative specifier that resolves
 * to nothing). It is reported alongside the surface and SUPPRESSES
 * unknown-symbol failures for that entry point: with an unfollowable
 * `export *` in the chain, "not in the set" no longer proves "not exported",
 * and a check that cannot tell absence from ignorance must say so rather than
 * fail someone's correct import. Unknown-package and unknown-subpath checks
 * are unaffected — those never depend on the symbol set.
 */
function collectExports(entryFile) {
  if (surfaceCache.has(entryFile)) return surfaceCache.get(entryFile);

  const names = new Set();
  const opaque = [];
  const visited = new Set();

  const walk = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    const sf = parseSourceFile(file);

    for (const stmt of sf.statements) {
      // `export * from './x'` / `export * as ns from './x'` / `export { … } from './x'`
      if (ts.isExportDeclaration(stmt)) {
        const spec = stmt.moduleSpecifier;
        const from = spec && ts.isStringLiteral(spec) ? spec.text : null;

        if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
          // The EXPORTED name is what a consumer may import: `export { a as b }`
          // publishes `b`.
          for (const element of stmt.exportClause.elements) names.add(element.name.text);
          continue;
        }

        if (stmt.exportClause && ts.isNamespaceExport(stmt.exportClause)) {
          names.add(stmt.exportClause.name.text);
          continue;
        }

        // Bare `export * from …`
        if (!from) continue;
        if (from.startsWith('.')) {
          const target = resolveRelative(file, from);
          if (target) walk(target);
          else opaque.push(`${rel(file)}: export * from '${from}' (unresolved)`);
        } else {
          opaque.push(`${rel(file)}: export * from '${from}' (external package)`);
        }
        continue;
      }

      if (!hasExportModifier(stmt)) continue;

      if ((stmt.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        names.add('default');
      }

      if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          const out = [];
          bindingNames(decl.name, out);
          for (const n of out) names.add(n);
        }
      } else if (
        ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt) ||
        ts.isModuleDeclaration(stmt)
      ) {
        if (stmt.name && ts.isIdentifier(stmt.name)) names.add(stmt.name.text);
      }
    }

    for (const stmt of sf.statements) {
      if (ts.isExportAssignment(stmt)) names.add('default');
    }
  };

  walk(entryFile);
  const surface = { names, opaque, files: visited.size };
  surfaceCache.set(entryFile, surface);
  return surface;
}

// ---------------------------------------------------------------------------
// 4. Fenced code blocks
// ---------------------------------------------------------------------------

/**
 * Every fenced code block in a markdown document.
 *
 * Fence-aware rather than regex-split: a closing fence must be at least as long
 * as the opener and carry no info string, so a ```` ```` ```` block wrapping an
 * inner ``` example is read as one block instead of two mismatched halves.
 * Returns 1-based `startLine` for the first line of code so failures can cite a
 * real line in the .md file.
 */
function extractCodeBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let open = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = line.match(/^(\s*)(`{3,}|~{3,})\s*(.*)$/);
    if (!open) {
      if (!m) continue;
      const info = m[3].trim();
      // Docusaurus info strings carry attributes: ```ts title="x.ts" {1,3}
      const lang = info.split(/[\s{]/)[0].replace(/^\{/, '').toLowerCase();
      open = { indent: m[1].length, marker: m[2], lang, startLine: i + 2, lines: [] };
      continue;
    }
    if (m && m[2][0] === open.marker[0] && m[2].length >= open.marker.length && !m[3].trim()) {
      blocks.push(open);
      open = null;
      continue;
    }
    open.lines.push(line.slice(Math.min(open.indent, line.length - line.trimStart().length)));
  }
  // An unterminated fence still yields its content — better to check it than to
  // drop it silently.
  if (open) blocks.push(open);

  return blocks;
}

/**
 * Every import/export-from statement in a code block.
 *
 * Parsed TWICE, once as TS and once as TSX, and unioned. The fence's info
 * string is not a reliable script kind — the corpus has JSX inside ```typescript
 * fences and type assertions inside ```tsx ones — and a mode mismatch degrades
 * the parse in ways that can drop statements. Dropping a statement is a SILENT
 * PASS, which is the one failure mode a gate must not have, so both readings
 * are taken and their results merged.
 */
function readImports(code) {
  const seen = new Map();
  for (const kind of [ts.ScriptKind.TS, ts.ScriptKind.TSX]) {
    for (const imp of readImportsIn(code, kind)) {
      const key = `${imp.line}::${imp.spec}::${imp.named.join(',')}`;
      if (!seen.has(key)) seen.set(key, imp);
    }
  }
  return [...seen.values()];
}

function readImportsIn(code, kind) {
  const sf = ts.createSourceFile('doc-block.tsx', code, ts.ScriptTarget.Latest, true, kind);
  const found = [];

  const record = (node, spec, named, defaultImport, namespaceImport) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    found.push({ spec, named, defaultImport, namespaceImport, line });
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const named = [];
      let defaultImport = false;
      let namespaceImport = false;
      const clause = node.importClause;
      if (clause) {
        if (clause.name) defaultImport = true;
        if (clause.namedBindings) {
          if (ts.isNamespaceImport(clause.namedBindings)) namespaceImport = true;
          else {
            for (const element of clause.namedBindings.elements) {
              // The SOURCE name is what must exist: `import { a as b }` asks the
              // module for `a`.
              named.push((element.propertyName ?? element.name).text);
            }
          }
        }
      }
      record(node, node.moduleSpecifier.text, named, defaultImport, namespaceImport);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const named = [];
      let namespaceImport = false;
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          named.push((element.propertyName ?? element.name).text);
        }
      } else {
        namespaceImport = true; // `export * from` asks for no specific name
      }
      record(node, node.moduleSpecifier.text, named, false, namespaceImport);
    } else if (isModuleLoadCall(node)) {
      // `require('pkg')` and `await import('pkg')`. Rare in these docs today —
      // and covered anyway, because otherwise the exact defect this gate exists
      // for (`require('ui-bridge')`) has a spelling the gate cannot see.
      const spec = node.arguments[0].text;
      const named = [];
      const parent = node.parent;
      const decl =
        parent && ts.isAwaitExpression(parent) ? parent.parent : parent;
      if (decl && ts.isVariableDeclaration(decl) && ts.isObjectBindingPattern(decl.name)) {
        for (const element of decl.name.elements) {
          const source = element.propertyName ?? element.name;
          if (ts.isIdentifier(source)) named.push(source.text);
        }
      }
      record(node, spec, named, false, named.length === 0);
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return found;
}

// ---------------------------------------------------------------------------
// 5. The check
// ---------------------------------------------------------------------------

/** `require('literal')` or `import('literal')`, with a string-literal specifier. */
function isModuleLoadCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
  const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  if (!isRequire && !isDynamicImport) return false;
  return node.arguments.length >= 1 && ts.isStringLiteral(node.arguments[0]);
}

/**
 * Replace every character outside a `<script>…</script>` body with whitespace,
 * preserving newlines (and therefore line numbers) exactly.
 */
function blankOutsideScripts(text) {
  const keep = new Array(text.length).fill(false);
  SCRIPT_BLOCK.lastIndex = 0;
  for (const m of text.matchAll(SCRIPT_BLOCK)) {
    const start = m.index + m[0].indexOf(m[1], m[0].indexOf('>'));
    for (let i = start; i < start + m[1].length; i += 1) keep[i] = true;
  }
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    out += keep[i] || text[i] === '\n' ? text[i] : ' ';
  }
  return out;
}

function markdownTree(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Installed and built trees are not authored documentation.
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...markdownTree(p));
    } else if (/\.mdx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

/**
 * Every markdown file across DOC_SURFACES, de-duplicated and sorted.
 *
 * Returns `{ files, missing }` rather than throwing: main() decides what a
 * missing required surface means, and reporting all of them at once beats
 * failing on the first.
 */
function docFiles() {
  const files = new Set();
  const missing = [];
  for (const surface of DOC_SURFACES) {
    // Type, not just existence. A `tree` that has become a file (or a `file`
    // that has become a directory) would otherwise die on ENOTDIR/EISDIR with a
    // raw stack, several frames from here — losing the message written for
    // exactly this case.
    const stat = fs.statSync(surface.at, { throwIfNoEntry: false });
    const wrongType = stat && (surface.kind === 'file' ? !stat.isFile() : !stat.isDirectory());
    if (!stat || wrongType) {
      missing.push(
        `${rel(surface.at)}${wrongType ? ` (expected a ${surface.kind === 'file' ? 'file' : 'directory'})` : ''}`
      );
      continue;
    }
    if (surface.kind === 'tree') for (const f of markdownTree(surface.at)) files.add(f);
    else files.add(surface.at);
  }
  return { files: [...files].sort(), missing };
}

/**
 * Packages whose manifest lists README.md in `files` but that ship no README.
 *
 * DOC_SURFACES walks `packages/` as a tree, so an ABSENT README is simply not
 * scanned — silently, and a package with no README is a legitimate state. What
 * is NOT legitimate is a manifest that PROMISES npm one and ships none: `files`
 * is the publish allowlist, so the tarball goes out with the entry unfulfilled
 * and npmjs.com renders the literal string "ERROR: No README data found!" where
 * the package's documentation should be.
 *
 * That is this gate's own defect class — a name that resolves to nothing — on
 * the most published surface there is. Measured 2026-08-20: both
 * @qontinui/ui-bridge 0.22.0 and @qontinui/ui-bridge-server 0.4.1 were serving
 * exactly that error to every reader who found them on npm.
 */
function unfulfilledReadmePromises() {
  const out = [];
  for (const entry of fs.readdirSync(PACKAGES_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(PACKAGES_ROOT, entry.name, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;

    const readme = path.join(PACKAGES_ROOT, entry.name, 'README.md');
    if (fs.existsSync(readme)) continue;

    const json = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    // `files` is absent on a private package that never publishes; nothing is
    // promised, so nothing is owed.
    const promised = (json.files ?? []).some((f) => /(^|[/])README[.]md$/i.test(f));
    if (promised) out.push({ manifestPath, readme });
  }
  return out;
}

function main() {
  const packages = readWorkspacePackages();

  if (SURFACE_OF) {
    dumpSurface(packages, SURFACE_OF);
    return;
  }

  const declaredExternal = readDeclaredExternalPackages(packages);

  const { files, missing } = docFiles();
  if (missing.length) {
    process.stderr.write(
      `${missing.length} configured documentation surface(s) do not exist:\n` +
        missing.map((m) => `   - ${m}\n`).join('') +
        'A surface that has moved or been deleted must not quietly shrink the checked set —\n' +
        'that is a silent pass, which is the one failure mode this gate cannot have. Update\n' +
        'DOC_SURFACES in this script to match where the docs actually live.\n'
    );
    process.exit(1);
  }
  if (!files.length) {
    process.stderr.write('No documentation files found — nothing to check, which is not a pass.\n');
    process.exit(1);
  }

  const unfulfilled = unfulfilledReadmePromises();
  if (unfulfilled.length) {
    process.stderr.write(
      `${unfulfilled.length} package(s) promise npm a README and ship none:\n` +
        unfulfilled
          .map(
            ({ manifestPath, readme }) =>
              `   - ${rel(manifestPath)} lists "README.md" in "files", but ${rel(readme)} does not exist\n`
          )
          .join('') +
        'npm renders "ERROR: No README data found!" on that package page — this gate\'s own\n' +
        'defect class (a name resolving to nothing) on the most published surface there is.\n' +
        'Write the README, or drop "README.md" from the manifest\'s "files" array.\n'
    );
    process.exit(1);
  }

  const failures = [];
  const accepted = [];
  let blocksChecked = 0;
  let importsSeen = 0;
  let importsInScope = 0;
  const opaqueEntries = new Map();
  const externalEntries = new Map();

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const block of extractCodeBlocks(text)) {
      const isTs = TS_FENCE_LANGS.has(block.lang);
      const embedsScript = SCRIPT_EMBEDDING_FENCE_LANGS.has(block.lang);
      if (!isTs && !embedsScript) continue;
      blocksChecked += 1;
      // For a script-embedding fence, blank out everything OUTSIDE `<script>`
      // rather than slicing the script out: keeping the blanked lines preserves
      // line numbers, so a failure still cites the right line of the .md.
      const raw = block.lines.join('\n');
      const code = isTs ? raw : blankOutsideScripts(raw);

      for (const imp of readImports(code)) {
        importsSeen += 1;
        const where = `${rel(file)}:${block.startLine + imp.line}`;
        const spec = imp.spec;

        // Relative and path-alias specifiers name files in the READER's app.
        if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/')) continue;
        if (spec.startsWith('node:')) continue;

        const { name, subpath } = splitSpecifier(spec);
        if (!IN_SCOPE_PACKAGE(name)) continue;
        importsInScope += 1;

        const docPath = rel(file);
        const pkg = packages.get(name);
        if (!pkg && declaredExternal.has(name)) {
          // Real, first-party, and not resolvable from here — see
          // readDeclaredExternalPackages. The name is verified; the symbols
          // cannot be, and inventing either verdict would be a lie.
          if (!externalEntries.has(name)) {
            externalEntries.set(name, { manifests: declaredExternal.get(name), sites: [] });
          }
          externalEntries.get(name).sites.push(`${where}  ${spec}`);
          const wanted = [...imp.named];
          if (imp.defaultImport) wanted.push('default');
          if (wanted.length === 0) continue;
          accepted.push({
            where,
            spec,
            names: wanted,
            note: 'declared dependency, not resolvable in this repo',
            unverified: true,
          });
          continue;
        }
        if (!pkg) {
          failures.push({
            sig: `${docPath} :: unknown-package :: ${spec}`,
            where,
            reason: `imports from "${name}", which is not a package in this workspace`,
            detail:
              `this workspace publishes: ${[...packages.keys()].sort().join(', ')}` +
              (declaredExternal.size
                ? `; and declares (but does not contain): ${[...declaredExternal.keys()].sort().join(', ')}`
                : ''),
          });
          continue;
        }

        const resolved = resolveSubpath(pkg, subpath);
        if (resolved.error) {
          failures.push({
            sig: `${docPath} :: unknown-subpath :: ${spec}`,
            where,
            reason: `"${name}" ${resolved.error} — "${subpath}" does not resolve`,
            detail: `published subpaths: ${resolved.known.join(', ') || '(none)'}`,
          });
          continue;
        }

        const entryFile = distTargetToSource(pkg, resolved.target);
        if (!entryFile) {
          // A published entry point with no src file behind it (e.g. a
          // generated bundle). Nothing to name-check against, and inventing a
          // pass or a fail would both be lies — so it is only a failure if the
          // block actually asks for names.
          if (imp.named.length || imp.defaultImport) {
            failures.push({
              sig: `${docPath} :: unverifiable-entry :: ${spec}`,
              where,
              reason:
                `"${spec}" resolves to ${resolved.target}, which has no TypeScript source in ` +
                `${rel(pkg.dir)}/src — its export surface cannot be verified`,
              detail: 'if this entry point is generated, import it for side effects only',
            });
          }
          continue;
        }

        const surface = collectExports(entryFile);
        if (surface.opaque.length) {
          for (const o of surface.opaque) opaqueEntries.set(o, (opaqueEntries.get(o) ?? 0) + 1);
        }

        const wanted = [...imp.named];
        if (imp.defaultImport) wanted.push('default');
        if (wanted.length === 0) continue;

        // With an unfollowable `export *` in the chain, absence from the set is
        // ignorance rather than proof — see collectExports.
        if (surface.opaque.length) {
          accepted.push({
            where,
            spec,
            names: wanted,
            note: 'surface incomplete (opaque re-export)',
            unverified: true,
          });
          continue;
        }

        const missing = wanted.filter((n) => !surface.names.has(n));
        if (missing.length) {
          for (const symbol of missing) {
            failures.push({
              sig: `${docPath} :: unknown-symbol :: ${spec} :: ${symbol}`,
              where,
              reason: `"${spec}" does not export \`${symbol}\``,
              detail:
                `entry point ${rel(entryFile)} exports ${surface.names.size} name(s); ` +
                `nearest: ${nearest(symbol, surface.names).join(', ') || '(no close match)'}`,
            });
          }
          continue;
        }

        accepted.push({ where, spec, names: wanted });
      }
    }
  }

  if (VERBOSE) {
    for (const a of accepted) {
      const note = a.note ? ` [${a.note}]` : '';
      process.stdout.write(`  ok  ${a.where}  ${a.names.join(', ')} <- ${a.spec}${note}\n`);
    }
    for (const [o, n] of opaqueEntries) {
      process.stdout.write(`  --  unfollowable re-export (${n} import(s) affected): ${o}\n`);
    }
  }

  // Printed BEFORE the ledger verdict, so a failing run still discloses what
  // was waved through. Hiding the size of a known hole behind an unrelated
  // failure is how a hole stops being known.
  const disclose = () => {
    if (opaqueEntries.size) {
      process.stdout.write(
        `  note: ${opaqueEntries.size} entry point(s) re-export from outside the workspace, so ` +
          'their symbol sets are incomplete and unknown-symbol checking is suppressed there:\n'
      );
      for (const o of opaqueEntries.keys()) process.stdout.write(`    ${o}\n`);
    }
    if (externalEntries.size) {
      const sites = [...externalEntries.values()].reduce((n, e) => n + e.sites.length, 0);
      process.stdout.write(
        `  note: ${externalEntries.size} first-party package(s) are declared by this repo but ` +
          `live outside it. Their NAMES are verified; their subpaths and symbols are not.\n` +
          `        ${sites} import(s) are affected:\n`
      );
      for (const [name, { manifests, sites: where }] of externalEntries) {
        process.stdout.write(`    ${name} — declared in ${manifests.join(', ')}\n`);
        for (const site of where) process.stdout.write(`      ${site}\n`);
      }
    }
  };

  // --- the debt ledger ------------------------------------------------------
  const liveSignatures = [...new Set(failures.map((f) => f.sig))].sort();
  const bySignature = new Map();
  for (const f of failures) if (!bySignature.has(f.sig)) bySignature.set(f.sig, f);

  if (UPDATE) {
    writeLedger(liveSignatures);
    process.stdout.write(
      `docs:symbol-debt:update — recorded ${liveSignatures.length} quarantined failure(s) ` +
        `across ${new Set(liveSignatures.map((s) => s.split(' :: ')[0])).size} page(s) in ` +
        `${rel(DEBT_LEDGER)}\n`
    );
    return;
  }

  const quarantined = readLedger();
  const known = new Set(quarantined);
  const unrecorded = liveSignatures.filter((s) => !known.has(s));
  const stale = quarantined.filter((s) => !liveSignatures.includes(s));

  let failed = false;

  if (unrecorded.length) {
    failed = true;
    process.stderr.write(`Documentation symbol check FAILED (${unrecorded.length}):\n\n`);
    for (const sig of unrecorded) {
      const f = bySignature.get(sig);
      process.stderr.write(`  ${f.where}\n`);
      process.stderr.write(`    ${f.reason}\n`);
      process.stderr.write(`    ${f.detail}\n\n`);
    }
    process.stderr.write(
      'Every import in a fenced ts/tsx/js block — or a <script> block inside a\n' +
        'svelte/vue/html fence — on any guarded documentation surface\n' +
        `(${DOC_SURFACES.map((s) => rel(s.at)).join(', ')}) must name a real\n` +
        'workspace package, a subpath its package.json "exports" map publishes, and symbols\n' +
        'that entry point actually exports. Docusaurus checks links and MDX syntax; it never\n' +
        'name-checks a code block, which is how a nonexistent package and three nonexistent\n' +
        'exports shipped to the published site behind a green build.\n\n' +
        `Fix the page. If — and only if — you are deliberately DECLARING NEW DEBT, run\n` +
        '`npm run docs:symbol-debt:update` and justify the added lines in review.\n'
    );
  }

  if (stale.length) {
    failed = true;
    process.stderr.write(
      `\n${stale.length} ledger entr(y/ies) in ${rel(DEBT_LEDGER)} no longer reproduce.\n` +
        'The quarantine is shrink-only: paid-off debt must leave the books, or it stays\n' +
        'available to re-authorise the same defect later. Delete these lines (or run\n' +
        '`npm run docs:symbol-debt:update`):\n\n'
    );
    for (const s of stale) process.stderr.write(`   - ${s}\n`);
    process.stderr.write('\n');
  }

  if (failed) {
    disclose();
    process.exit(1);
  }

  const unverified = accepted.filter((a) => a.unverified).length;
  const quarantinedPages = new Set(quarantined.map((s) => s.split(' :: ')[0]));
  process.stdout.write(
    `docs:check-symbols OK — ${accepted.length - unverified} in-scope import(s) fully verified` +
      (unverified ? `, ${unverified} accepted WITHOUT symbol checking (see notes)` : '') +
      `, across ${blocksChecked} TypeScript code block(s) in ${files.length} doc page(s) ` +
      `(${importsSeen} import statement(s) seen, ${importsInScope} in scope).\n`
  );
  if (quarantined.length) {
    process.stdout.write(
      `  ${quarantined.length} known failure(s) on ${quarantinedPages.size} quarantined page(s) ` +
        `are recorded in ${rel(DEBT_LEDGER)} — see its $comment. Anything NOT in that ledger ` +
        `fails this gate.\n`
    );
  }
  disclose();
}

const LEDGER_COMMENT = [
  'Quarantined documentation-symbol failures — EXACT-MATCH and SHRINK-ONLY.',
  'Each line is one known-broken import on a guarded documentation surface (see DOC_SURFACES in',
  'scripts/check-docs-symbols.cjs — docs-site/docs, docs, packages, and the root README/CONTRIBUTING),',
  'in the form',
  '"<page> :: <kind> :: <specifier>[ :: <symbol>]". scripts/check-docs-symbols.cjs fails on any',
  'failure NOT listed here, and ALSO fails when a listed entry stops reproducing — so paid-off',
  'debt cannot linger and re-authorise the same defect. Regenerate with',
  '`npm run docs:symbol-debt:update`; growing this file is a reviewable act of declaring new debt.',
  'The current contents are one finding: sixteen pages (ai/, observability/, recovery/, state/,',
  'advanced/) import from "@anthropic/ui-bridge" — a scope this project has never owned — and name',
  'symbols the library does not export under any name. They document a product that was not built,',
  'so rewriting them against the real surface is its own piece of work, not a line in a ratchet PR.',
];

function readLedger() {
  if (!fs.existsSync(DEBT_LEDGER)) return [];
  const json = JSON.parse(fs.readFileSync(DEBT_LEDGER, 'utf8'));
  return Array.isArray(json.entries) ? [...json.entries].sort() : [];
}

function writeLedger(signatures) {
  fs.writeFileSync(
    DEBT_LEDGER,
    JSON.stringify({ $comment: LEDGER_COMMENT, entries: signatures }, null, 2) + '\n'
  );
}

/** Cheap edit-distance suggestions, so a failure points at the right name. */
function nearest(target, names, limit = 3) {
  const scored = [...names]
    .map((n) => ({ n, d: distance(target.toLowerCase(), n.toLowerCase()) }))
    .filter((s) => s.d <= Math.max(3, Math.floor(target.length / 2)))
    .sort((a, b) => a.d - b.d || a.n.localeCompare(b.n));
  return scored.slice(0, limit).map((s) => s.n);
}

function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

/** `--surface <specifier>` — the debugging door; not used by CI. */
function dumpSurface(packages, spec) {
  const { name, subpath } = splitSpecifier(spec);
  const pkg = packages.get(name);
  if (!pkg) {
    process.stderr.write(`No workspace package named "${name}"\n`);
    process.exit(2);
  }
  const resolved = resolveSubpath(pkg, subpath);
  if (resolved.error) {
    process.stderr.write(`"${name}" ${resolved.error} (known: ${resolved.known.join(', ')})\n`);
    process.exit(2);
  }
  const entryFile = distTargetToSource(pkg, resolved.target);
  if (!entryFile) {
    process.stderr.write(`${resolved.target} has no TypeScript source in ${rel(pkg.dir)}/src\n`);
    process.exit(2);
  }
  const surface = collectExports(entryFile);
  process.stdout.write(`${spec} -> ${rel(entryFile)} (${surface.files} file(s))\n`);
  for (const n of [...surface.names].sort()) process.stdout.write(`  ${n}\n`);
  for (const o of surface.opaque) process.stdout.write(`  ! unfollowable: ${o}\n`);
}

main();
