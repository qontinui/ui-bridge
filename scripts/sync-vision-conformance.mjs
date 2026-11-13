#!/usr/bin/env node
// Vision assertion conformance fixture vendoring: qontinui-schemas -> ui-bridge.
//
// vision-core (qontinui-schemas `rust-vision-core`) owns the conformance
// fixture that pins the vision assertion DSL's verdicts:
// `rust-vision-core/tests/fixtures/vision_assertions_conformance.json`, one
// `(ElementSnapshot, assertion) -> (outcome, code)` case per row, run by
// `cargo test` there. The SDK's in-tab evaluator (packages/ui-bridge/src/vision/
// assertion-eval.ts) is a TypeScript port of that evaluator, and
// `assertion-eval.conformance.test.ts` runs the port over every case of a
// VENDORED copy, so the port cannot drift from vision-core unseen. Plan
// 2026-11-09-ui-bridge-relay-evaluates-vision-assertions-in-the-tab, Phases 0-1.
//
// ui-bridge takes no dependency on qontinui-schemas (it is a standalone npm
// package), so the copy is vendored by this script — the idiom of
// scripts/sync-observation.mjs, across a repository boundary. The copy is
// byte-identical to the fixture it was read from; a sidecar beside it records
// where that was and the copy's sha256.
//
//   node scripts/sync-vision-conformance.mjs --schemas <qontinui-schemas checkout> [--ref <git ref>]
//   node scripts/sync-vision-conformance.mjs --file <fixture.json>
//       write the vendored copy and its sidecar. With --ref the fixture is
//       read from that commit (`git show <ref>:<path>`), never the working
//       tree; without it, from the checkout's working tree.
//
//   node scripts/sync-vision-conformance.mjs --check
//       exit 1 when the vendored copy is not the bytes its sidecar records —
//       a hand edit. Needs no qontinui-schemas checkout, so CI and the
//       conformance test can run it.
//   node scripts/sync-vision-conformance.mjs --check --schemas <dir> [--ref <ref>] | --file <path>
//       also exit 1 when the vendored copy differs from that source: drift.
//
// A case that disagrees with the port is a finding about the PORT (vision-core
// is the reference model). Never edit the vendored fixture by hand to make a
// case pass — re-sync it, or report the case.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_PATH = 'rust-vision-core/tests/fixtures/vision_assertions_conformance.json';
const TARGET_DIR = join(ROOT, 'packages', 'ui-bridge', 'src', 'vision', 'conformance');
const TARGET = join(TARGET_DIR, 'vision-assertions.json');
const SIDECAR = join(TARGET_DIR, 'vision-assertions.source.json');

/**
 * The sha256 the sidecar records: over the bytes with CRLF folded to LF. The
 * conformance test recomputes it the same way.
 */
function fixtureDigest(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { check: false, schemas: null, ref: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--schemas') args.schemas = argv[++i];
    else if (a === '--ref') args.ref = argv[++i];
    else if (a === '--file') args.file = argv[++i];
    else
      fail(`unknown argument ${a} (expected --check, --schemas <dir>, --ref <ref>, --file <path>)`);
  }
  if (args.schemas === undefined || args.ref === undefined || args.file === undefined) {
    fail('--schemas, --ref and --file each take a value');
  }
  if (args.file && (args.schemas || args.ref)) fail('--file excludes --schemas and --ref');
  if (args.ref && !args.schemas) fail('--ref needs --schemas <qontinui-schemas checkout>');
  return args;
}

/** Read the fixture from the source the arguments name: { text, source } or null. */
function readSource(args) {
  if (args.file) {
    const path = resolve(args.file);
    if (!existsSync(path)) fail(`no fixture at ${path}`);
    return {
      text: readFileSync(path, 'utf8'),
      source: { kind: 'file', repo: null, path: args.file, ref: null, commit: null },
    };
  }
  if (!args.schemas) return null;
  const dir = resolve(args.schemas);
  if (args.ref) {
    const git = (...cmd) => execFileSync('git', ['-C', dir, ...cmd], { encoding: 'utf8' });
    let commit;
    try {
      commit = git('rev-parse', '--verify', `${args.ref}^{commit}`).trim();
    } catch {
      fail(`${args.ref} does not name a commit in ${dir} (fetch it first)`);
    }
    let text;
    try {
      text = git('show', `${commit}:${FIXTURE_PATH}`);
    } catch {
      fail(`${commit} carries no ${FIXTURE_PATH}`);
    }
    return {
      text,
      source: {
        kind: 'git',
        repo: 'qontinui/qontinui-schemas',
        path: FIXTURE_PATH,
        ref: args.ref,
        commit,
      },
    };
  }
  const path = join(dir, FIXTURE_PATH);
  if (!existsSync(path)) fail(`no fixture at ${path}`);
  return {
    text: readFileSync(path, 'utf8'),
    source: {
      kind: 'working-tree',
      repo: 'qontinui/qontinui-schemas',
      path: FIXTURE_PATH,
      ref: null,
      commit: null,
    },
  };
}

/** Refuse anything that is not a fixture in the format the conformance test reads. */
function validate(text, where) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    fail(`${where} is not JSON: ${e.message}`);
  }
  if (doc?.version !== 1) fail(`${where}: version must be 1, got ${JSON.stringify(doc?.version)}`);
  if (doc.generated_from !== 'qontinui-vision-core') {
    fail(`${where}: generated_from must be "qontinui-vision-core"`);
  }
  if (!Array.isArray(doc.cases) || doc.cases.length === 0)
    fail(`${where}: cases must be a non-empty array`);
  const ids = new Set();
  doc.cases.forEach((c, i) => {
    const at = `${where}: cases[${i}]`;
    if (typeof c?.id !== 'string' || ids.has(c.id)) fail(`${at}.id must be a unique string`);
    ids.add(c.id);
    if (typeof c.kind !== 'string') fail(`${at}.kind must be a string`);
    if (c.assertion?.type !== c.kind) fail(`${at}.assertion.type must equal its kind`);
    if (!('snapshot' in c)) fail(`${at} has no snapshot (null is allowed, absence is not)`);
    const { outcome, code } = c.expected ?? {};
    if (!['passed', 'failed', 'unknown'].includes(outcome))
      fail(`${at}.expected.outcome is invalid`);
    if ((outcome === 'unknown') !== (typeof code === 'string')) {
      fail(`${at}.expected.code must be a string exactly when the outcome is unknown`);
    }
  });
  return doc;
}

function readVendored() {
  if (!existsSync(TARGET) || !existsSync(SIDECAR)) {
    fail(
      `${relative(ROOT, TARGET)} or its sidecar is missing; vendor the fixture with ` +
        '`node scripts/sync-vision-conformance.mjs --schemas <qontinui-schemas> --ref <ref>`'
    );
  }
  return { text: readFileSync(TARGET, 'utf8'), sidecar: JSON.parse(readFileSync(SIDECAR, 'utf8')) };
}

const args = parseArgs(process.argv.slice(2));
const source = readSource(args);

if (args.check) {
  const vendored = readVendored();
  const digest = fixtureDigest(vendored.text);
  if (digest !== vendored.sidecar.sha256) {
    fail(
      `${relative(ROOT, TARGET)} is not the fixture its sidecar records (sha256 ${digest}, ` +
        `recorded ${vendored.sidecar.sha256}): it was edited by hand. Re-sync it from ` +
        'qontinui-schemas; a case that disagrees with the port is reported, never edited.'
    );
  }
  validate(vendored.text, relative(ROOT, TARGET));
  if (source) {
    validate(source.text, 'the source fixture');
    if (fixtureDigest(source.text) !== digest) {
      const from = source.source.commit ?? source.source.path;
      fail(
        `${relative(ROOT, TARGET)} has drifted from ${from}. Run ` +
          '`node scripts/sync-vision-conformance.mjs` with the same source and commit the result.'
      );
    }
  }
  const pinned = vendored.sidecar.commit ? ` (${vendored.sidecar.commit})` : '';
  console.log(
    `vision-conformance:check OK — ${relative(ROOT, TARGET)} is the recorded fixture${pinned}` +
      (source ? ' and matches the source given' : '')
  );
} else {
  if (!source) fail('name the fixture to vendor: --schemas <dir> [--ref <ref>], or --file <path>');
  const doc = validate(source.text, 'the source fixture');
  mkdirSync(TARGET_DIR, { recursive: true });
  writeFileSync(TARGET, source.text);
  const sidecar = {
    $comment:
      '@generated by scripts/sync-vision-conformance.mjs — do not edit. Records where ' +
      'vision-assertions.json was vendored from and its sha256 (CRLF folded to LF); ' +
      '`node scripts/sync-vision-conformance.mjs --check` fails when the copy is edited by hand.',
    ...source.source,
    sha256: fixtureDigest(source.text),
    cases: doc.cases.length,
  };
  writeFileSync(SIDECAR, JSON.stringify(sidecar, null, 2) + '\n');
  console.log(
    `vision-conformance:sync wrote ${relative(ROOT, TARGET)} (${doc.cases.length} cases` +
      (source.source.commit ? `, ${source.source.commit}` : '') +
      ')'
  );
}
