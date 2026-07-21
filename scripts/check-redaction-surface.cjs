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
// Surface = two committed sets in packages/ui-bridge/redaction-surface.manifest.json:
//   1. `routes`            — every entry in `UI_BRIDGE_ROUTES` (server/types.ts).
//                            A new client-reachable route is the way a new leak
//                            reaches a client; adding one must be a deliberate,
//                            reviewed act.
//   2. `projectionModules` — the eslint Layer-2 `files` list (delimited by
//                            `redaction-surface:projection-modules:{start,end}`
//                            sentinels in eslint.config.js). Kept in lockstep so
//                            the guarded surface is a single committed artifact,
//                            and each entry is proven to still resolve to a file.
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

// --- 2. Live projection modules from eslint.config.js sentinels ------------
function liveProjectionModules() {
  const src = fs.readFileSync(ESLINT_CONFIG, 'utf8');
  const start = src.indexOf('redaction-surface:projection-modules:start');
  const end = src.indexOf('redaction-surface:projection-modules:end');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      'Could not find the redaction-surface:projection-modules:{start,end} sentinels in eslint.config.js'
    );
  }
  const block = src.slice(start, end);
  const globs = [...block.matchAll(/'([^']*packages\/ui-bridge\/src\/[^']*)'/g)].map((m) => m[1]);
  return [...new Set(globs)].sort();
}

// --- 3. Prove each projection-module glob still resolves to a file ---------
function unresolvedModules(modules) {
  const missing = [];
  for (const glob of modules) {
    const abs = path.join(REPO_ROOT, glob);
    if (glob.includes('*')) {
      // Support the one shape in use: "<dir>/**/*.ts".
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
try {
  surface = {
    $comment:
      'Committed §4.6 redaction surface (routes + Layer-2 projection modules). ' +
      'Auto-generated — regenerate with `npm run redaction:surface:update`. ' +
      'A drift here fails CI so a new route/projection gets a conscious redaction decision. ' +
      'Plan: plans/2026-07-20-ui-bridge-structural-redaction-enforcement.md (Layer 3).',
    projectionModules: liveProjectionModules(),
    routes: liveRoutes(),
  };
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

if (UPDATE) {
  fs.writeFileSync(MANIFEST, JSON.stringify(surface, null, 2) + '\n');
  console.log(
    `redaction:surface:update — wrote ${surface.routes.length} routes, ` +
      `${surface.projectionModules.length} projection modules to redaction-surface.manifest.json`
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
const missing = unresolvedModules(surface.projectionModules);

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

if (missing.length) {
  failed = true;
  console.error('');
  console.error(
    'ERROR: a §4.6 projection module no longer resolves to any file — its guard coverage is dead:'
  );
  for (const m of missing) console.error(`   ! ${m}`);
}

if (failed) process.exit(1);

console.log(
  `redaction:check-surface OK — ${surface.routes.length} routes, ` +
    `${surface.projectionModules.length} projection modules match the committed surface`
);
