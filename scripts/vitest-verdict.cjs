#!/usr/bin/env node
/**
 * Runs `npm run test` and, when it fails ONLY because vitest's worker hit an
 * EnvironmentTeardownError, says so in an annotation coord can read.
 *
 * Why. ui-bridge#363 (coord finding cd24732d) went red on lint-and-test with
 * 5672 tests passed and 0 failed: the one error was
 *   EnvironmentTeardownError: [vitest-worker]: Closing rpc while
 *   "onUserConsoleLog" was pending
 * raised while a test file OUTSIDE the diff was tearing down. A re-run passed
 * with no code change, yet coord's author nudge said "fix and re-push", because
 * nothing in the job said the red was not a verdict on the diff. coord already
 * reads that claim from one place: an annotation whose TITLE contains
 * `(not a verdict on this PR)` (NOT_A_VERDICT_ANNOTATION_MARKER in
 * qontinui-coord's pr_merge/author_feedback.rs). Its repair classifier then
 * routes the red as flake_infra / not_a_verdict instead of as an author fix.
 * Plan 2026-11-23-ci-rework-tells-an-author-to-fix-code-when-a-rerun-would-clear-the-red,
 * Phase 6.3.
 *
 * What it does. Spawns `npm run test` (no shell), streams the child's stdout
 * and stderr through unchanged while keeping a copy of each, and exits with the
 * child's status — so the step's verdict is exactly `npm run test`'s. On a
 * non-zero exit it hands the copy to `classify()`, and prints
 *   ::error title=vitest worker teardown error (not a verdict on this PR)::<detail>
 * ONLY when every condition below holds. Any one failing prints nothing extra,
 * so a real failure is never relabelled:
 *   1. at least one vitest run printed a summary, and every vitest run that
 *      started (`RUN v<x>`) printed both its `Test Files` and `Tests` lines;
 *   2. every `Test Files` and `Tests` summary reports 0 failed, and no
 *      `Failed Tests` / `Failed Suites` section was printed;
 *   3. the runs reported at least one error (`Errors  N error(s)`), and the
 *      number of `Unhandled Error` / `Unhandled Rejection` blocks equals the
 *      total N, each one's error class being `EnvironmentTeardownError`;
 *   4. npm named the workspaces that failed, and there are no more of them
 *      than vitest runs that reported errors — a DIFFERENT workspace that
 *      failed for some other reason (a coverage threshold, "No test files
 *      found") makes the count exceed and withholds the marker;
 *   5. no run printed a second fault vitest reports beside errors (`Leaks`,
 *      `Async Leaks`, `Type Errors` with a non-zero count), which would keep a
 *      re-run red inside the SAME failing workspace (a `Source Errors` block is
 *      an `Unhandled Source Error`, which condition 3 already refuses);
 *   6. the run is for a pull_request, every teardown error names the test file
 *      it originated in, and no origin line anywhere in the output (a block's
 *      `cause` can name a second) names a file the PR changes: a new test that
 *      logs after its own teardown is the author's to fix, not a re-run's.
 *      Any other event (a push, a merge-candidate run), an error that names no
 *      file, or changed files that cannot be read withholds the marker.
 *      LIMIT: vitest names the test file that was RUNNING, not the code that
 *      logged; a PR that changes only the source module such a test drives is
 *      not caught, which is why the detail names the file and does not say the
 *      PR is uninvolved.
 * When npm ended on a signal, nothing is classified: a killed run is never
 * teardown-only.
 *
 * Usage:  node scripts/vitest-verdict.cjs
 * Exit:   npm run test's exit status (1 when it died on a signal or could not
 *         be spawned).
 * Tests:  node scripts/vitest-verdict.test.cjs
 */

'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** coord's contract — keep verbatim. */
const NOT_A_VERDICT_MARKER = '(not a verdict on this PR)';
const ANNOTATION_TITLE = `vitest worker teardown error ${NOT_A_VERDICT_MARKER}`;
const TEARDOWN_CLASS = 'EnvironmentTeardownError';

/** A bound on each git call the changed-file read makes; a timeout withholds. */
const GIT_TIMEOUT_MS = 60 * 1000;

/** Past this many captured bytes the copy is incomplete, so no claim is made. */
const DEFAULT_MAX_CAPTURE_BYTES = 256 * 1024 * 1024;
/** `VITEST_VERDICT_MAX_CAPTURE_BYTES` (a positive integer) overrides it; the self-test uses that. */
function maxCaptureBytes() {
  const v = process.env.VITEST_VERDICT_MAX_CAPTURE_BYTES;
  return /^[1-9]\d*$/.test(v || '') ? Number(v) : DEFAULT_MAX_CAPTURE_BYTES;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
/** A GitHub Actions log line prefix, so a downloaded job log reads the same. */
const ACTIONS_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z ?/;

const RUN_HEADER = /^\s*RUN\s+v\d+\.\d+/;
const SUMMARY = /^\s*(Test Files|Tests)\s{2,}(.+?)\s*\((\d+)\)\s*$/;
const ERRORS_LINE = /^\s*Errors\s{2,}(\d+)\s+errors?\s*$/;
const ERROR_BLOCK_HEADER = /\bUnhandled (?:Error|Rejection)(?!s)\b/;
const FAILED_SECTION = /\bFailed (?:Tests|Suites) \d+\b/;
const ORIGIN = /This error originated in "([^"]+)" test file/;
const NPM_FAILED_WORKSPACE = /^npm (?:error|ERR!) workspace (\S+)/;
/** A second fault vitest counts beside errors; a non-zero count disqualifies. */
const OTHER_FAULT = /\b(Async Leaks|Leaks|Type Errors)\s+(\d+)\b/;

/** Normalises captured text: no ANSI, no CR, no Actions timestamp prefix. */
function normalise(text) {
  return String(text)
    .replace(ANSI, '')
    .split(/\r?\n|\r/)
    .map((line) => line.replace(ACTIONS_TIMESTAMP, ''));
}

/**
 * `5672 passed | 22 skipped` -> { passed: 5672, skipped: 22 }, or null when any
 * item is not `<n> <word>` (so a stray line shaped like a summary is not one).
 */
function parseCounts(body) {
  const counts = {};
  for (const item of body.split('|')) {
    const m = /^\s*(\d+)\s+([a-z][a-z ]*?)\s*$/.exec(item);
    if (!m) return null;
    counts[m[2]] = (counts[m[2]] || 0) + Number(m[1]);
  }
  return counts;
}

/**
 * Pure. Reads the captured output of a FAILED `npm run test` and decides
 * whether its only fault is vitest worker teardown.
 *
 * @param {string} text  the run's output (stdout and stderr, either order)
 * @param {{ changedFiles?: string[] | null }} [opts]  the PR's changed files
 *   (repo-relative): `undefined` when the run is not for a pull request, `null`
 *   when it is and they could not be read (which withholds the marker).
 * @returns {{ notAVerdict: boolean, reason: string, detail?: string }}
 */
function classify(text, opts = {}) {
  const lines = normalise(text);
  const no = (reason) => ({ notAVerdict: false, reason });

  let runs = 0;
  const summaries = { 'Test Files': [], Tests: [] };
  let errorRuns = 0;
  let errorsReported = 0;
  /** One entry per error block: its class and the origin file vitest named for it. */
  const blocks = [];
  /** EVERY origin file named anywhere (a block's `cause` can name a second). */
  const allOrigins = new Set();
  const failedWorkspaces = new Set();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (RUN_HEADER.test(line)) runs += 1;

    const s = SUMMARY.exec(line);
    if (s) {
      const counts = parseCounts(s[2]);
      if (counts) summaries[s[1]].push(counts);
    }

    const e = ERRORS_LINE.exec(line);
    if (e) {
      errorRuns += 1;
      errorsReported += Number(e[1]);
    }

    if (FAILED_SECTION.test(line)) return no(`vitest printed a failure section: "${line.trim()}"`);

    const f = OTHER_FAULT.exec(line);
    if (f && Number(f[2]) > 0) return no(`vitest reported ${f[1]} ${f[2]}: "${line.trim()}"`);

    if (ERROR_BLOCK_HEADER.test(line)) {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      const m = j < lines.length ? /^\s*([A-Za-z_$][\w$]*)/.exec(lines[j]) : null;
      blocks.push({ cls: m ? m[1] : '<unreadable>', origin: null });
    }

    // vitest prints a block's origin line after its message and stack, before
    // the next block, so it belongs to the last block opened. A stray one (no
    // open block, or a block that already has one) credits nothing.
    // Every origin line, attached or not, is still checked against the PR's
    // changed files below.
    const o = ORIGIN.exec(line);
    const last = blocks[blocks.length - 1];
    if (o) allOrigins.add(o[1]);
    if (o && last && last.origin === null) last.origin = o[1];

    const w = NPM_FAILED_WORKSPACE.exec(line);
    if (w) failedWorkspaces.add(w[1]);
  }

  const classes = blocks.map((b) => b.cls);
  const origins = new Set(blocks.map((b) => b.origin).filter(Boolean));
  const files = summaries['Test Files'];
  const tests = summaries.Tests;
  if (tests.length === 0) return no('no vitest `Tests` summary was printed');
  if (files.length !== tests.length || tests.length !== runs) {
    return no(
      `${runs} vitest run(s) started but ${files.length} \`Test Files\` and ${tests.length} ` +
        '`Tests` summaries were printed'
    );
  }
  const failing = [...files, ...tests].find((c) => (c.failed || 0) > 0);
  if (failing) return no(`a summary reports ${failing.failed} failed`);

  if (errorsReported === 0) return no('no vitest run reported an error, so the red is something else');
  if (classes.length !== errorsReported) {
    return no(`vitest reported ${errorsReported} error(s) but ${classes.length} error block(s) were read`);
  }
  const other = classes.find((c) => c !== TEARDOWN_CLASS);
  if (other) return no(`an error is ${other}, not ${TEARDOWN_CLASS}`);

  if (failedWorkspaces.size === 0) return no('npm named no failed workspace');
  if (failedWorkspaces.size > errorRuns) {
    return no(
      `${failedWorkspaces.size} workspace(s) failed but only ${errorRuns} vitest run(s) reported errors`
    );
  }

  const { changedFiles } = opts;
  if (changedFiles !== undefined) {
    if (changedFiles === null) return no('the run is not for a pull request, or its changed files could not be read');
    const unnamed = blocks.filter((b) => b.origin === null).length;
    if (unnamed > 0) {
      return no(
        `${unnamed} of ${blocks.length} error(s) named no originating test file, ` +
          'so they cannot be told apart from this pull request'
      );
    }
    const touched = [...allOrigins].find((o) => changedFiles.some((c) => c === o || c.endsWith(`/${o}`)));
    if (touched) return no(`the teardown error originated in ${touched}, which this pull request changes`);
  }

  const passed = tests.reduce((n, c) => n + (c.passed || 0), 0);
  const where = origins.size > 0 ? ` in ${[...origins].join(', ')}` : '';
  const detail =
    `0 failed tests in all ${tests.length} vitest run(s) (${passed} passed); the only ` +
    `error(s): ${classes.length} ${TEARDOWN_CLASS} from the vitest worker${where} ` +
    `(failed workspace: ${[...failedWorkspaces].join(', ')}).` +
    (changedFiles ? ' This pull request changes none of those test files.' : '') +
    ' Re-run the job.';
  return { notAVerdict: true, reason: 'teardown-only', detail };
}

/** A workflow-command message: `%`, CR and LF escaped as Actions requires. */
function escapeData(s) {
  return String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** The annotation line for a teardown-only red. */
function annotation(detail) {
  return `::error title=${ANNOTATION_TITLE}::${escapeData(detail)}`;
}

/**
 * How to start npm with no shell. On Windows `npm` is a .cmd shim, which Node
 * refuses to spawn without a shell, so the npm CLI is run through node itself.
 */
function npmCommand() {
  const execPath = process.env.npm_execpath;
  if (execPath && /\.c?js$/.test(execPath) && fs.existsSync(execPath)) {
    return [process.execPath, [execPath]];
  }
  if (process.platform === 'win32') {
    const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fs.existsSync(cli)) return [process.execPath, [cli]];
  }
  return ['npm', []];
}

/**
 * The pull request's changed files, repo-relative, or `null` (which withholds
 * the marker) when this run is not for a pull request or they could not be
 * read. Diffs the event's base sha against HEAD, fetching that one commit when
 * a shallow checkout lacks it; each git call is bounded and never prompts, and
 * the paths are read NUL-separated so none is quoted.
 */
function prChangedFiles() {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') return null;
  try {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const base = event && event.pull_request && event.pull_request.base && event.pull_request.base.sha;
    if (!/^[0-9a-f]{40}$/.test(String(base))) return null;
    const git = (args) =>
      spawnSync('git', args, {
        encoding: 'utf8',
        timeout: GIT_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    if (git(['cat-file', '-e', `${base}^{commit}`]).status !== 0) {
      if (git(['fetch', '--no-tags', '--depth=1', 'origin', base]).status !== 0) return null;
    }
    // -z: every path verbatim (no C-quoting of non-ASCII, quotes or backslashes).
    const diff = git(['diff', '--name-only', '-z', base, 'HEAD']);
    if (diff.status !== 0) return null;
    return diff.stdout.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

function main() {
  const [cmd, pre] = npmCommand();
  const out = [];
  const err = [];
  let bytes = 0;
  let truncated = false;
  const cap = maxCaptureBytes();
  const keep = (into) => (chunk) => {
    bytes += chunk.length;
    if (bytes <= cap) into.push(chunk);
    else truncated = true;
  };

  const child = spawn(cmd, [...pre, 'run', 'test'], { stdio: ['inherit', 'pipe', 'pipe'] });
  child.stdout.on('data', (c) => {
    process.stdout.write(c);
    keep(out)(c);
  });
  child.stderr.on('data', (c) => {
    process.stderr.write(c);
    keep(err)(c);
  });
  let spawnFailed = false;
  child.on('error', (e) => {
    spawnFailed = true;
    process.stderr.write(`vitest-verdict: could not start npm: ${e.message}\n`);
    process.exitCode = 1;
  });
  child.on('close', (code, signal) => {
    if (spawnFailed) return;
    const status = typeof code === 'number' && code >= 0 ? code : 1;
    // The step's verdict is npm's: set it before classifying, and the try/catch
    // below keeps a classification failure from becoming an uncaught throw
    // (which would exit 1 whatever exitCode says).
    process.exitCode = status;
    if (status !== 0) {
      if (signal) {
        process.stderr.write(`vitest-verdict: npm run test ended on ${signal}; no verdict claim made\n`);
      } else if (truncated) {
        process.stderr.write('vitest-verdict: output exceeded the capture cap; no verdict claim made\n');
      } else {
        try {
          const text = `${Buffer.concat(out).toString('utf8')}\n${Buffer.concat(err).toString('utf8')}`;
          let v = classify(text);
          // Only a red that already earns the marker pays for the diff read.
          if (v.notAVerdict) v = classify(text, { changedFiles: prChangedFiles() });
          if (v.notAVerdict) process.stdout.write(`\n${annotation(v.detail)}\n`);
          else process.stderr.write(`vitest-verdict: no not-a-verdict claim made (${v.reason})\n`);
        } catch (e) {
          process.stderr.write(`vitest-verdict: classification failed (${e.message}); no verdict claim made\n`);
        }
      }
    }
  });
}

module.exports = { classify, annotation, escapeData, NOT_A_VERDICT_MARKER, ANNOTATION_TITLE };

if (require.main === module) main();
