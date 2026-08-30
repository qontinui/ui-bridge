#!/usr/bin/env node
/**
 * Table-driven tests for the sibling-provenance half of
 * scripts/check-runner-contract.mjs.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The provenance check is fail-closed wiring whose whole value is that it
 * cannot be satisfied by the wrong runner tree. Its correctness rests on a
 * source -> verdict table that, until this file, existed only as a comment —
 * and pre-PR review found a fail-OPEN in exactly that gap: an empty
 * `--expect-sibling ""`, which is what a regressed `mode` step actually emits,
 * skipped the assertion entirely and still exited 0. A second pass found the
 * same shape again in the pin-sha comparison. Both are pinned below.
 *
 * The inputs are not invented. Every `source` string is one the pinned
 * `checkout-sibling` action can actually emit, read off its own documented
 * outputs and its apply_pin() shell:
 *
 *   none                      no declaration, no pin      -> floating
 *   none+pinned               no declaration, pin applied -> pinned
 *   trailing-declined         declaration found, declined -> floating
 *   trailing-declined+pinned  ditto, pin applied          -> pinned
 *   <form>[+<form>...]        declaration resolved        -> declared
 *
 * `declared` and `+pinned` never co-occur: apply_pin() early-returns once the
 * declared path has set SHA.
 *
 * ZERO DEPENDENCIES, on purpose — the same constraint the checker itself is
 * written under, so this runs in the `Runner Contract` job with no `npm ci`.
 *
 * Usage:  node scripts/check-runner-contract.test.mjs
 * Exit:   0 all passed / 1 one or more failed
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  checkSiblingProvenance,
  describeResolution,
  describeSiblingProvenance,
  ourPinnedSha,
} from './check-runner-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const CHECKER = path.join(HERE, 'check-runner-contract.mjs');

const PIN_SHA = '9ed902f489437bd28887331e5a94e8e338f4e846';
const OTHER_SHA = '0aedd171fc4ef777ab4da6c08b75fb806b0bd414';

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL ${name}\n       ${e.message.split('\n')[0]}`);
  }
}

/** A throwaway pins manifest, in the real file's format (tab-separated). */
function pinsFile(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uib-pins-'));
  const f = path.join(dir, 'sibling-pins.conf');
  fs.writeFileSync(f, body);
  return f;
}
const REAL_PINS = pinsFile(
  `# a comment\n\nqontinui/qontinui-runner\t${PIN_SHA}\nqontinui/qontinui-web\t${OTHER_SHA}\n`,
);
const NO_RUNNER_PINS = pinsFile(`qontinui/qontinui-web\t${OTHER_SHA}\n`);

const env = (source, sha = '') => ({ SIBLING_SOURCE: source, SIBLING_SHA: sha });
const throws = (fn, re) => assert.throws(fn, (e) => re.test(e.message), `expected /${re.source}/`);

// -- classification ---------------------------------------------------------

console.log('describeSiblingProvenance');
for (const [source, kind] of [
  ['none', 'floating'],
  ['none+pinned', 'pinned'],
  ['trailing-declined', 'floating'],
  ['trailing-declined+pinned', 'pinned'],
  ['downstream-of', 'declared'],
  ['upstream-of', 'declared'],
  ['self-upstream-of', 'declared'],
  ['sibling-downstream-of', 'declared'],
  ['downstream-of+upstream-of', 'declared'],
]) {
  test(`${source} -> ${kind}`, () =>
    assert.equal(describeSiblingProvenance(source, '').kind, kind));
}

test('trailing-declined records that a declaration was declined', () =>
  assert.equal(describeSiblingProvenance('trailing-declined', '').declined, true));
test('bare none did not decline anything', () =>
  assert.equal(describeSiblingProvenance('none', '').declined, false));
test('matching is exact, not substring', () =>
  // guards against a future form whose name contains another's
  assert.equal(describeSiblingProvenance('not-upstream-of', '').kind, 'floating'));

// -- the pinned arm ---------------------------------------------------------

console.log('checkSiblingProvenance --expect-sibling pinned');
test('our pin, matching sha -> accepted', () =>
  assert.equal(
    checkSiblingProvenance('pinned', env('none+pinned', PIN_SHA), REAL_PINS).kind,
    'pinned',
  ));
test('declared adaptation PR outranks the pin -> accepted', () =>
  // Also pins that the declared path returns BEFORE the pinned block: the sha
  // here is deliberately not the one REAL_PINS records, and must not be
  // compared against it.
  assert.equal(
    checkSiblingProvenance('pinned', env('upstream-of', OTHER_SHA), REAL_PINS).kind,
    'declared',
  ));
test('trailing-declined+pinned -> accepted (the pin still applied)', () =>
  assert.equal(
    checkSiblingProvenance('pinned', env('trailing-declined+pinned', PIN_SHA), REAL_PINS).kind,
    'pinned',
  ));
test('floating -> REJECTED (the gating job must never float)', () =>
  throws(
    () => checkSiblingProvenance('pinned', env('none', ''), REAL_PINS),
    /must compare against a PINNED runner tree/,
  ));
test('trailing-declined with no pin -> REJECTED', () =>
  throws(
    () => checkSiblingProvenance('pinned', env('trailing-declined', ''), REAL_PINS),
    /must compare against a PINNED runner tree/,
  ));
test('pin applied but OUR manifest does not list the runner -> REJECTED', () =>
  throws(
    () => checkSiblingProvenance('pinned', env('none+pinned', PIN_SHA), NO_RUNNER_PINS),
    /does not list qontinui\/qontinui-runner/,
  ));
test('pin applied from a FOREIGN manifest (sha mismatch) -> REJECTED', () =>
  throws(
    () => checkSiblingProvenance('pinned', env('none+pinned', OTHER_SHA), REAL_PINS),
    /is not this repo's/,
  ));
test('pin applied but SIBLING_SHA empty -> REJECTED, never existence-only', () =>
  // The sha feeds only an `echo` in the workflow, so it is the obvious casualty
  // of tidying that `env:` block. Allowing it to skip the comparison would make
  // the whole pin-provenance check inert while staying green.
  throws(
    () => checkSiblingProvenance('pinned', env('none+pinned', ''), REAL_PINS),
    /SIBLING_SHA is empty/,
  ));

// -- the floating arm -------------------------------------------------------

console.log('checkSiblingProvenance --expect-sibling floating');
test('no pin, no declaration -> accepted', () =>
  assert.equal(checkSiblingProvenance('floating', env('none', ''), REAL_PINS).kind, 'floating'));
test('trailing-declined with no pin -> accepted', () =>
  assert.equal(
    checkSiblingProvenance('floating', env('trailing-declined', ''), REAL_PINS).kind,
    'floating',
  ));
test('pin applied -> REJECTED (the radar must bypass it)', () =>
  throws(
    () => checkSiblingProvenance('floating', env('none+pinned', PIN_SHA), REAL_PINS),
    /the pin applied/,
  ));
test("declared adaptation head -> REJECTED (not today's default branch)", () =>
  throws(
    () => checkSiblingProvenance('floating', env('upstream-of', OTHER_SHA), REAL_PINS),
    /a declared adaptation PR resolved/,
  ));

// -- absent vs empty, the fail-open pre-PR review caught --------------------

console.log('the absent/empty split');
test('flag ABSENT -> unasserted (a developer running this by hand)', () =>
  assert.equal(checkSiblingProvenance(undefined, env('none', ''), REAL_PINS), null));
test('flag EMPTY -> REJECTED, never silently unasserted', () =>
  throws(
    () => checkSiblingProvenance('', env('none+pinned', PIN_SHA), REAL_PINS),
    /passed an empty value/,
  ));
test('a bogus word is reported as a USAGE error, not as missing CI wiring', () =>
  throws(() => checkSiblingProvenance('pin', {}, REAL_PINS), /takes "pinned" or "floating"/));
test('missing SIBLING_SOURCE -> REJECTED', () =>
  throws(() => checkSiblingProvenance('pinned', {}, REAL_PINS), /SIBLING_SOURCE is empty/));

// -- manifest parsing -------------------------------------------------------

console.log('ourPinnedSha');
test('reads the runner entry, ignoring comments and other siblings', () =>
  assert.equal(ourPinnedSha(REAL_PINS), PIN_SHA));
test('unlisted sibling -> null', () => assert.equal(ourPinnedSha(NO_RUNNER_PINS), null));
test('absent file -> null', () =>
  assert.equal(ourPinnedSha(path.join(os.tmpdir(), 'definitely-not-here.conf')), null));
test('a trailing # comment on the entry is stripped', () =>
  assert.equal(ourPinnedSha(pinsFile(`qontinui/qontinui-runner\t${PIN_SHA}  # bumped\n`)), PIN_SHA));

// Not a unit test - a ROSTER check, the discipline this repo applies elsewhere.
// Every case above runs against synthetic temp files, so a format regression in
// the one manifest that actually gates CI (an entry reformatted, an uppercase
// sha pasted in, a stray third field) would pass them all and then false-
// positive the gate at runtime with "does not list qontinui/qontinui-runner".
test('the REAL .github/sibling-pins.conf still parses', () => {
  const real = path.join(REPO_ROOT, '.github/sibling-pins.conf');
  const sha = ourPinnedSha(real);
  assert.ok(sha, `${real} does not yield a qontinui/qontinui-runner pin`);
  assert.match(sha, /^[0-9a-f]{40}$/, 'the recorded pin is not a 40-char lowercase hex sha');
});

// -- the report line --------------------------------------------------------

console.log('describeResolution');
test('names the manifest it was actually given, not a hardcoded path', () =>
  assert.match(
    describeResolution({ kind: 'pinned', forms: [], sha: PIN_SHA }, {}, '/custom/pins.conf'),
    /\/custom\/pins\.conf/,
  ));
test('local run with no resolver outputs reads UNKNOWN', () =>
  assert.match(describeResolution(null, {}, REAL_PINS), /^UNKNOWN /));
test('unasserted CI run still shows the raw source', () =>
  assert.match(
    describeResolution(null, { SIBLING_SOURCE: 'none+pinned' }, REAL_PINS),
    /not asserted/,
  ));
test('a declined declaration is not flattened to "nothing declared"', () =>
  assert.match(
    describeResolution({ kind: 'floating', forms: [], sha: '', declined: true }, {}, REAL_PINS),
    /DECLINED/,
  ));

// -- the entry-module guard -------------------------------------------------
//
// The highest-risk logic in the checker. Making the module importable means the
// CLI body sits behind `isEntry`, and a misfiring guard would make the gate do
// NOTHING and exit 0 - silent green, the exact class this checker exists to
// end. These run it as a child process, which is the only way to observe the
// guard from outside.

console.log('entry-module guard');
test('invoked as a CLI, the check actually runs', () => {
  // SIBLING_SOURCE is blanked, so the run must fail inside main() at the
  // provenance check. What is asserted is that it got INTO main() at all
  // rather than exiting 0 mute: that error exists nowhere else.
  const r = spawnSync(process.execPath, [CHECKER, '--expect-sibling', 'pinned'], {
    encoding: 'utf8',
    env: { ...process.env, SIBLING_SOURCE: '', SIBLING_SHA: '' },
  });
  assert.notEqual(r.status, 0, 'a CLI invocation must not exit 0 without running');
  assert.match(r.stderr, /contract check could not run/);
});

test('imported with no flags, nothing runs and no exit code is set', () => {
  const probe = `import(${JSON.stringify(pathToFileURL(CHECKER).href)}).then(() => {
    if (process.exitCode) { console.error('exitCode was set: ' + process.exitCode); process.exit(9); }
    console.log('quiet');
  });`;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
    encoding: 'utf8',
  });
  assert.match(out, /quiet/);
});

test('the tripwire fires if the guard ever misses a flagged invocation', () => {
  // Simulates the catastrophic case: argv carries CLI flags but the module is
  // not the entry point. Must throw, never fall through to a silent exit 0.
  const probe = `import(${JSON.stringify(pathToFileURL(CHECKER).href)}).catch((e) => {
    console.log(/did not detect itself as the entry module/.test(e.message) ? 'tripped' : 'wrong:' + e.message);
  });`;
  // `argv1-placeholder` matters: under `node -e` the positional args start at
  // argv[1], so without it `--expect-sibling` would land at argv[1] and
  // `argv.slice(2)` would hold only `pinned` - no leading `--`, no tripwire.
  // The placeholder puts the flags where a real invocation puts them.
  const r = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', probe, 'argv1-placeholder', '--expect-sibling', 'pinned'],
    { encoding: 'utf8' },
  );
  assert.match(r.stdout, /tripped/);
});

// -- text encoding of the files this gate is made of ------------------------
//
// Not really a provenance test, but it lives here because this suite is the
// ONLY CI gate that reaches scripts/ and .github/. `package.json`'s lint,
// format and format:check all scope to packages/*/src/**, so nothing else
// looks at these files at all.
//
// The specific defect: this very file was committed once with a UTF-8 BOM and
// 374 mojibake sequences, from a PowerShell `Set-Content` round-trip through
// cp1252. Nothing caught it. A BOM before `#!/usr/bin/env node` also silently
// breaks the shebang while `node <file>` keeps working, which is exactly how
// it would have stayed unnoticed.

console.log('file encoding');
// Built from a code point, never written as the literal character: this file
// is inside the roster it scans, so a literal would make the check fail on
// itself — which it did, the first time this was written.
const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);
const TEXT_DIRS = [
  [path.join(REPO_ROOT, 'scripts'), /\.(mjs|cjs|sh|ts)$/],
  [path.join(REPO_ROOT, '.github'), /\.(yml|conf|md)$/],
];
test('no tracked script or .github text file has a BOM or a replacement char', () => {
  const offenders = [];
  const counts = new Map();
  let nested = 0;
  for (const [dir, ext] of TEXT_DIRS) {
    assert.ok(fs.existsSync(dir), `${dir} is missing — the roster is wrong, not the tree`);
    counts.set(dir, 0);
    for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !ext.test(entry.name)) continue;
      const parent = entry.parentPath ?? entry.path ?? dir;
      const file = path.join(parent, entry.name);
      counts.set(dir, counts.get(dir) + 1);
      if (parent !== dir) nested++;
      const buf = fs.readFileSync(file);
      if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        offenders.push(`${file}: UTF-8 BOM (breaks a shebang; write UTF-8 without BOM)`);
      }
      if (buf.toString('utf8').includes(REPLACEMENT_CHAR)) {
        offenders.push(`${file}: U+FFFD replacement char (re-encode from the original)`);
      }
    }
  }
  // Non-vacuity, per directory AND for nesting. A single `scanned > 0` can only
  // catch TOTAL coverage loss: were `recursive` ever ignored, scripts/'s
  // top-level files alone would satisfy it while every nested .github/ file
  // silently dropped out — half the roster gone, still green. That is the same
  // partial-blindness this whole file exists to refuse.
  for (const [dir, n] of counts) {
    assert.ok(n > 0, `scanned nothing under ${dir} — the roster glob is wrong`);
  }
  assert.ok(nested > 0, 'scanned no NESTED file — recursive traversal is not working');
  assert.equal(offenders.length, 0, `\n       ${offenders.join('\n       ')}`);
});

console.log('');
if (failed) {
  console.error(`${failed} test(s) failed`);
  process.exitCode = 1;
} else {
  console.log('all provenance tests passed');
}
