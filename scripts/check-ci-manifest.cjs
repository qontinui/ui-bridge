#!/usr/bin/env node
// Local-CI manifest ratchet — validates `.qontinui/ci.toml` and enforces the
// Actions-parity invariant that manifest's own header declares.
//
// WHY THIS EXISTS
//
// `.qontinui/ci.toml` (added in PR #149) is the ONLY source of commands for the
// runner-as-CI-node lane: coord dispatches a SHA, the runner reads this file
// out of the checked-out tree and executes exactly what it says. Two things
// were true of it and neither was checked by anything:
//
//   1. Its header states "PARITY IS A REVIEW-TIME INVARIANT: the steps below
//      mirror the gate commands of .github/workflows/ci.yml's `lint-and-test`
//      and `docs` jobs, step for step and in their order. When those jobs
//      change, update this file in the SAME PR." Nothing enforced that, so the
//      first person to add a gate step to ci.yml would silently leave the
//      product lane weaker than the Actions lane — and a lane that is green
//      because it runs FEWER gates is the worst possible failure mode for a
//      verdict two lanes are supposed to agree on.
//
//   2. Nothing in this repo ever parsed the file. A typo — an unknown key, a
//      banned metacharacter, an oversize timeout — would be discovered at
//      DISPATCH time, on a user's machine, as a failed build with no commit to
//      blame. This repo cannot run the runner's Rust parser, so the rules are
//      mirrored here (see CONTRACT below) and run on every PR instead.
//
// This is the same shape as the repo's other ratchets (`diagnostics:check`,
// `redaction:check-surface`, `deps:check-ranges`): recompute the invariant from
// source, fail on drift, and make the fix obvious in the failure message.
//
// CONTRACT — mirrored from the runner's parser. The authority is
// `qontinui-runner/src-tauri/src/ci_node/manifest.rs::parse_and_validate`; the
// constants below are transcribed from it (ENV_ALLOWLIST, ARGV_BANNED_CHARS,
// MAX_STEP_TIMEOUT_SECS, the `deny_unknown_fields` key sets, and
// `validate_working_dir`). A transcription can drift from its source, so it is
// pinned by name here: if that file's rules change, this one must change with
// it. Failing CLOSED is the safe direction — this script may reject a manifest
// the runner would accept, but a manifest this script accepts and the runner
// rejects is the bug worth avoiding, so keep the rules at least as strict.
//
// Usage:
//   node scripts/check-ci-manifest.cjs           # verify (CI)
//   node scripts/check-ci-manifest.cjs --verbose # list every checked pairing

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const TOML = require('smol-toml');
const YAML = require('yaml');

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, '.qontinui', 'ci.toml');
const WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const VERBOSE = process.argv.includes('--verbose');

// --- the runner's contract, transcribed (manifest.rs) -----------------------

/** manifest.rs::ENV_ALLOWLIST (`:18-29`). */
const ENV_ALLOWLIST = [
  'RUSTFLAGS',
  'RUST_BACKTRACE',
  'RUST_LOG',
  'CARGO_BUILD_JOBS',
  'CARGO_INCREMENTAL',
  'CARGO_TERM_COLOR',
  'NODE_OPTIONS',
  'NODE_ENV',
  'CI',
  'QONTINUI_DISABLE_KEYCHAIN',
];

/** manifest.rs::ARGV_BANNED_CHARS (`:35`). */
const ARGV_BANNED_CHARS = ['&', '|', '<', '>', '^', '"', '\n', '\r', '\0', '%'];

/** manifest.rs::MAX_STEP_TIMEOUT_SECS (`:13`). */
const MAX_STEP_TIMEOUT_SECS = 7200;

/** `#[serde(deny_unknown_fields)]` key sets — CiManifest / CiStep / CiLimits. */
const MANIFEST_KEYS = new Set(['version', 'steps', 'limits']);
const STEP_KEYS = new Set(['name', 'command', 'env', 'timeout_secs', 'working_dir']);
const LIMITS_KEYS = new Set(['cargo_build_jobs']);

// --- the parity contract, declared ------------------------------------------

/**
 * ci.yml jobs whose every `run:` step must appear in the manifest, in order.
 * Manifest steps are matched to these by an explicit `# parity:` citation, so a
 * reordering on either side is caught rather than silently absorbed.
 */
const MIRRORED_JOBS = ['lint-and-test', 'docs'];

/**
 * ci.yml jobs deliberately NOT mirrored, each with the reason the manifest's
 * header gives. A job appearing in ci.yml that is in neither list fails this
 * check: a new gate job must be a conscious decision to mirror or to exclude,
 * which is exactly the drift this ratchet exists to catch.
 */
const EXCLUDED_JOBS = new Map([
  [
    'python-tests',
    'Its `pip install -e ".[dev]"` records an editable finder pointing into the ' +
      'dispatch directory the executor deletes, permanently breaking `import ui_bridge` ' +
      'on the host. Its 3.10/3.11/3.12 matrix is separately unrepresentable — a manifest ' +
      'has one PATH and one interpreter.',
  ],
]);

/** `# parity: <job> "<step name>"` — the citation that binds a manifest step. */
const PARITY_CITATION = /^#\s*parity:\s*ci\.yml\s+([A-Za-z0-9_-]+)\s+"(.+)"\s*$/;

const failures = [];
const fail = (msg) => failures.push(msg);

// --- manifest: parse + validate against the runner's contract ---------------

function validateManifest(manifest) {
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.has(key)) {
      fail(
        `ci.toml: unknown top-level key ${JSON.stringify(key)} — the runner parses with ` +
          `deny_unknown_fields and would reject the whole file`
      );
    }
  }

  if (manifest.version !== 1) {
    fail(`ci.toml: version must be exactly 1, got ${JSON.stringify(manifest.version)}`);
  }

  if (manifest.limits !== undefined) {
    for (const key of Object.keys(manifest.limits)) {
      if (!LIMITS_KEYS.has(key)) {
        fail(`ci.toml [limits]: unknown key ${JSON.stringify(key)}`);
      }
    }
  }

  const steps = manifest.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    fail('ci.toml: has no [[steps]] — nothing to run');
    return [];
  }

  steps.forEach((step, i) => {
    const label =
      typeof step.name === 'string' && step.name.trim() ? `step '${step.name}'` : `steps[${i}]`;

    for (const key of Object.keys(step)) {
      if (!STEP_KEYS.has(key)) {
        fail(`ci.toml ${label}: unknown key ${JSON.stringify(key)}`);
      }
    }

    if (typeof step.name !== 'string' || !step.name.trim()) {
      fail(`ci.toml ${label}: name must be a non-empty string`);
    }

    if (!Array.isArray(step.command) || step.command.length === 0) {
      fail(`ci.toml ${label}: command must be a non-empty argv array (never a shell string)`);
    } else {
      step.command.forEach((token, t) => {
        if (typeof token !== 'string') {
          fail(`ci.toml ${label}: command[${t}] must be a string`);
          return;
        }
        if (t === 0 && !token.trim()) {
          fail(`ci.toml ${label}: command[0] must be non-empty`);
        }
        const banned = ARGV_BANNED_CHARS.filter((c) => token.includes(c));
        if (banned.length > 0) {
          fail(
            `ci.toml ${label}: command token ${JSON.stringify(token)} contains banned shell ` +
              `metacharacter(s) ${JSON.stringify(banned.join(''))}`
          );
        }
      });
    }

    if (step.env !== undefined) {
      for (const key of Object.keys(step.env)) {
        if (!ENV_ALLOWLIST.includes(key)) {
          fail(
            `ci.toml ${label}: env var ${JSON.stringify(key)} is not allowlisted ` +
              `(allowed: ${ENV_ALLOWLIST.join(', ')})`
          );
        }
      }
    }

    if (step.timeout_secs !== undefined) {
      const t = step.timeout_secs;
      if (!Number.isInteger(t) || t < 1 || t > MAX_STEP_TIMEOUT_SECS) {
        fail(`ci.toml ${label}: timeout_secs ${t} out of range (1..=${MAX_STEP_TIMEOUT_SECS})`);
      }
    }

    if (step.working_dir !== undefined) {
      const wd = step.working_dir;
      if (typeof wd !== 'string' || !wd) {
        fail(`ci.toml ${label}: working_dir must be a non-empty string`);
      } else if (path.posix.isAbsolute(wd) || wd.startsWith('/') || wd.startsWith('\\') || wd.includes(':')) {
        fail(`ci.toml ${label}: working_dir ${JSON.stringify(wd)} must be repo-relative`);
      } else if (wd.split(/[\\/]/).some((c) => c === '..')) {
        fail(`ci.toml ${label}: working_dir ${JSON.stringify(wd)} must not contain parent components`);
      } else if (!fs.existsSync(path.join(REPO_ROOT, wd))) {
        // Not a runner rule — the executor canonicalizes at run time and would
        // fail there. Catching it here turns a dispatch-time failure on a user's
        // machine into a PR-time one.
        fail(`ci.toml ${label}: working_dir ${JSON.stringify(wd)} does not exist in the repo`);
      }
    }
  });

  return steps;
}

/**
 * Read each step's `# parity:` citation out of the raw TOML.
 *
 * The citation cannot be a TOML key: the runner parses `[[steps]]` with
 * `deny_unknown_fields`, so any extra key would make the whole manifest
 * unrunnable. A comment is the only place it can live, which is why this is a
 * text scan rather than a lookup on the parsed object.
 */
function readParityCitations(text) {
  const lines = text.split(/\r?\n/);
  const citations = [];
  let index = -1;

  for (const line of lines) {
    if (/^\s*\[\[steps\]\]\s*$/.test(line)) {
      index += 1;
      citations[index] = null;
      continue;
    }
    if (index < 0) continue;
    // A new top-level table ends the steps region.
    if (/^\s*\[[^[]/.test(line)) break;

    const m = line.match(PARITY_CITATION);
    if (m) {
      if (citations[index]) {
        fail(`ci.toml steps[${index}]: more than one "# parity:" citation`);
      }
      citations[index] = { job: m[1], name: m[2] };
    }
  }

  return citations;
}

// --- workflow: the steps the manifest must mirror ---------------------------

function readWorkflowSteps(workflow) {
  const jobs = workflow.jobs || {};
  const self = path.relative(REPO_ROOT, __filename).replace(/\\/g, '/');

  for (const jobName of Object.keys(jobs)) {
    if (!MIRRORED_JOBS.includes(jobName) && !EXCLUDED_JOBS.has(jobName)) {
      fail(
        `ci.yml job ${JSON.stringify(jobName)} is neither mirrored into .qontinui/ci.toml nor ` +
          `declared as excluded. Add its gate steps to the manifest, or add it to EXCLUDED_JOBS ` +
          `in ${self} with the reason it cannot run on the local-CI lane (and record that reason ` +
          `in the manifest header too).`
      );
    }
  }

  // A declared exclusion outlives the job it excuses unless something says so.
  // Left unchecked, the reasons in EXCLUDED_JOBS become folklore about jobs that
  // no longer exist — and the next reader trusts them.
  for (const [jobName, reason] of EXCLUDED_JOBS) {
    if (!(jobName in jobs)) {
      fail(
        `EXCLUDED_JOBS in ${self} still excuses ci.yml job ${JSON.stringify(jobName)}, which ` +
          `ci.yml no longer defines. Drop the entry — and drop the matching paragraph from ` +
          `.qontinui/ci.toml's "WHAT THIS MANIFEST CANNOT EXPRESS" header.`
      );
    } else if (VERBOSE) {
      process.stdout.write(`  --  ${jobName} deliberately not mirrored: ${reason}\n`);
    }
  }

  const expected = [];
  for (const jobName of MIRRORED_JOBS) {
    const job = jobs[jobName];
    if (!job) {
      fail(`ci.yml has no job ${JSON.stringify(jobName)}, but the manifest mirrors it`);
      continue;
    }
    for (const step of job.steps || []) {
      if (typeof step.run !== 'string') continue; // `uses:` steps have no command
      expected.push({
        job: jobName,
        name: typeof step.name === 'string' ? step.name : '',
        run: step.run.trim(),
        workingDir: step['working-directory'],
      });
    }
  }
  return expected;
}

// --- the parity comparison --------------------------------------------------

function checkParity(steps, citations, expected) {
  const cited = [];
  steps.forEach((step, i) => {
    if (!citations[i]) {
      fail(
        `ci.toml steps[${i}] ('${step.name}') has no "# parity:" citation. Every manifest step ` +
          `must name the ci.yml step it mirrors, e.g. ` +
          `\`# parity: ci.yml lint-and-test "Install dependencies"\`.`
      );
      return;
    }
    cited.push({ index: i, step, citation: citations[i] });
  });

  if (cited.length !== expected.length) {
    fail(
      `Parity drift: ci.yml's mirrored jobs (${MIRRORED_JOBS.join(', ')}) have ${expected.length} ` +
        `command step(s); .qontinui/ci.toml cites ${cited.length}. The manifest must mirror them ` +
        `step for step and in order — update it in the SAME PR that changed ci.yml.`
    );
  }

  const pairs = Math.min(cited.length, expected.length);
  for (let i = 0; i < pairs; i += 1) {
    const { step, citation } = cited[i];
    const want = expected[i];
    const label = `ci.toml step '${step.name}'`;

    if (citation.job !== want.job || citation.name !== want.name) {
      fail(
        `${label}: cites ci.yml ${citation.job} "${citation.name}" but position ${i} of the ` +
          `mirrored jobs is ${want.job} "${want.name}". Order is part of the invariant — the ` +
          `cheap ratchets run before Lint on purpose.`
      );
      continue;
    }

    if (want.run.includes('\n')) {
      fail(
        `${label}: ci.yml ${want.job} "${want.name}" is a multi-line shell block, which no argv ` +
          `manifest step can express. Either keep it out of a mirrored job or declare the job ` +
          `excluded with a reason.`
      );
      continue;
    }

    const argv = Array.isArray(step.command) ? step.command.join(' ') : '';
    if (argv !== want.run) {
      fail(
        `${label}: command ${JSON.stringify(argv)} does not match ci.yml ${want.job} ` +
          `"${want.name}" which runs ${JSON.stringify(want.run)}.`
      );
    }

    const manifestDir = step.working_dir ?? null;
    const actionsDir = want.workingDir ?? null;
    if (manifestDir !== actionsDir) {
      fail(
        `${label}: working_dir ${JSON.stringify(manifestDir)} does not match ci.yml ` +
          `${want.job} "${want.name}" working-directory ${JSON.stringify(actionsDir)}.`
      );
    }

    if (VERBOSE) {
      process.stdout.write(`  ok  ${want.job} "${want.name}" -> '${step.name}' (${argv})\n`);
    }
  }
}

/**
 * `npm run <script>` is only as stable as the script's name. A rename in
 * package.json leaves ci.yml and the manifest both citing a script that no
 * longer exists — Actions would fail loudly, but only after the merge.
 */
function checkNpmScriptsResolve(steps) {
  const scriptsCache = new Map();
  const scriptsFor = (dir) => {
    if (!scriptsCache.has(dir)) {
      const pkgPath = path.join(REPO_ROOT, dir, 'package.json');
      const scripts = fs.existsSync(pkgPath)
        ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts || {}
        : null;
      scriptsCache.set(dir, scripts);
    }
    return scriptsCache.get(dir);
  };

  for (const step of steps) {
    if (!Array.isArray(step.command)) continue;
    const [bin, sub, name] = step.command;
    if (bin !== 'npm' || sub !== 'run' || typeof name !== 'string') continue;

    const dir = step.working_dir ?? '.';
    const scripts = scriptsFor(dir);
    if (!scripts) {
      fail(`ci.toml step '${step.name}': no package.json at ${dir}/ to resolve \`npm run ${name}\``);
      continue;
    }
    if (!(name in scripts)) {
      fail(
        `ci.toml step '${step.name}': \`npm run ${name}\` has no matching script in ` +
          `${dir === '.' ? 'package.json' : `${dir}/package.json`}`
      );
    }
  }
}

// --- main -------------------------------------------------------------------

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    process.stderr.write(
      `Missing .qontinui/ci.toml — this repo declares a local-CI manifest and it is the only\n` +
        `source of commands for the runner-as-CI-node lane. Restore it rather than deleting it;\n` +
        `a repo without one cannot run on that lane at all.\n`
    );
    process.exit(1);
  }

  const text = fs.readFileSync(MANIFEST_PATH, 'utf8');

  let manifest;
  try {
    manifest = TOML.parse(text);
  } catch (e) {
    process.stderr.write(`.qontinui/ci.toml is not valid TOML: ${e.message}\n`);
    process.exit(1);
  }

  const steps = validateManifest(manifest);
  const citations = readParityCitations(text);

  const workflow = YAML.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
  const expected = readWorkflowSteps(workflow);

  checkParity(steps, citations, expected);
  checkNpmScriptsResolve(steps);

  if (failures.length > 0) {
    process.stderr.write(`\nCI manifest ratchet failed (${failures.length} problem(s)):\n\n`);
    for (const f of failures) process.stderr.write(`  - ${f}\n`);
    process.stderr.write(
      `\nThe manifest at .qontinui/ci.toml is what the product's local-CI lane executes.\n` +
        `Its header states the invariant this check enforces: the steps mirror ci.yml's\n` +
        `\`${MIRRORED_JOBS.join('` and `')}\` jobs, step for step and in their order, and change in the SAME PR.\n`
    );
    process.exit(1);
  }

  process.stdout.write(
    `CI manifest ok: ${steps.length} step(s) valid against the runner's contract and in parity ` +
      `with ci.yml's ${MIRRORED_JOBS.join(' + ')} jobs.\n`
  );
}

main();
