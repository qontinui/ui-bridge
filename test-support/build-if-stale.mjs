/**
 * Build a package's dist before its tests read it, from a vitest `globalSetup`.
 *
 * A globalSetup runs ONCE, in vitest's main process, before any test worker
 * starts. So within one `vitest run` the build happens serially and exactly
 * once, and no test file ever builds (or wipes, through tsup's `clean: true`) a
 * dist that a parallel test file is reading: nothing races inside one run, and
 * test files only assert that the outputs exist. Two CONCURRENT vitest runs in
 * one checkout are not guarded against each other: both may judge a dist stale
 * and rebuild it. A build that fails is therefore re-checked, and when the dist
 * has meanwhile become fresh (a peer run built it), setup proceeds. Watch mode
 * does not re-run a globalSetup, so a source edit under `vitest` (watch) needs
 * a restart or a manual `npm run build`.
 *
 * STALENESS (the one rule). A package is stale when a required output is
 * missing, or when its OLDEST required output is older than the NEWEST build
 * input. Build inputs are every file under `src/` except test files
 * (`*.test.ts`, `*.test.tsx`), plus `package.json`, `tsconfig.json`,
 * `tsconfig.build.json` and `tsup.config.ts`, of the package itself and of each
 * package it inlines (`inlines`). `package.json` counts because its
 * `dependencies` decide what tsup externalises.
 *
 * ORDER. Steps run in the order given, so an inlined package (cli-args) is
 * built before the package that bundles it.
 *
 * TIMEOUT. Each build gets BUILD_TIMEOUT_MS (10 min; QONTINUI_TEST_BUILD_TIMEOUT_MS
 * overrides it). On timeout the build's whole process tree is killed by its own
 * pid (`taskkill /T /F /PID <pid>` on Windows, SIGKILL to its process group
 * elsewhere), never by image name, and setup throws.
 *
 * In CI the root `npm run build` runs first, so every step is a no-op there.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_INPUTS = ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'tsup.config.ts'];
const LOG = '[build-if-stale]';
const DEFAULT_TIMEOUT_MS = 600_000;

/** The build timeout: QONTINUI_TEST_BUILD_TIMEOUT_MS when set to a positive number, else 10 min. */
export function buildTimeoutMs() {
  const raw = Number(process.env.QONTINUI_TEST_BUILD_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/** `@qontinui/ui-bridge-cli-args`, which ui-bridge-headless and ui-bridge-wrapper inline. */
export const CLI_ARGS = {
  dir: 'packages/ui-bridge-cli-args',
  outputs: ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts'],
  inlines: [],
};

function isSourceInput(name) {
  return !/\.test\.tsx?$/.test(name);
}

function newestUnder(dir) {
  let newest = 0;
  if (!existsSync(dir)) return newest;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestUnder(abs));
    else if (isSourceInput(entry.name)) newest = Math.max(newest, statSync(abs).mtimeMs);
  }
  return newest;
}

function newestInputOf(pkgDir) {
  let newest = newestUnder(join(pkgDir, 'src'));
  for (const name of CONFIG_INPUTS) {
    const abs = join(pkgDir, name);
    if (existsSync(abs)) newest = Math.max(newest, statSync(abs).mtimeMs);
  }
  return newest;
}

/**
 * Why `step` needs a build, or null when its dist is fresh.
 * A step is `{ dir, outputs, inlines }`: `dir` relative to the repo root (or
 * absolute), `outputs` relative to `dir`, `inlines` the package dirs it bundles.
 */
export function staleReason(step) {
  const pkgDir = resolve(REPO_ROOT, step.dir);
  let oldest = Infinity;
  for (const rel of step.outputs) {
    if (!existsSync(join(pkgDir, rel))) return `${rel} is missing`;
    oldest = Math.min(oldest, statSync(join(pkgDir, rel)).mtimeMs);
  }
  const newest = Math.max(
    newestInputOf(pkgDir),
    ...(step.inlines ?? []).map((dir) => newestInputOf(resolve(REPO_ROOT, dir)))
  );
  return oldest < newest ? 'a build input is newer than its oldest output' : null;
}

function killTree(child) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

/** Run `npm run build -w <dir>` from the repo root; resolves to an error string or null. */
function runBuild(dir, timeoutMs) {
  const command = `npm run build -w ${dir}`;
  return new Promise((resolveRun) => {
    // A fixed command string through the shell: npm is a .cmd on Windows,
    // which Node will not spawn without one. On POSIX the shell leads its own
    // process group, so a timeout can signal the whole tree.
    const child = spawn(command, {
      cwd: REPO_ROOT,
      shell: true,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolveRun(`could not run \`${command}\`: ${err.message}`);
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        resolveRun(
          `\`${command}\` did not finish within ${timeoutMs} ms; its process tree (pid ` +
            `${child.pid}) was killed. Set QONTINUI_TEST_BUILD_TIMEOUT_MS to allow longer.`
        );
      } else if (code !== 0) {
        resolveRun(`\`${command}\` failed (exit ${code ?? signal})`);
      } else {
        resolveRun(null);
      }
    });
  });
}

/** Build each stale step, in order; throws when a step is still stale afterwards. */
export async function buildIfStale(steps) {
  const timeoutMs = buildTimeoutMs();
  for (const step of steps) {
    const reason = staleReason(step);
    if (reason === null) {
      console.log(`${LOG} ${step.dir} is fresh`);
      continue;
    }
    console.log(`${LOG} building ${step.dir} (${reason})`);
    const error = await runBuild(step.dir, timeoutMs);
    const after = staleReason(step);
    if (error !== null) {
      if (after === null) {
        console.log(
          `${LOG} ${step.dir} build failed, but its dist is now fresh (a concurrent run built it); proceeding`
        );
        continue;
      }
      throw new Error(`${LOG} ${error}`);
    }
    if (after !== null)
      throw new Error(`${LOG} ${step.dir} is still stale after its build: ${after}`);
  }
}

/** The message a test shows when an output it needs is missing. */
export function missingOutputMessage(path) {
  return (
    `${path} is missing. It is built by this package's vitest globalSetup ` +
    `(vitest.global-setup.ts, via test-support/build-if-stale.mjs) before any test runs; ` +
    `run the tests through \`vitest run\` in the package, or build it with \`npm run build\`.`
  );
}
