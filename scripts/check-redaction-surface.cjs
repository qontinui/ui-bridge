#!/usr/bin/env node
// §4.6 redaction surface ratchet (plan Phase 6, Layer 3).
//
// Layers 1-2 (eslint.config.js) ban raw DOM content reads, but ONLY inside the
// files they enumerate — `no-restricted-syntax` cannot notice a *new file* or a
// *new client-reachable route*. This script is the file-list / route-list
// ratchet: it recomputes the redaction surface from source and fails when it
// drifts from the committed manifest, forcing a conscious redaction decision on
// every surface change (the plan's goal: change the default from "silently
// leak" to "fail the build").
//
// Surface = four committed sets in packages/ui-bridge/redaction-surface.manifest.json:
//   1. `routes`            — every entry in `UI_BRIDGE_ROUTES` (server/types.ts).
//                            A new client-reachable route is the way a new leak
//                            reaches a client; adding one must be a deliberate,
//                            reviewed act.
//   2. `projectionModules` — the eslint Layer-2 `files` list (delimited by
//                            `redaction-surface:projection-modules:{start,end}`
//                            sentinels in eslint.config.js). Kept in lockstep so
//                            the guarded surface is a single committed artifact,
//                            and each entry is proven to still resolve to a file.
//   3. `packageGuardExemptions` — the eslint Layer-1 `ignores` list (sentinels
//                            `redaction-surface:package-guard-exemptions:{start,end}`).
//                            Every entry is EXEMPT from all §4.6 rules — the
//                            sanctioned-reader allowlist is the guard's one
//                            escape hatch, so widening it must trip the ratchet.
//   4. `projectionModuleIgnores` — the eslint Layer-2 `ignores` list (sentinels
//                            `redaction-surface:projection-module-ignores:{start,end}`).
//                            An added entry silently disables the raw-read ban
//                            for a projection module while the `files` list
//                            still matches — only test globs belong here.
//
// Usage:
//   node scripts/check-redaction-surface.cjs            # verify (CI, before Lint)
//   node scripts/check-redaction-surface.cjs --update   # regenerate the manifest
//
// Plan: D:/qontinui-root/plans/2026-07-20-ui-bridge-structural-redaction-enforcement.md  (Layer 3)

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const REPO_ROOT = path.resolve(__dirname, '..');
const TYPES_TS = path.join(REPO_ROOT, 'packages/ui-bridge/src/server/types.ts');
const ESLINT_CONFIG = path.join(REPO_ROOT, 'eslint.config.js');
const MANIFEST = path.join(REPO_ROOT, 'packages/ui-bridge/redaction-surface.manifest.json');

const UPDATE = process.argv.includes('--update');

// --- 1. Live routes from UI_BRIDGE_ROUTES (TS AST) --------------------------
function liveRoutes() {
  const src = fs.readFileSync(TYPES_TS, 'utf8');
  const sf = ts.createSourceFile(TYPES_TS, src, ts.ScriptTarget.Latest, true);
  let arr = null;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'UI_BRIDGE_ROUTES' &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      arr = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!arr) {
    throw new Error(`Could not find UI_BRIDGE_ROUTES array literal in ${TYPES_TS}`);
  }
  const routes = [];
  for (const el of arr.elements) {
    if (!ts.isObjectLiteralExpression(el)) {
      throw new Error(
        'UI_BRIDGE_ROUTES contains a non-object-literal entry (spread/computed?). ' +
          'The ratchet needs plain { method, path, handler } literals — update the parser.'
      );
    }
    const get = (key) => {
      const prop = el.properties.find(
        (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === key
      );
      if (!prop || !ts.isStringLiteralLike(prop.initializer)) return null;
      return prop.initializer.text;
    };
    const method = get('method');
    const routePath = get('path');
    const handler = get('handler');
    if (!method || !routePath || !handler) {
      throw new Error(
        `UI_BRIDGE_ROUTES entry is missing a string method/path/handler near "${el.getText(sf).slice(0, 80)}"`
      );
    }
    routes.push(`${method} ${routePath} -> ${handler}`);
  }
  // Stable, order-independent (route table order is not semantically meaningful).
  // De-duped: two entries that stringify identically collapse. That is safe for
  // this ratchet's purpose — it exists to catch a NEW client-reachable route
  // (an addition always yields a distinct string and trips the check); a pair of
  // literal duplicates is a route-table authoring bug caught by review, not a
  // redaction concern. There are no duplicates today (198 entries, 198 unique).
  return [...new Set(routes)].sort();
}

// --- 2. Live eslint-surface lists from eslint.config.js sentinels ----------
const SENTINEL_NAMES = [
  'projection-modules',
  'package-guard-exemptions',
  'projection-module-ignores',
];
const SRC_PREFIX = 'packages/ui-bridge/src/';

function sentinelRange(src, name) {
  const startMarker = `redaction-surface:${name}:start`;
  const endMarker = `redaction-surface:${name}:end`;
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Could not find the redaction-surface:${name}:{start,end} sentinels in eslint.config.js`
    );
  }
  return [start + startMarker.length, end];
}

// Generic sentinel-block extractor. FAILS CLOSED on any entry shape it does
// not understand: after stripping `//` comment lines, every single-quoted
// string in the block must start with `packages/ui-bridge/src/`, and the
// remaining code must contain no spread / template literal / double-quoted
// string — otherwise an ignores entry written in another idiomatic shape
// (`'**/*.stories.ts'`, `...SHARED_GLOBS`, a backtick string) would be an
// eslint-effective exemption that is INVISIBLE to this ratchet, which is the
// exact silent-guard-disable the ratchet exists to prevent.
function liveSentinelList(name) {
  const src = fs.readFileSync(ESLINT_CONFIG, 'utf8');
  const [start, end] = sentinelRange(src, name);
  const block = src.slice(start, end);
  // Strip line comments so prose (backticks, apostrophes, path mentions)
  // cannot be mistaken for — or hide — array entries. Quotes never span
  // lines here ([^'\n]), so an apostrophe in a trailing comment cannot flip
  // quote parity for later lines.
  const code = block
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  const strings = [...code.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]);
  const bad = strings.filter((s) => !s.startsWith(SRC_PREFIX));
  if (bad.length) {
    throw new Error(
      `redaction-surface:${name}: entries the ratchet cannot track (must be single-quoted ` +
        `'${SRC_PREFIX}...' literals): ${bad.join(', ')}`
    );
  }
  const residue = code.replace(/'[^'\n]*'/g, '');
  if (/\.\.\.|`|"/.test(residue)) {
    throw new Error(
      `redaction-surface:${name}: the block contains a spread, template literal or ` +
        `double-quoted string — the ratchet only understands single-quoted ` +
        `'${SRC_PREFIX}...' literals. Rewrite the entry or extend the parser.`
    );
  }
  return [...new Set(strings)].sort();
}
const liveProjectionModules = () => liveSentinelList('projection-modules');
const livePackageGuardExemptions = () => liveSentinelList('package-guard-exemptions');
const liveProjectionModuleIgnores = () => liveSentinelList('projection-module-ignores');

// Layer-0 backstop: every `'packages/ui-bridge/src/...'` string in
// eslint.config.js must sit INSIDE one of the three ratcheted sentinel blocks,
// except the Layer-1 `files` pair (allowlisted verbatim, so NARROWING the
// Layer-1 scope also trips this). Catches the third escape hatch: a src path
// added to the GLOBAL ignores block (which exempts the file from every rule,
// §4.6 included — the "generated file → global ignore" path is idiomatic), or
// a new config block targeting src files outside the ratchet's view.
const LAYER1_FILES_ALLOWLIST = new Set([
  'packages/ui-bridge/src/**/*.ts',
  'packages/ui-bridge/src/**/*.tsx',
]);
function unratchetedSrcRefs() {
  const src = fs.readFileSync(ESLINT_CONFIG, 'utf8');
  const ranges = SENTINEL_NAMES.map((n) => sentinelRange(src, n));
  const offenders = [];
  for (const m of src.matchAll(/'([^'\n]*)'/g)) {
    const s = m[1];
    if (!s.includes(SRC_PREFIX)) continue;
    if (LAYER1_FILES_ALLOWLIST.has(s)) continue;
    const inSentinel = ranges.some(([a, b]) => m.index >= a && m.index < b);
    if (!inSentinel) offenders.push(s);
  }
  return offenders;
}

// --- 3. Prove each listed path still resolves to a file --------------------
// Concrete paths get a real existence check (a renamed module or sanctioned
// reader leaves a dead entry). Glob entries only prove their base dir still
// contains TS — meaningful for "<dir>/**/*.ts" projection shapes like
// recording/**; vacuous for package-rooted test globs (dead-pattern detection
// is not attempted for those).
function unresolvedModules(modules) {
  const missing = [];
  for (const glob of modules) {
    const abs = path.join(REPO_ROOT, glob);
    if (glob.includes('*')) {
      const base = path.join(REPO_ROOT, glob.slice(0, glob.indexOf('*')).replace(/\/$/, ''));
      if (!dirHasTs(base)) missing.push(glob);
    } else if (!fs.existsSync(abs)) {
      missing.push(glob);
    }
  }
  return missing;
}
function dirHasTs(dir) {
  let ok = false;
  const walk = (d) => {
    if (ok || !fs.existsSync(d)) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (ok) return;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.ts') || ent.name.endsWith('.tsx')) ok = true;
    }
  };
  walk(dir);
  return ok;
}

function diff(committed, live) {
  const c = new Set(committed);
  const l = new Set(live);
  return {
    added: live.filter((x) => !c.has(x)), // present in source, absent from manifest
    removed: committed.filter((x) => !l.has(x)), // in manifest, gone from source
  };
}

// --- main ------------------------------------------------------------------
let surface;
let unratcheted;
try {
  surface = {
    $comment:
      'Committed §4.6 redaction surface (routes + Layer-2 projection modules + guard exemption lists). ' +
      'Auto-generated — regenerate with `npm run redaction:surface:update`. ' +
      'A drift here fails CI so a new route/projection/exemption gets a conscious redaction decision. ' +
      'Plan: plans/2026-07-20-ui-bridge-structural-redaction-enforcement.md (Layer 3).',
    packageGuardExemptions: livePackageGuardExemptions(),
    projectionModuleIgnores: liveProjectionModuleIgnores(),
    projectionModules: liveProjectionModules(),
    routes: liveRoutes(),
  };
  unratcheted = unratchetedSrcRefs();
} catch (e) {
  // Fail closed with an actionable message rather than a raw stack. Reached if
  // UI_BRIDGE_ROUTES changed shape (e.g. shorthand `{ method }`, quoted keys, a
  // spread, or a computed value) beyond what the AST parser handles.
  console.error('ERROR: could not compute the §4.6 redaction surface from source:');
  console.error(`  ${e.message}`);
  console.error(
    '  If the route table style changed, update the parser in scripts/check-redaction-surface.cjs.'
  );
  process.exit(1);
}

// The Layer-0 backstop fails BOTH modes — an unratcheted src ref cannot be
// recorded into the manifest; it must be moved into a sentinel block (or, for
// a deliberate Layer-1 `files` change, added to LAYER1_FILES_ALLOWLIST here).
if (unratcheted.length) {
  console.error('');
  console.error(
    "ERROR: eslint.config.js references a 'packages/ui-bridge/src/...' path OUTSIDE the"
  );
  console.error(
    '       ratcheted §4.6 sentinel blocks. A src path in the global ignores (or a new config'
  );
  console.error(
    '       block) can exempt files from every §4.6 rule invisibly to this ratchet. Move the'
  );
  console.error(
    '       entry into a sentinel-tracked list, or update the parser/allowlist consciously.'
  );
  for (const s of unratcheted) console.error(`   ! ${s}`);
  process.exit(1);
}

if (UPDATE) {
  fs.writeFileSync(MANIFEST, JSON.stringify(surface, null, 2) + '\n');
  console.log(
    `redaction:surface:update — wrote ${surface.routes.length} routes, ` +
      `${surface.projectionModules.length} projection modules, ` +
      `${surface.packageGuardExemptions.length} guard exemptions, ` +
      `${surface.projectionModuleIgnores.length} projection ignores to redaction-surface.manifest.json`
  );
  process.exit(0);
}

if (!fs.existsSync(MANIFEST)) {
  console.error(
    'ERROR: packages/ui-bridge/redaction-surface.manifest.json is missing. ' +
      'Run `npm run redaction:surface:update` and commit it.'
  );
  process.exit(1);
}

const committed = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const routeDiff = diff(committed.routes || [], surface.routes);
const modDiff = diff(committed.projectionModules || [], surface.projectionModules);
const exemptDiff = diff(committed.packageGuardExemptions || [], surface.packageGuardExemptions);
const ignoreDiff = diff(committed.projectionModuleIgnores || [], surface.projectionModuleIgnores);
// Existence-check both file lists — with opposite dispositions: a projection
// module that no longer resolves is DEAD GUARD COVERAGE; an exemption that no
// longer resolves is a DEAD ALLOWLIST ENTRY (a renamed sanctioned reader).
const missingModules = unresolvedModules(surface.projectionModules);
const missingExemptions = unresolvedModules(surface.packageGuardExemptions);

let failed = false;

if (routeDiff.added.length || routeDiff.removed.length) {
  failed = true;
  console.error('');
  console.error(
    'ERROR: the UI Bridge route surface changed. A new or renamed route may project element'
  );
  console.error(
    '       content to a client. Confirm its §4.6 redaction disposition (does it emit element'
  );
  console.error(
    '       value/textContent/labels? if so, route through core/redaction minters), then run'
  );
  console.error('       `npm run redaction:surface:update` and commit the manifest.');
  for (const r of routeDiff.added) console.error(`   + (new in source)   ${r}`);
  for (const r of routeDiff.removed) console.error(`   - (gone from source) ${r}`);
}

if (modDiff.added.length || modDiff.removed.length) {
  failed = true;
  console.error('');
  console.error(
    'ERROR: the §4.6 Layer-2 projection-module list (eslint.config.js) drifted from the manifest.'
  );
  console.error('       Run `npm run redaction:surface:update` and commit the manifest.');
  for (const m of modDiff.added) console.error(`   + (new in eslint) ${m}`);
  for (const m of modDiff.removed) console.error(`   - (gone from eslint) ${m}`);
}

if (exemptDiff.added.length || exemptDiff.removed.length) {
  failed = true;
  console.error('');
  console.error(
    'ERROR: the §4.6 Layer-1 guard-exemption list (eslint.config.js ignores) drifted from the'
  );
  console.error(
    '       manifest. An exempted file is OUTSIDE every §4.6 lint rule — adding one beside the'
  );
  console.error(
    '       sanctioned readers (core/redaction.ts, core/a11y.ts) opens a raw-read channel and'
  );
  console.error(
    '       must be a deliberate, reviewed act. Confirm the redaction disposition, then run'
  );
  console.error('       `npm run redaction:surface:update` and commit the manifest.');
  for (const m of exemptDiff.added) console.error(`   + (new in eslint) ${m}`);
  for (const m of exemptDiff.removed) console.error(`   - (gone from eslint) ${m}`);
}

if (ignoreDiff.added.length || ignoreDiff.removed.length) {
  failed = true;
  console.error('');
  console.error(
    'ERROR: the §4.6 Layer-2 ignore list (eslint.config.js) drifted from the manifest. An entry'
  );
  console.error(
    '       here disables the raw-read ban for a projection module while the module list still'
  );
  console.error(
    '       matches — only test globs belong here. Confirm the redaction disposition, then run'
  );
  console.error('       `npm run redaction:surface:update` and commit the manifest.');
  for (const m of ignoreDiff.added) console.error(`   + (new in eslint) ${m}`);
  for (const m of ignoreDiff.removed) console.error(`   - (gone from eslint) ${m}`);
}

if (missingModules.length) {
  failed = true;
  console.error('');
  console.error(
    'ERROR: a §4.6 projection module no longer resolves to any file — its guard coverage is dead:'
  );
  for (const m of missingModules) console.error(`   ! ${m}`);
}

if (missingExemptions.length) {
  failed = true;
  console.error('');
  console.error(
    'ERROR: a §4.6 guard-exemption entry no longer resolves to any file — a dead allowlist'
  );
  console.error(
    '       entry (renamed sanctioned reader?). Remove or update it in eslint.config.js, then'
  );
  console.error('       run `npm run redaction:surface:update`.');
  for (const m of missingExemptions) console.error(`   ! ${m}`);
}

if (failed) process.exit(1);

console.log(
  `redaction:check-surface OK — ${surface.routes.length} routes, ` +
    `${surface.projectionModules.length} projection modules, ` +
    `${surface.packageGuardExemptions.length} guard exemptions, ` +
    `${surface.projectionModuleIgnores.length} projection ignores match the committed surface`
);
