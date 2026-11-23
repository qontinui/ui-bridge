#!/usr/bin/env node
/**
 * Table-driven tests for scripts/vitest-verdict.cjs's `classify()`.
 *
 * The classifier's dangerous failure is a FALSE "not a verdict": a real test
 * failure relabelled as worker teardown would tell coord, and through it the
 * author, that a red needs only a re-run. So every way the output can carry a
 * real failure is pinned here as "no marker", beside the one shape that earns
 * it — the cd24732d log of ui-bridge#363 (5672 passed, 0 failed, one
 * EnvironmentTeardownError), reproduced with the ANSI colouring and Actions
 * timestamps the downloaded job log carries (a reconstruction, not the log
 * itself). No real npm, git, vitest or network: main() is driven through stub
 * `npm` and `git` on PATH, which pins that the step's exit status is npm run
 * test's and that the claim is made only for a PR whose changed files were read.
 *
 * Usage:  node scripts/vitest-verdict.test.cjs
 * Exit:   0 all passed / 1 one or more failed
 */

'use strict';

const assert = require('node:assert/strict');
const { classify, annotation, NOT_A_VERDICT_MARKER, ANNOTATION_TITLE } = require('./vitest-verdict.cjs');

let failed = 0;
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${e.message.split('\n').slice(0, 6).join('\n       ')}`);
  }
}

// --- fixture builders, in vitest 4.1's own colouring ------------------------

const ESC = '\x1b[';
const dim = (s) => `${ESC}2m${s}${ESC}22m`;
const green = (s) => `${ESC}1m${ESC}32m${s}${ESC}39m${ESC}22m`;
const red = (s) => `${ESC}31m${s}${ESC}39m`;
const rule = (n) => '⎯'.repeat(n);

/** One `npm run test` workspace block: header, vitest run, summary. */
function workspace({ name, files = '4 passed (4)', tests = '39 passed (39)', errors = [], npmFailed = false }) {
  const out = [
    '',
    `> ${name} test`,
    '> vitest run',
    '',
    ` ${ESC}1m${ESC}30m${ESC}46m RUN ${ESC}49m${ESC}39m${ESC}22m ${ESC}36mv4.1.5 ${ESC}39m${ESC}90m/work/${name}${ESC}39m`,
    '',
    ` ${ESC}32m✓${ESC}39m src/index.test.ts ${dim('(38 tests)')}`,
  ];
  if (errors.length > 0) {
    out.push(
      `${red(rule(6))}${ESC}1m${ESC}41m Unhandled Errors ${ESC}49m${ESC}22m${red(rule(6))}`,
      `${ESC}31m${ESC}1m`,
      `Vitest caught ${errors.length} unhandled error${errors.length > 1 ? 's' : ''} during the test run.`,
      'This might cause false positive tests. Resolve unhandled errors to make sure your tests are not affected.' +
        `${ESC}22m${ESC}39m`,
      ''
    );
    for (const { kind = 'Rejection', cls, msg, file } of errors) {
      out.push(
        `${red(rule(4))}${ESC}1m${ESC}41m Unhandled ${kind} ${ESC}49m${ESC}22m${red(rule(5))}`,
        `${ESC}31m${ESC}1m${cls}${ESC}22m: ${msg}${ESC}39m`,
        red(
          `This error originated in "${ESC}1m${file}${ESC}22m" test file. It doesn't mean the error ` +
            'was thrown inside the file itself, but while it was running.'
        ),
        red(rule(40))
      );
    }
    out.push('', '');
  }
  out.push(
    `${dim(' Test Files ')} ${green(files.replace(/ \(\d+\)$/, ''))}${ESC}90m ${files.match(/\(\d+\)$/)[0]}${ESC}39m`,
    `${dim('      Tests ')} ${green(tests.replace(/ \(\d+\)$/, ''))}${ESC}90m ${tests.match(/\(\d+\)$/)[0]}${ESC}39m`
  );
  if (errors.length > 0) {
    out.push(`${dim('     Errors ')} ${ESC}1m${ESC}31m${errors.length} error${errors.length > 1 ? 's' : ''}${ESC}39m${ESC}22m`);
  }
  out.push(`${dim('   Start at ')} 02:31:24`, `${dim('   Duration ')} 76.74s`, '');
  if (npmFailed) {
    out.push(
      'npm error Lifecycle script `test` failed with error:',
      'npm error code 1',
      `npm error path /work/${name}`,
      `npm error workspace ${name}`,
      `npm error location /work/${name}`,
      'npm error command failed',
      'npm error command sh -c vitest run',
      ''
    );
  }
  return out;
}

/** A whole job log, each line prefixed with an Actions timestamp. */
function log(...blocks) {
  return blocks
    .flat()
    .map((l, i) => `2026-11-13T01:32:${String(i % 60).padStart(2, '0')}.3317447Z ${l}`)
    .join('\n');
}

const TEARDOWN = {
  cls: 'EnvironmentTeardownError',
  msg: '[vitest-worker]: Closing rpc while "onUserConsoleLog" was pending',
  file: 'src/react/commandHandlers.designEvaluate.test.ts',
};
const CLEAN_BEFORE = workspace({ name: '@qontinui/ui-bridge-cli@0.4.0' });
const CLEAN_AFTER = workspace({ name: '@qontinui/ui-bridge-cli-args@0.3.0', files: '1 passed (1)', tests: '38 passed (38)' });

/** The cd24732d shape: ui-bridge#363's lint-and-test (22.x), attempt 1. */
const CD24732D = log(
  CLEAN_BEFORE,
  workspace({
    name: '@qontinui/ui-bridge@0.46.0',
    files: '327 passed | 1 skipped (328)',
    tests: '5672 passed | 22 skipped (5694)',
    errors: [TEARDOWN],
    npmFailed: true,
  }),
  CLEAN_AFTER
);

// --- the three cases the plan names ---------------------------------------

test('the cd24732d log (5672 passed, 0 failed, Errors 1 = EnvironmentTeardownError) earns the marker', () => {
  const v = classify(CD24732D);
  assert.equal(v.notAVerdict, true, v.reason);
  assert.match(v.detail, /\(5749 passed\)/); // 39 + 5672 + 38
  assert.match(v.detail, /commandHandlers\.designEvaluate\.test\.ts/);
  assert.match(v.detail, /@qontinui\/ui-bridge@0\.46\.0/);
});

test('a log with "1 failed" earns no marker, even beside a teardown error', () => {
  const v = classify(
    log(
      CLEAN_BEFORE,
      workspace({
        name: '@qontinui/ui-bridge@0.46.0',
        files: '1 failed | 326 passed | 1 skipped (328)',
        tests: '1 failed | 5671 passed | 22 skipped (5694)',
        errors: [TEARDOWN],
        npmFailed: true,
      }),
      CLEAN_AFTER
    )
  );
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /1 failed/);
});

test('a log whose error is an AssertionError earns no marker', () => {
  const v = classify(
    log(
      CLEAN_BEFORE,
      workspace({
        name: '@qontinui/ui-bridge@0.46.0',
        files: '327 passed | 1 skipped (328)',
        tests: '5672 passed | 22 skipped (5694)',
        errors: [{ kind: 'Error', cls: 'AssertionError', msg: 'expected 1 to be 2', file: 'src/a.test.ts' }],
        npmFailed: true,
      }),
      CLEAN_AFTER
    )
  );
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /AssertionError/);
});

// --- the other ways a real failure could hide ------------------------------

test('a teardown error beside an AssertionError earns no marker', () => {
  const v = classify(
    log(
      workspace({
        name: '@qontinui/ui-bridge@0.46.0',
        errors: [TEARDOWN, { kind: 'Error', cls: 'AssertionError', msg: 'x', file: 'src/b.test.ts' }],
        npmFailed: true,
      })
    )
  );
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /AssertionError/);
});

test('a vitest run that printed no summary (a crash) earns no marker', () => {
  const crashed = workspace({ name: '@qontinui/ui-bridge@0.46.0', errors: [TEARDOWN], npmFailed: true }).filter(
    (l) => !/Test Files|Tests |Errors /.test(l)
  );
  const v = classify(log(CLEAN_BEFORE, crashed));
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /2 vitest run\(s\) started but 1/);
});

test('no vitest summary at all earns no marker', () => {
  const v = classify('npm error workspace @qontinui/ui-bridge@0.46.0\nnpm error command failed\n');
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /no vitest `Tests` summary/);
});

test('a second workspace failing with no error reported (e.g. a coverage threshold) earns no marker', () => {
  const v = classify(
    log(
      workspace({ name: '@qontinui/ui-bridge@0.46.0', errors: [TEARDOWN], npmFailed: true }),
      workspace({ name: '@qontinui/ui-bridge-server@0.9.0', npmFailed: true })
    )
  );
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /2 workspace\(s\) failed but only 1/);
});

test('a red with no vitest error at all earns no marker', () => {
  const v = classify(log(workspace({ name: '@qontinui/ui-bridge@0.46.0', npmFailed: true })));
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /no vitest run reported an error/);
});

test('a "Failed Tests" section earns no marker', () => {
  const v = classify(`${CD24732D}\n${rule(7)} Failed Tests 1 ${rule(7)}\n FAIL src/a.test.ts > x\n`);
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /failure section/);
});

test('an error block the classifier cannot read, beside a teardown error, earns no marker', () => {
  const lines = workspace({ name: '@qontinui/ui-bridge@0.46.0', errors: [TEARDOWN], npmFailed: true }).map((l) =>
    /Errors .*1 error/.test(l) ? l.replace('1 error', '2 errors') : l
  );
  const at = lines.findIndex((l) => /This error originated/.test(l));
  lines.splice(at + 2, 0, `${red(rule(4))} Uncaught Exception ${red(rule(4))}`, 'TypeError: boom');
  const v = classify(log(lines));
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /error block/);
});

test('a red where npm named no failed workspace earns no marker', () => {
  const v = classify(CD24732D.split('\n').filter((l) => !/npm error workspace/.test(l)).join('\n'));
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /named no failed workspace/);
});

test('a teardown error beside a non-zero Leaks count in the same workspace earns no marker', () => {
  const v = classify(`${CD24732D}\n      Leaks  2 leaks\n`);
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /Leaks 2/);
});

// --- the pull request's own files ------------------------------------------

test('a teardown error from a test file the pull request changes earns no marker', () => {
  const v = classify(CD24732D, {
    changedFiles: ['README.md', 'packages/ui-bridge/src/react/commandHandlers.designEvaluate.test.ts'],
  });
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /which this pull request changes/);
});

test('a teardown error from a file the pull request does not change still earns the marker', () => {
  const v = classify(CD24732D, { changedFiles: ['packages/ui-bridge/src/react/other.ts'] });
  assert.equal(v.notAVerdict, true, v.reason);
});

test("a pull request whose changed files could not be read earns no marker", () => {
  const v = classify(CD24732D, { changedFiles: null });
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /could not be read/);
});

// --- the other faults and origin shapes -------------------------------------

test('a teardown error beside a non-zero Type Errors count earns no marker', () => {
  const v = classify(`${CD24732D}\n Type Errors  1 failed\n`);
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /Type Errors 1/);
});

test('a teardown error beside an Async Leaks banner earns no marker', () => {
  const v = classify(`${CD24732D}\n${rule(6)} Async Leaks 3 ${rule(6)}\n`);
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /Async Leaks 3/);
});

test('a second teardown error naming no origin file earns no marker, even beside one that does', () => {
  const lines = workspace({
    name: '@qontinui/ui-bridge@0.46.0',
    errors: [TEARDOWN, { ...TEARDOWN, file: 'src/b.test.ts' }],
    npmFailed: true,
  });
  const at = lines.findIndex((l) => l.includes('"') && l.includes('src/b.test.ts'));
  assert.ok(at > 0, 'fixture has the second origin line');
  lines.splice(at, 1);
  const v = classify(log(lines), { changedFiles: ['packages/ui-bridge/src/other.ts'] });
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /1 of 2 error\(s\) named no originating test file/);
});

test("a duplicated origin line in one error block does not cover another block that names none", () => {
  const lines = workspace({
    name: '@qontinui/ui-bridge@0.46.0',
    errors: [TEARDOWN, { ...TEARDOWN, file: 'src/b.test.ts' }],
    npmFailed: true,
  });
  const first = lines.findIndex((l) => l.includes('This error originated') && l.includes(TEARDOWN.file));
  const second = lines.findIndex((l) => l.includes('This error originated') && l.includes('src/b.test.ts'));
  lines.splice(second, 1);
  lines.splice(first, 0, lines[first]);
  const v = classify(log(lines), { changedFiles: ['packages/ui-bridge/src/other.ts'] });
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /1 of 2 error\(s\) named no originating test file/);
});

test('an unnamed first block is not covered by a duplicated origin line in the second', () => {
  const lines = workspace({
    name: '@qontinui/ui-bridge@0.46.0',
    errors: [TEARDOWN, { ...TEARDOWN, file: 'src/b.test.ts' }],
    npmFailed: true,
  });
  const first = lines.findIndex((l) => l.includes('This error originated') && l.includes(TEARDOWN.file));
  lines.splice(first, 1);
  const second = lines.findIndex((l) => l.includes('This error originated') && l.includes('src/b.test.ts'));
  lines.splice(second, 0, lines[second]);
  const v = classify(log(lines), { changedFiles: ['packages/ui-bridge/src/other.ts'] });
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /1 of 2 error\(s\) named no originating test file/);
});

/** One teardown block naming two origin files (a `cause` can carry its own). */
function twoOriginLog(firstFile, secondFile) {
  const lines = workspace({
    name: '@qontinui/ui-bridge@0.46.0',
    errors: [{ ...TEARDOWN, file: firstFile }],
    npmFailed: true,
  });
  const at = lines.findIndex((l) => l.includes('This error originated'));
  lines.splice(at + 1, 0, lines[at].replace(firstFile, secondFile));
  return log(lines);
}

test("a block's second origin line naming a file the PR changes earns no marker", () => {
  const v = classify(twoOriginLog('src/y.test.ts', 'src/x.test.ts'), { changedFiles: ['packages/ui-bridge/src/x.test.ts'] });
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /src\/x\.test\.ts, which this pull request changes/);
});

test("a block's first origin line naming a file the PR changes earns no marker", () => {
  const v = classify(twoOriginLog('src/x.test.ts', 'src/y.test.ts'), { changedFiles: ['packages/ui-bridge/src/x.test.ts'] });
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /src\/x\.test\.ts, which this pull request changes/);
});

test('a changed file equal to the origin path itself earns no marker', () => {
  const v = classify(CD24732D, { changedFiles: ['src/react/commandHandlers.designEvaluate.test.ts'] });
  assert.equal(v.notAVerdict, false);
  assert.match(v.reason, /which this pull request changes/);
});

// --- main(): the Test step's exit status is npm run test's, and the claim is
// --- made only for a pull request whose changed files were read ------------

if (process.platform !== 'win32') {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-verdict-'));
  const fixture = path.join(dir, 'out.txt');
  fs.writeFileSync(fixture, CD24732D);
  const eventPath = path.join(dir, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: 'a'.repeat(40) } } }));

  const BASE = 'a'.repeat(40);
  // `git diff --name-only -z` output: NUL-terminated paths.
  const ownTest = path.join(dir, 'diff-own.txt');
  fs.writeFileSync(ownTest, 'README.md\0packages/ui-bridge/src/react/commandHandlers.designEvaluate.test.ts\0');
  const otherFile = path.join(dir, 'diff-other.txt');
  fs.writeFileSync(otherFile, 'packages/ui-bridge/src/react/other.ts\0');
  fs.writeFileSync(
    path.join(dir, 'npm'),
    '#!/bin/sh\n[ -n "$STUB_PRINT" ] && cat "$STUB_PRINT"\n[ -n "$STUB_SIGNAL" ] && kill -TERM $$\nexit "$STUB_EXIT"\n',
    { mode: 0o755 }
  );
  // The stub git answers ONLY the exact argv main() must send, and only with
  // GIT_TERMINAL_PROMPT=0: the base is never local, the fetch exits
  // $STUB_GIT_FETCH (default 0), and the diff prints $STUB_GIT_DIFF (or fails
  // when it is unset). Any other call exits 2, which withholds the marker --
  // unless $STUB_GIT_ANY_BASE is set, so that only main()'s own base-sha guard
  // can refuse a malformed base.
  fs.writeFileSync(
    path.join(dir, 'git'),
    '#!/bin/sh\n[ "$GIT_TERMINAL_PROMPT" = 0 ] || exit 2\ncase "$*" in\n' +
      `  "cat-file -e ${BASE}^{commit}") exit 1 ;;\n` +
      `  "fetch --no-tags --depth=1 origin ${BASE}") exit "\${STUB_GIT_FETCH:-0}" ;;\n` +
      `  "diff --name-only -z ${BASE} HEAD") [ -n "$STUB_GIT_DIFF" ] || exit 1; cat "$STUB_GIT_DIFF" ;;\n` +
      '  *) [ -n "$STUB_GIT_ANY_BASE" ] || exit 2\n' +
      '     case "$1" in cat-file) exit 1 ;; fetch) exit 0 ;; diff) cat "$STUB_GIT_DIFF" ;; *) exit 2 ;; esac ;;\nesac\n',
    { mode: 0o755 }
  );
  // The stubs need only sh, cat and kill; node itself is spawned by absolute path.
  const run = (extra, pathDirs = [dir, '/usr/bin', '/bin']) => {
    const env = { ...process.env, PATH: pathDirs.join(':') };
    delete env.npm_execpath;
    delete env.GITHUB_EVENT_NAME;
    delete env.GITHUB_EVENT_PATH;
    delete env.VITEST_VERDICT_MAX_CAPTURE_BYTES;
    delete env.GIT_TERMINAL_PROMPT; // so the stub git proves main() sets it
    return spawnSync(process.execPath, [path.join(__dirname, 'vitest-verdict.cjs')], {
      env: { ...env, ...extra },
      encoding: 'utf8',
      timeout: 30000,
    });
  };
  const PR = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: eventPath };
  const RED = { STUB_EXIT: '1', STUB_PRINT: fixture };

  test('main() exits 0 when npm run test exits 0, and claims nothing', () => {
    const r = run({ STUB_EXIT: '0' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes(NOT_A_VERDICT_MARKER));
  });

  test("main() exits with npm run test's own non-zero status", () => {
    const r = run({ STUB_EXIT: '3' });
    assert.equal(r.status, 3, r.stderr);
  });

  test('main() streams a teardown-only PR red through, exits 1, and adds the annotation', () => {
    const r = run({ ...RED, ...PR, STUB_GIT_DIFF: otherFile });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stdout.includes('5672 passed'), 'the child output is streamed through');
    assert.ok(r.stdout.includes(`::error title=${ANNOTATION_TITLE}::`), r.stderr);
  });

  test('main() claims nothing for a teardown-only PR red from a test file the PR changes', () => {
    const r = run({ ...RED, ...PR, STUB_GIT_DIFF: ownTest });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(!r.stdout.includes('::error title='), 'the PR owns the test that logged after teardown');
    assert.match(r.stderr, /which this pull request changes/);
  });

  test("main() claims nothing when the PR's changed files cannot be read", () => {
    const r = run({ ...RED, ...PR });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(!r.stdout.includes('::error title='));
    assert.match(r.stderr, /could not be read/);
  });

  test("main() claims nothing when the pull_request event file cannot be read", () => {
    const r = run({ ...RED, ...PR, GITHUB_EVENT_PATH: path.join(dir, 'absent.json'), STUB_GIT_DIFF: otherFile });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(!r.stdout.includes('::error title='));
    assert.match(r.stderr, /could not be read/);
  });

  test('main() claims nothing for a teardown-only red outside a pull request (a push lane)', () => {
    // A PR-shaped event file and a readable diff: only the event name withholds.
    const r = run({ ...RED, GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: eventPath, STUB_GIT_DIFF: otherFile });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(!r.stdout.includes('::error title='));
    assert.match(r.stderr, /not for a pull request/);
  });

  test('main() claims nothing when the event carries a base that is not a 40-hex sha', () => {
    const bad = path.join(dir, 'event-bad.json');
    fs.writeFileSync(bad, JSON.stringify({ pull_request: { base: { sha: 'main' } } }));
    const r = run({ ...RED, ...PR, GITHUB_EVENT_PATH: bad, STUB_GIT_DIFF: otherFile, STUB_GIT_ANY_BASE: '1' });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(!r.stdout.includes('::error title='));
    assert.match(r.stderr, /could not be read/);
  });

  test('main() claims nothing when the fetch of the PR base fails', () => {
    const r = run({ ...RED, ...PR, STUB_GIT_DIFF: otherFile, STUB_GIT_FETCH: '1' });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(!r.stdout.includes('::error title='));
    assert.match(r.stderr, /could not be read/);
  });

  test('main() claims nothing when the captured output exceeds the cap', () => {
    const r = run({ ...RED, ...PR, STUB_GIT_DIFF: otherFile, VITEST_VERDICT_MAX_CAPTURE_BYTES: '100' });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(!r.stdout.includes('::error title='));
    assert.match(r.stderr, /exceeded the capture cap/);
  });

  test('main() claims nothing and exits 1 when npm run test ends on a signal', () => {
    const r = run({ ...RED, ...PR, STUB_GIT_DIFF: otherFile, STUB_SIGNAL: '1' });
    assert.equal(r.status, 1, r.stderr);
    assert.ok(!r.stdout.includes('::error title='), 'a killed run is never teardown-only');
    assert.match(r.stderr, /ended on SIGTERM/);
  });

  test('main() exits 1 when npm cannot be started', () => {
    const r = run({ STUB_EXIT: '0' }, [path.join(dir, 'absent')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /could not start npm/);
  });

  fs.rmSync(dir, { recursive: true, force: true });
}

// --- the annotation ---------------------------------------------------------

test("the annotation's title carries coord's marker verbatim and the detail is one escaped line", () => {
  assert.equal(NOT_A_VERDICT_MARKER, '(not a verdict on this PR)');
  const line = annotation('100% teardown\nsecond line');
  assert.ok(line.startsWith(`::error title=${ANNOTATION_TITLE}::`), line);
  assert.ok(ANNOTATION_TITLE.includes('(not a verdict on this PR)'));
  assert.ok(!/[,:]/.test(ANNOTATION_TITLE.replace(/^vitest/, '')), 'a title property may not carry , or :');
  assert.ok(line.endsWith('100%25 teardown%0Asecond line'), line);
});

console.log(`\nvitest-verdict self-test: ${passed} passed, ${failed} failed`);
if (passed === 0) {
  console.error('vitest-verdict self-test: NO TESTS RAN');
  process.exit(1);
}
process.exit(failed === 0 ? 0 : 1);
