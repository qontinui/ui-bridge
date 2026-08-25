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
// fenced TypeScript-family block on a guarded surface — markdown, whose roster
// is DOC_SURFACES with every tracked .md/.mdx either on it or named in
// UNGUARDED_DOCS with a reason, plus the comments of every TypeScript-family
// source this repo tracks (see SOURCE_EXTENSIONS) — it:
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
// THE SECOND SURFACE: JSDOC (see SOURCE_EXTENSIONS)
//
// A `@example` in a JSDoc comment is documentation that ships. It renders in
// every IDE hover and in every generated API page, it is the copy a reader is
// most likely to paste, and until this commit no glob in this repo reached it.
// That was not theoretical: #160 found two JSDoc blocks in
// packages/ui-bridge/src/navigation/navigation-adapter.ts importing from
// `@anthropic-ai/ui-bridge-sdk` — a scope this project has never owned, an
// E404 for anyone who copied it — plus `UiBridgeProvider` for the real
// `UIBridgeProvider`. Both were fixed BY HAND, with nothing left behind to stop
// the next one, and the whole argument for this file is that a hand-fix without
// a gate is how README.md re-decayed for a release while the site it links to
// stayed green. Same defect class, same corpus, same reader: same gate.
//
// The mechanics are the markdown path's, unchanged. Comment bodies are stripped
// of their `/**`, ` * ` and `//` markers by BLANKING them (spaces of equal
// width, never deletion), so line and column offsets survive and a failure
// still cites the true `file:line` of the source. What comes out goes through
// the same extractCodeBlocks, the same readImports, the same resolver. A fenced
// block in a comment is judged by exactly the rule a fenced block in a README
// is judged by, which is the point: the gate's coverage must not depend on
// which file a reader happens to be reading the example in.
//
// THE DEBT LEDGER (docs-site/docs-symbol-debt.json)
//
// THE LEDGER IS CURRENTLY EMPTY, AND THE FILE IS ABSENT. That is the paid-off
// state, not a missing file: `readLedger` reads an absent ledger as "nothing
// quarantined", and `writeLedger` deletes it rather than leaving an
// `{"entries": []}` husk that `--update` would otherwise resurrect. Every
// in-scope import on every guarded surface is fully name-checked today.
//
// It was not always. Turning this gate on found MORE than the sweep that
// preceded it had: sixteen pages — the whole of ai/, observability/, recovery/,
// state/ and advanced/ — imported from `@anthropic/ui-bridge`, a scope this
// project has never owned, and named symbols (`Recorder`, `Player`,
// `IntentExecutor`, `EmbeddingResolver`, `NavigationAssistant`,
// `VisualContextGenerator`, `UIBridgeClient`, `StateMachine`, `announce`,
// `pressKey`, `createTrace`, …) the library does not export under any name.
// Those pages did not describe a renamed API; they described a product that
// was not built. Rewriting them against the real surface was its own piece of
// work — plan `2026-08-19-ui-bridge-docs-document-an-unbuilt-product` — and
// smuggling it into the commit that added this ratchet would have made both
// unreviewable. Eleven pages were rewritten and five, whose subject matter had
// no real counterpart of any kind, were deleted; the 22 quarantined entries
// went to zero and the ledger file was removed.
//
// So the mechanism stays, unused, for the next time it is needed. Failures are
// QUARANTINED — enumerated one by one in a committed ledger, never waved
// through by a widened pattern. The ledger is EXACT-MATCH and SHRINK-ONLY, the
// same shape as packages/ui-bridge/redaction-surface.manifest.json:
//
//   * a failure NOT in the ledger fails the build — every unquarantined page,
//     and every new code block on a quarantined page, is fully gated;
//   * a ledger entry that no longer reproduces ALSO fails the build, with
//     "delete this line". Debt that gets paid cannot silently stay on the books
//     and re-authorise the same defect later. Paying off the LAST entry deletes
//     the file, so the books close rather than lingering empty.
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
//   - An `@example` body carrying no fence at all. JSDoc permits it; this repo
//     had exactly one, `debug/browser-capture.ts`, fenced in the same commit
//     that added this surface — so the convention is uniform and teaching
//     extractCodeBlocks to guess where an unfenced example starts and stops
//     would buy no coverage while starting to parse prose as code. A fence is
//     cheap; the remedy for an unfenced example is to fence it, not to widen
//     the parser. (No tally is given on purpose: a count here would be stale on
//     the next `@example` anyone writes, which is the defect class this gate
//     exists to catch.)
//   - Source comments OUTSIDE this repository's tracked TypeScript-family
//     files — `.py`, `.rs`, `.java` and the rest. The resolver is a TypeScript
//     one; a Python docstring showing a `ui-bridge` import is a real surface
//     and a real gap, and it is named here rather than left to be discovered.
//
// Usage:
//   node scripts/check-docs-symbols.cjs                     # verify (CI)
//   node scripts/check-docs-symbols.cjs --verbose           # print every accepted import
//   node scripts/check-docs-symbols.cjs --update            # regenerate the debt ledger
//   node scripts/check-docs-symbols.cjs --surface <spec>    # dump one entry point's export surface

'use strict';

const { execFileSync } = require('node:child_process');
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
 * The roster must also be COMPLETE, not merely present: see UNGUARDED_DOCS.
 * Guarding what is listed here says nothing about the markdown that is listed
 * nowhere, and a documentation tree that lands unguarded is the same silent
 * pass as one that vanishes — it is how `README.md` stayed ungated for a whole
 * release after the plan had already written down that it should not be.
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
  // `ui-bridge/docs/`. When this surface was added the flagship
  // `packages/ui-bridge` shipped no README at all, so a README-only glob bought
  // nothing whatsoever for the main published package; #159 has since written
  // one, which changes the example and not the argument.
  { kind: 'tree', at: PACKAGES_ROOT },
  // `examples/` was held out of this list until now, and the reason it was held
  // out has been retired twice over.
  //
  // Originally those apps declared `"ui-bridge": "file:../../packages/ui-bridge"`
  // — the UNSCOPED name — which made `npm install ui-bridge` genuinely correct
  // *inside* them, so gating their prose against a rule their own code was
  // exempt from would only have forced the exemption back in as ledger lines.
  // #159 closed that: every example manifest now declares `"@qontinui/ui-bridge"`
  // and every example import is scoped, so nothing here is exempt any more.
  //
  // The fallback argument — that the four READMEs carry zero `ui-bridge` import
  // specifiers, so a fourth surface buys no coverage — measures today and
  // budgets for nothing. These files document how to install and use the
  // published packages; the next one written is exactly where an unscoped name
  // reappears. The plan's own accounting applies unchanged: "the cost of a
  // wider glob is a wider glob".
  //
  // What made this unsafe before was mechanical, not editorial:
  // `examples/tauri-app/src-tauri` is a real cargo crate, and its `target/` is
  // on neither `.gitignore` nor the old walk's hardcoded skip list — so on any
  // box that had built it, whatever markdown a build had left in there was
  // scanned, and the gate's answer differed from CI's at the same commit.
  // Enumerating from git (see trackedMarkdown) removes that whole class, for
  // this tree and for `packages/`.
  { kind: 'tree', at: path.join(REPO_ROOT, 'examples') },
];

/**
 * Markdown this gate deliberately does NOT guard.
 *
 * DOC_SURFACES asserts that everything it names exists. That is only half the
 * invariant, and it is the half that does not catch the way this gate has
 * actually decayed. #155 shipped the ratchet over `docs-site/docs` alone while
 * the plan that commissioned it had already recorded, in writing, that
 * `README.md` needed the same treatment; the plan was then marked SHIPPED and
 * the repo's front door stayed ungated for a release. Nothing failed, because
 * nothing was looking at the files the roster did not mention.
 *
 * So the roster is checked in BOTH directions. Every `.md`/`.mdx` file this
 * repository tracks must be either on a guarded surface or named here with a
 * reason — a new documentation tree cannot land unguarded and silent, it lands
 * red with a message telling the author to make a decision.
 *
 * EXACT and SHRINK-ONLY, exactly like the debt ledger: an entry that waives
 * nothing is itself a failure. An exemption must not outlive the files it was
 * written for, or the roster rots into a list of paths that once existed and
 * quietly re-authorises whatever moves back into them.
 *
 * Entries may nest — a tree here plus one file inside it — and every entry
 * covering a file is credited, not just the first. Crediting only the first
 * would report the narrower entry as waiving nothing and demand its deletion,
 * which is the opposite of what the author wrote it for.
 *
 * Nothing on this list is product documentation. A file that tells a reader
 * how to install or call a published package does not belong here — it belongs
 * on a surface.
 */
const UNGUARDED_DOCS = [
  {
    // Issue/PR templates and a workflow-authoring note. These address
    // contributors filing against this repo, not readers installing from npm;
    // none of them names a package or shows an import.
    at: '.github',
    why: 'contributor templates and workflow notes — not product documentation',
  },
  {
    at: 'CLA.md',
    why: 'a legal agreement — its text is negotiated, not maintained against the API',
  },
  {
    at: 'STATEMENT_OF_PURPOSE.md',
    why: 'a project charter — prose about intent, with no install or import instructions',
  },
];

/**
 * The source surface: file extensions whose COMMENTS are scanned for fenced
 * examples.
 *
 * Deliberately NOT a roster of paths, and deliberately with no exemption list.
 *
 * DOC_SURFACES needs both because markdown is an open set of trees that get
 * added, moved and emptied, and because some of it (a CLA, a charter, an issue
 * template) genuinely documents nothing about the API. Source comments have
 * neither property. There is exactly one rule — a fenced TypeScript block in a
 * comment is an example, wherever it sits — and a per-path roster over the ~700
 * tracked sources this matches would be a list to forget to update, i.e. the
 * very drift that UNGUARDED_DOCS exists to catch, reintroduced one layer down.
 *
 * The set is every extension the parser can read as TypeScript, so a `.js`
 * build script's example is judged by the same rule as a `.tsx` component's.
 * As with markdown, the file list comes from `git ls-files` and not from a walk
 * — see trackedSources: `dist/`, `node_modules/`, `coverage/`, `.next/` and
 * `examples/tauri-app/src-tauri/target/` are excluded because git already knows
 * they are not this repo's source, not because a hardcoded skip list remembered
 * to name them.
 */
const SOURCE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'];

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
 * Left out, these are a real bypass, not a theoretical one. The example that
 * proved it is gone now: advanced/cross-framework-support.md imported from
 * `@anthropic/ui-bridge-svelte` inside a ```svelte fence, and every sibling
 * example on that same page — Vue, Angular, vanilla — was caught while that one
 * stayed invisible purely because of its fence label, until the page was
 * rewritten against the real surface. The rule outlives the example that
 * motivated it: a gate whose coverage
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
 *    The reason this restriction was WRITTEN no longer holds and must not be
 *    left standing as though it did: each example app used to declare
 *    `"ui-bridge": "file:../../packages/ui-bridge"` — the UNSCOPED name, as a
 *    deliberate local alias — so reading those manifests would have entered
 *    `ui-bridge` into this set and silently re-authorised the precise defect
 *    (`npm install ui-bridge`, `from 'ui-bridge'`) this gate's own plan was
 *    written to eliminate. #159 rewrote all three to `"@qontinui/ui-bridge"`,
 *    which is a workspace package and so never reaches this set at all.
 *
 *    The restriction stays, on the reason that survives: this set's whole job
 *    is to name packages that are REAL but unresolvable here, and the evidence
 *    it accepts for "real" is a manifest entry. `examples/` manifests are
 *    written to make a demo app install, not to attest that a name is
 *    published — a `file:` or `link:` alias to a local directory is normal
 *    there and says nothing about npm. Restriction 2 already refuses an
 *    unowned scope; this one refuses the weaker evidence, so a demo's
 *    convenience alias can never become the reason a doc page passes.
 *
 * 2. The name must sit in a scope this project OWNS (OWNED_SCOPE). "Mentions
 *    ui-bridge" is not ownership, and the difference is the whole gate: add
 *    `"@anthropic/ui-bridge": "^1.0.0"` to any manifest and, without this
 *    check, every page importing that scope is waved through with no symbol
 *    checking at all. Measured while the ledger still existed: 18 of its 22
 *    entries stopped reproducing at once.
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
 * Every comment in a source file, as `{ pos, end }` offsets.
 *
 * Walked from the AST rather than scanned from the raw text. A raw scan has to
 * decide whether `/` opens a regex or divides, and getting that wrong invents a
 * comment out of ordinary code — which would then be name-checked and could
 * fail the build on a file with no examples in it at all. The parser has
 * already made that decision correctly, so leading + trailing comment ranges
 * over every node is both cheaper to trust and exactly what TypeScript's own
 * tooling does.
 *
 * Runs of `//` lines separated by nothing but whitespace are merged into one
 * range. A `//`-style fenced example spans several comment tokens, and left
 * unmerged its opening fence would land in one range and its closing fence in
 * another — so the block would be read as unterminated and, worse, an import on
 * a line that PRECEDES any fence in its own range is dropped entirely. That is a
 * silent pass, measured: with the run split by one blank line, an import of a
 * symbol that does not exist was accepted while three siblings in the same file
 * failed correctly.
 *
 * Whitespace-only is the right width for the gap. A blank line inside a fenced
 * block is ordinary code, and an author who leaves one there has not stopped
 * writing the same example; anything else between two comments is CODE, which
 * ends the run for real. Coverage that depends on which comment syntax the
 * author reached for — or on whether they hit Enter twice — is the same defect
 * as coverage that depends on a fence's info string, which this file already
 * refuses (see SCRIPT_EMBEDDING_FENCE_LANGS).
 *
 * The merged slice keeps everything between the two ranges, blank lines
 * included, so line offsets stay addable and a failure still cites the true
 * line.
 */
function commentRanges(sf, text) {
  const seen = new Set();
  const found = [];
  const add = (ranges) => {
    if (!ranges) return;
    for (const r of ranges) {
      if (seen.has(r.pos)) continue;
      seen.add(r.pos);
      found.push({ pos: r.pos, end: r.end, kind: r.kind });
    }
  };

  add(ts.getLeadingCommentRanges(text, 0));
  const walk = (node) => {
    if (node.kind !== ts.SyntaxKind.SourceFile) {
      add(ts.getLeadingCommentRanges(text, node.pos));
      add(ts.getTrailingCommentRanges(text, node.end));
    }
    for (const child of node.getChildren(sf)) walk(child);
  };
  walk(sf);
  found.sort((a, b) => a.pos - b.pos);

  const merged = [];
  for (const r of found) {
    const prev = merged[merged.length - 1];
    const whitespaceOnly = prev !== undefined && /^\s*$/.test(text.slice(prev.end, r.pos));
    if (
      prev &&
      prev.kind === ts.SyntaxKind.SingleLineCommentTrivia &&
      r.kind === ts.SyntaxKind.SingleLineCommentTrivia &&
      whitespaceOnly
    ) {
      prev.end = r.end;
      continue;
    }
    merged.push(r);
  }
  return merged;
}

/**
 * A comment body with its `/**`, ` * ` and `//` markers removed.
 *
 * Removed by BLANKING — each marker becomes spaces of its own width — never by
 * deletion. Deleting would shift every column and, on the last line, could drop
 * a line entirely; both would make the `file:line` in a failure point somewhere
 * the reader has to go hunting. Preserving the shape means extractCodeBlocks'
 * indent handling works on a JSDoc block exactly as it does on an indented
 * markdown fence, and offsets stay addable straight back onto the comment's own
 * start line.
 *
 * `isBlockComment` is not decoration, and blanking a trailing `*\/` on every
 * line instead was a measured silent pass. A comment range ends AT its
 * terminator, so a block comment's `*\/` is only ever on its final line — while
 * inside a `//` run it is ordinary content. Blanked there, a line ending in an
 * inline `/* … *\/` loses its closer, the surviving `/*` swallows the rest of
 * the parse, and every import below it goes unchecked while the gate reports a
 * pass.
 */
const blankOut = (s) => ' '.repeat(s.length);
function stripCommentMarkers(comment, isBlockComment) {
  const lines = comment.split(/\r?\n/);
  return lines
    .map((line, i) => {
      // `/**`, `/*` or `//` opens the comment; on continuation lines a leading
      // `*` is JSDoc's gutter — but `*/` is the terminator, matched below, and
      // must not be eaten as a gutter marker.
      const out =
        i === 0
          ? line.replace(/^([ \t]*)(\/\*\*?|\/\/)/, (_m, ws, marker) => ws + blankOut(marker))
          : line.replace(/^([ \t]*)(\/\/|\*(?!\/))/, (_m, ws, marker) => ws + blankOut(marker));
      return isBlockComment && i === lines.length - 1 ? out.replace(/\*\/[ \t]*$/, blankOut) : out;
    })
    .join('\n');
}

/**
 * Every fenced code block inside the comments of one source file, with
 * `startLine` already translated into the SOURCE file's own 1-based lines.
 *
 * Returns blocks in exactly extractCodeBlocks' shape, so main() consumes a
 * markdown page and a `.tsx` file through the same path and neither can be
 * checked by a different rule than the other.
 */
function extractCommentCodeBlocks(file, text) {
  // The overwhelming majority of sources carry no fence at all; skip parsing
  // them rather than building an AST per file to find nothing.
  if (!text.includes('```') && !text.includes('~~~')) return [];

  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const blocks = [];
  for (const range of commentRanges(sf, text)) {
    const body = text.slice(range.pos, range.end);
    if (!body.includes('```') && !body.includes('~~~')) continue;
    // 0-based line of the comment's first character; extractCodeBlocks returns
    // a 1-based line within the text it was handed, so adding the two lands on
    // the source file's own 1-based line.
    const commentLine = sf.getLineAndCharacterOfPosition(range.pos).line;
    const isBlockComment = range.kind === ts.SyntaxKind.MultiLineCommentTrivia;
    for (const block of extractCodeBlocks(stripCommentMarkers(body, isBlockComment))) {
      blocks.push({ ...block, startLine: block.startLine + commentLine });
    }
  }
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

/**
 * Every `.md`/`.mdx` file this repository TRACKS, repo-relative and sorted.
 *
 * Enumerated from git rather than by walking the filesystem, and that is a
 * correctness requirement rather than a tidy-up. A walk sees whatever happens
 * to be on the disk it is run on, so the gate's verdict stopped being a
 * property of the commit:
 *
 *   - Gitignored trees under a guarded surface get SCANNED. Demonstrated with
 *     a fixture, not observed in the wild: dropping one markdown file into
 *     `packages/ui-bridge/coverage/` — gitignored, and inside the `packages/`
 *     surface — makes the pre-change checker fail on a developer's box over a
 *     file CI does not have. How likely a given generated tree is to contain
 *     markdown that trips a check is not the point; that the answer differs
 *     between two boxes at the same commit is.
 *   - The hardcoded skip list (`node_modules`, `dist`) was the only thing
 *     standing between the gate and those trees, and it was a list of the
 *     build outputs that existed when it was written. `.next/`, `build/`,
 *     `coverage/`, `target/` and every future one had to be remembered by
 *     hand — the same drift this whole script exists to refuse. That list is
 *     also what made `examples/` unsafe to add: `examples/tauri-app/src-tauri`
 *     is a real cargo crate whose `target/` is on neither the skip list nor
 *     `.gitignore`.
 *   - Untracked scratch files get judged as though the repo shipped them.
 *
 * Enumerating the index rather than the disk has one consequence worth naming:
 * a doc deleted or renamed but not yet staged is still listed. That is a hard
 * failure here (see docFiles), never a skip — see the note there.
 *
 * `.gitignore` already answers "does this repo own this file", is versioned
 * with the commit, and gives CI and a developer the same answer. It is also
 * what makes the `examples/` surface safe to add at all.
 *
 * Cannot-enumerate is a hard failure, never a quiet empty set: a gate that
 * passes because it found nothing to check is the one outcome this script may
 * not produce.
 */
function gitLsFiles(globs, what) {
  let raw;
  try {
    raw = execFileSync('git', ['-C', REPO_ROOT, 'ls-files', '-z', '--', ...globs], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    process.stderr.write(
      `Could not list this repository's ${what} with \`git ls-files\`:\n` +
        // git's own stderr says WHICH of the two cases this is — "not a git
        // repository" reads very differently from a missing binary — and the
        // wrapped `Command failed: ...` message says neither.
        `  ${String(err.stderr || '').trim() || err.message}\n` +
        'This gate enumerates the files it checks from git so that its verdict depends on the\n' +
        'commit and not on whatever happens to be built in the working tree. Without that list\n' +
        'it cannot tell a guarded page from a generated one, and reporting a pass it did not\n' +
        'earn is the single outcome it may not produce. Run it inside a git checkout.\n'
    );
    process.exit(1);
  }
  return raw.split('\0').filter(Boolean).sort();
}

let TRACKED_MARKDOWN = null;
function trackedMarkdown() {
  if (!TRACKED_MARKDOWN) TRACKED_MARKDOWN = gitLsFiles(['*.md', '*.mdx'], 'documentation');
  return TRACKED_MARKDOWN;
}

/**
 * Every tracked TypeScript-family source, for the comment surface.
 *
 * Same enumeration discipline and the same reasons as trackedMarkdown — see the
 * note above it, which is about where the file list comes from and applies
 * identically here. What differs is only what an empty answer means: markdown
 * is enumerated per surface and docFiles reports an emptied surface as unusable,
 * while this list has no roster to be empty against. A repository of TypeScript
 * packages that returns no TypeScript source has a broken enumeration, not zero
 * examples, so it is a hard failure rather than a quiet pass — the same rule
 * main() already applies to `files`.
 */
let TRACKED_SOURCES = null;
function trackedSources() {
  if (TRACKED_SOURCES) return TRACKED_SOURCES;
  const listed = gitLsFiles(
    SOURCE_EXTENSIONS.map((ext) => `*.${ext}`),
    'TypeScript-family sources'
  );
  // git lists the INDEX, so a source deleted or renamed but not yet staged is
  // still here. docFiles names that case for markdown because a doc surface can
  // be hollowed out by it; for sources the honest and proportionate answer is to
  // read what is on disk and let `git status` speak for the rest — a half-staged
  // rename must not turn this gate red on a file nobody edited.
  TRACKED_SOURCES = listed.filter((f) => fs.existsSync(path.join(REPO_ROOT, f)));
  return TRACKED_SOURCES;
}

/** Does repo-relative `file` sit on `surface`? */
function onSurface(surface, file) {
  const at = rel(surface.at);
  return surface.kind === 'file' ? file === at : file === at || file.startsWith(`${at}/`);
}

/**
 * Every tracked markdown file across DOC_SURFACES, de-duplicated and sorted.
 *
 * Returns `{ files, unusable }` rather than throwing: main() decides what a
 * broken surface means, and reporting all of them at once beats failing on the
 * first.
 *
 * A surface is unusable when it is absent, is the wrong kind, or contributes no
 * tracked markdown at all. That last one matters as much as the other two and
 * is what a bare existence check misses: `docs/` stays a directory long after
 * every page inside it has moved elsewhere, and a surface that silently
 * contributes nothing shrinks the checked set exactly the way a deleted one
 * does — while still reporting a pass.
 */
function docFiles() {
  const tracked = trackedMarkdown();
  const files = new Set();
  const unusable = [];
  for (const surface of DOC_SURFACES) {
    // Type, not just existence. A `tree` that has become a file (or a `file`
    // that has become a directory) would otherwise die on ENOTDIR/EISDIR with a
    // raw stack, several frames from here — losing the message written for
    // exactly this case.
    const stat = fs.statSync(surface.at, { throwIfNoEntry: false });
    const wrongType = stat && (surface.kind === 'file' ? !stat.isFile() : !stat.isDirectory());
    if (!stat || wrongType) {
      unusable.push({
        at: rel(surface.at),
        why: wrongType
          ? `expected a ${surface.kind === 'file' ? 'file' : 'directory'}`
          : 'does not exist',
        fix: 'Update DOC_SURFACES in this script to match where the docs actually live.',
      });
      continue;
    }
    const here = tracked.filter((f) => onSurface(surface, f));
    if (here.length === 0) {
      unusable.push({
        at: rel(surface.at),
        why:
          surface.kind === 'file'
            ? 'exists but is not tracked by git, so this gate cannot see it'
            : 'exists but contains no tracked .md/.mdx file',
        fix:
          surface.kind === 'file'
            ? `Run \`git add ${rel(surface.at)}\`, or drop it from DOC_SURFACES.`
            : 'Update DOC_SURFACES in this script to match where the docs actually live.',
      });
      continue;
    }
    // git lists the INDEX, so a page deleted or renamed but not yet staged is
    // still in `tracked`. Reading it would throw ENOENT several frames from
    // here, and skipping it would shrink the checked set silently — the one
    // thing this gate may not do. Name it instead.
    for (const f of here) {
      if (!fs.existsSync(path.join(REPO_ROOT, f))) {
        unusable.push({
          at: f,
          why: 'is tracked by git but missing from the working tree',
          fix: 'Stage the deletion or rename (`git add -A`), or restore the file.',
        });
        continue;
      }
      files.add(f);
    }
  }
  return { files: [...files].sort().map((f) => path.join(REPO_ROOT, f)), unusable };
}

/**
 * Tracked markdown that is on no guarded surface and named by no exemption —
 * plus the mirror image, exemptions that waive nothing.
 *
 * Both are failures; see UNGUARDED_DOCS for why the roster is checked in both
 * directions.
 */
function rosterDrift(guarded) {
  const tracked = trackedMarkdown();
  const onASurface = new Set(guarded.map((f) => rel(f)));
  const covers = (u, file) => file === u.at || file.startsWith(`${u.at}/`);

  // Counted per ENTRY, not per path: two entries may legitimately nest (a tree
  // plus one file inside it), and keying by `at` would both merge duplicates
  // and — because only the first match was credited — report the narrower one
  // as matching nothing. `exempts` is what the entry waives; `matches` is every
  // tracked file under it, guarded or not, which is how a still-real path that
  // a surface has since grown over is told apart from one that is simply gone.
  const exempts = UNGUARDED_DOCS.map(() => 0);
  const matches = UNGUARDED_DOCS.map(() => 0);

  const stray = new Set();
  for (const file of tracked) {
    let waived = false;
    UNGUARDED_DOCS.forEach((u, i) => {
      if (!covers(u, file)) return;
      matches[i] += 1;
      if (onASurface.has(file)) return;
      exempts[i] += 1;
      waived = true;
    });
    if (!waived && !onASurface.has(file)) stray.add(file);
  }

  const stale = UNGUARDED_DOCS.map((u, i) => ({
    ...u,
    // An entry waiving nothing is stale either way, but for opposite reasons,
    // and telling an author the wrong one sends them to the wrong fix.
    why:
      matches[i] === 0
        ? 'matches no tracked file — the exemption has outlived its files'
        : 'every file under it is now on a guarded surface, so it waives nothing',
  })).filter((_, i) => exempts[i] === 0);

  return { stray: [...stray].sort(), stale };
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

  const { files, unusable } = docFiles();
  if (unusable.length) {
    process.stderr.write(
      `${unusable.length} documentation surface(s) cannot be checked:\n` +
        unusable.map((u) => `   - ${u.at} — ${u.why}\n     ${u.fix}\n`).join('') +
        'A surface that has moved, been deleted, or been emptied must not quietly shrink the\n' +
        'checked set — that is a silent pass, which is the one failure mode this gate cannot\n' +
        'have, so each of these is reported rather than skipped.\n'
    );
    process.exit(1);
  }
  if (!files.length) {
    process.stderr.write('No documentation files found — nothing to check, which is not a pass.\n');
    process.exit(1);
  }

  // The roster's other direction: markdown that no surface covers and no
  // exemption names. See UNGUARDED_DOCS.
  const { stray, stale: staleExemptions } = rosterDrift(files);
  if (stray.length || staleExemptions.length) {
    if (stray.length) {
      process.stderr.write(
        `${stray.length} tracked documentation file(s) are on no guarded surface:\n` +
          stray.map((f) => `   - ${f}\n`).join('') +
          'Every .md/.mdx file in this repository must be either guarded or deliberately\n' +
          'exempt. Documentation that lands outside the roster is never checked and nothing\n' +
          'says so — which is exactly how README.md stayed ungated for a release after the\n' +
          'plan had already written down that it should not be.\n' +
          'Add the surface to DOC_SURFACES, or add the file to UNGUARDED_DOCS with a reason.\n'
      );
    }
    if (staleExemptions.length) {
      process.stderr.write(
        `${staleExemptions.length} UNGUARDED_DOCS exemption(s) waive nothing:\n` +
          staleExemptions.map((u) => `   - ${u.at} — ${u.why}\n`).join('') +
          'The exemption roster is exact and shrink-only, like the debt ledger: an exemption\n' +
          'that no longer waives anything silently re-authorises whatever moves back into\n' +
          'that path. Delete the entry from UNGUARDED_DOCS in this script.\n'
      );
    }
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

  // The comment surface. Enumerated here rather than inside the loop so an
  // enumeration that comes back empty is a failure at the same place, and for
  // the same reason, as an empty `files`: this repository is TypeScript
  // packages, so "no TypeScript source" is a broken list, not a clean bill.
  const sources = trackedSources();
  if (!sources.length) {
    process.stderr.write(
      'No TypeScript-family source files found — this repository is TypeScript packages, so\n' +
        'an empty list is a broken enumeration rather than an absence of examples, and a gate\n' +
        'that passes for want of anything to check is worse than one that fails.\n'
    );
    process.exit(1);
  }

  const documents = [
    ...files.map((file) => ({
      file,
      blocks: extractCodeBlocks(fs.readFileSync(file, 'utf8')),
    })),
    ...sources.map((f) => {
      const file = path.join(REPO_ROOT, f);
      const blocks = extractCommentCodeBlocks(file, fs.readFileSync(file, 'utf8'));
      return { file, source: true, blocks };
    }),
  ];

  const failures = [];
  const accepted = [];
  let blocksChecked = 0;
  let sourceBlocksChecked = 0;
  let importsSeen = 0;
  let importsInScope = 0;
  const opaqueEntries = new Map();
  const externalEntries = new Map();

  for (const document of documents) {
    const { file } = document;
    for (const block of document.blocks) {
      const isTs = TS_FENCE_LANGS.has(block.lang);
      const embedsScript = SCRIPT_EMBEDDING_FENCE_LANGS.has(block.lang);
      if (!isTs && !embedsScript) continue;
      blocksChecked += 1;
      if (document.source) sourceBlocksChecked += 1;
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
    const hadLedger = fs.existsSync(DEBT_LEDGER);
    writeLedger(liveSignatures);
    process.stdout.write(
      liveSignatures.length === 0
        ? `docs:symbol-debt:update — no quarantined failure(s) remain; ` +
            (hadLedger
              ? `${rel(DEBT_LEDGER)} removed. The ledger is paid off.\n`
              : `${rel(DEBT_LEDGER)} was already absent. Nothing to record.\n`)
        : `docs:symbol-debt:update — recorded ${liveSignatures.length} quarantined failure(s) ` +
            `across ${new Set(liveSignatures.map((sig) => sig.split(' :: ')[0])).size} page(s) in ` +
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
        `(${DOC_SURFACES.map((s) => rel(s.at)).join(', ')}), and in the COMMENTS of\n` +
        `every tracked .${SOURCE_EXTENSIONS.join('/.')} source, must name a real\n` +
        'workspace package, a subpath its package.json "exports" map publishes, and symbols\n' +
        'that entry point actually exports. Docusaurus checks links and MDX syntax; it never\n' +
        'name-checks a code block, which is how a nonexistent package and three nonexistent\n' +
        'exports shipped to the published site behind a green build — and nothing at all was\n' +
        'checking a JSDoc @example, which is the copy an IDE hover puts in front of a reader.\n\n' +
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
      `, across ${blocksChecked} TypeScript code block(s) — ${blocksChecked - sourceBlocksChecked} ` +
      `in ${files.length} doc page(s), ${sourceBlocksChecked} in the comments of ` +
      `${sources.length} tracked source(s) — (${importsSeen} import statement(s) seen, ` +
      `${importsInScope} in scope).\n`
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
  'Each line is one known-broken import on a guarded surface — as of this write, the markdown',
  `surfaces ${DOC_SURFACES.map((s) => rel(s.at)).join(', ')} plus the comments of every tracked`,
  `.${SOURCE_EXTENSIONS.join('/.')} source — in the form`,
  '"<page> :: <kind> :: <specifier>[ :: <symbol>]". scripts/check-docs-symbols.cjs fails on any',
  'failure NOT listed here, and ALSO fails when a listed entry stops reproducing — so paid-off',
  'debt cannot linger and re-authorise the same defect. Regenerate with',
  '`npm run docs:symbol-debt:update`; growing this file is a reviewable act of declaring new debt.',
  'The surface list above is a snapshot taken when this file was last regenerated; what is',
  'actually enforced is DOC_SURFACES and SOURCE_EXTENSIONS in scripts/check-docs-symbols.cjs.',
  'This comment describes the MECHANISM only. It deliberately does not narrate whatever finding',
  'currently populates the ledger: a comment that names a specific finding outlives it, and',
  'shipping prose that is no longer true is the exact defect class this gate exists to catch.',
  'Read `entries` for what is quarantined now; read git history for why each line was added.',
];

function readLedger() {
  if (!fs.existsSync(DEBT_LEDGER)) return [];
  const json = JSON.parse(fs.readFileSync(DEBT_LEDGER, 'utf8'));
  return Array.isArray(json.entries) ? [...json.entries].sort() : [];
}

/**
 * Write the ledger — or DELETE it when there is nothing left to quarantine.
 *
 * The empty case is not a corner: it is the end state every ratchet aims at,
 * and it must be symmetric with `readLedger`, which already reads an ABSENT
 * file as "no quarantined failures" (`existsSync` -> `[]`). Writing
 * `{"entries": []}` instead leaves a husk that says nothing `readLedger` does
 * not already infer, and — worse — silently RESURRECTS the file after a
 * `git rm`, because `--update` writes unconditionally. That resurrection is
 * how a paid-off ledger comes back carrying prose about a finding that is
 * gone.
 *
 * So: zero signatures deletes the file. The paid-off state is the ABSENCE of
 * the file, and one `git rm` expresses it durably.
 */
function writeLedger(signatures) {
  if (signatures.length === 0) {
    if (fs.existsSync(DEBT_LEDGER)) fs.unlinkSync(DEBT_LEDGER);
    return;
  }
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
