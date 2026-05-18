#!/usr/bin/env node
// Diagnostics drift gate.
//
// Re-runs the generator (scripts/gen-diagnostics.ts) and fails if any of the
// three generated mirrors differ from what's committed. Wire into CI alongside
// the other *:check steps.
//
// Plan: D:/qontinui-root/plans/2026-05-18-ui-bridge-diagnostic-discipline-plan.md  Phase 0

'use strict';

const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const UIBRIDGE_ROOT = resolve(__dirname, '..');
const SCHEMAS_RUST_DIR =
  process.env.QONTINUI_SCHEMAS_RUST_DIR ||
  resolve(UIBRIDGE_ROOT, '..', 'tmp_wt_schemas_diag_w1', 'rust');

const TS_OUT = 'packages/ui-bridge/src/diagnostics/codes.generated.ts';
const PY_OUT = 'packages/ui-bridge-python/ui_bridge/diagnostics.py';
const MD_OUT = 'packages/ui-bridge/docs/diagnostics.md';
const RUST_OUT_ABS = resolve(SCHEMAS_RUST_DIR, 'src', 'ui_bridge_diagnostics.rs');

function run(cmd, args, opts) {
  return execFileSync(cmd, args, { encoding: 'utf8', ...opts });
}

function gitDirty(cwd, paths) {
  try {
    const out = run('git', ['status', '--porcelain', '--', ...paths], { cwd });
    return out.trim();
  } catch (e) {
    // Not a git repo / git unavailable: skip the diff check for that tree but
    // surface it loudly rather than passing silently.
    console.error(`WARN: could not run git status in ${cwd}: ${e.message}`);
    return '';
  }
}

// 1. Regenerate.
run(process.execPath, ['--experimental-strip-types', 'scripts/gen-diagnostics.ts'], {
  cwd: UIBRIDGE_ROOT,
  stdio: 'inherit',
});

// 2. Diff-check the two ui-bridge-tree outputs.
const uiDirty = gitDirty(UIBRIDGE_ROOT, [TS_OUT, PY_OUT, MD_OUT]);

// 3. Diff-check the Rust mirror in the schemas tree.
const rustDirty = gitDirty(SCHEMAS_RUST_DIR, [RUST_OUT_ABS]);

if (uiDirty || rustDirty) {
  console.error('');
  console.error(
    'ERROR: generated diagnostics mirrors are out of date with diagnostics/codes.json.'
  );
  console.error('Run `npm run diagnostics:generate` and commit the result.');
  console.error('');
  if (uiDirty) console.error(uiDirty);
  if (rustDirty) console.error(rustDirty);
  process.exit(1);
}

console.log('diagnostics:check OK — generated mirrors match diagnostics/codes.json');
