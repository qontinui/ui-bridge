/**
 * Build a package's dist before its tests read it, from a vitest `globalSetup`.
 *
 * A globalSetup runs ONCE, in vitest's main process, before any test worker
 * starts. So the build happens serially and exactly once per `vitest run`, and
 * no test file ever builds (or wipes, through tsup's `clean: true`) a dist that
 * a parallel test file is reading. That is why there is no lock here: there is
 * nothing to race. Test files only assert that the outputs exist.
 *
 * STALENESS (the one rule). A package is stale when a required output is
 * missing, or when its OLDEST required output is older than the NEWEST build
 * input. Build inputs are every non-test `.ts`/`.tsx` under `src/`, plus
 * `package.json`, `tsup.config.ts` and `tsconfig.build.json`, of the package
 * itself and of each package it inlines (`inlines`). `package.json` counts
 * because its `dependencies` decide what tsup externalises.
 *
 * ORDER. Steps run in the order given, so an inlined package (cli-args) is
 * built before the package that bundles it. A failed build throws, which
 * fails the whole `vitest run` before any test runs.
 *
 * In CI the root `npm run build` runs first, so every step is a no-op there.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_INPUTS = ['package.json', 'tsup.config.ts', 'tsconfig.build.json'];
const LOG = '[build-if-stale]';

/** `@qontinui/ui-bridge-cli-args`, which ui-bridge-headless and ui-bridge-wrapper inline. */
export const CLI_ARGS = {
  dir: 'packages/ui-bridge-cli-args',
  outputs: ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts'],
  inlines: [],
};

function isSourceInput(name) {
  return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name);
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
 * A step is `{ dir, outputs, inlines }`: `dir` relative to the repo root,
 * `outputs` relative to `dir`, `inlines` the repo-relative dirs it bundles.
 */
export function staleReason(step) {
  const pkgDir = join(REPO_ROOT, step.dir);
  let oldest = Infinity;
  for (const rel of step.outputs) {
    const out = join(pkgDir, rel);
    if (!existsSync(out)) return `${rel} is missing`;
    oldest = Math.min(oldest, statSync(out).mtimeMs);
  }
  const newest = Math.max(
    newestInputOf(pkgDir),
    ...(step.inlines ?? []).map((dir) => newestInputOf(join(REPO_ROOT, dir)))
  );
  return oldest < newest ? 'a build input is newer than its oldest output' : null;
}

/** Build each stale step, in order, with `npm run build -w <dir>`; throw on failure. */
export function buildIfStale(steps) {
  for (const step of steps) {
    const reason = staleReason(step);
    if (reason === null) {
      console.log(`${LOG} ${step.dir} is fresh`);
      continue;
    }
    console.log(`${LOG} building ${step.dir} (${reason})`);
    // A fixed command string through the shell: npm is a .cmd on Windows,
    // which Node will not spawn without one.
    const r = spawnSync(`npm run build -w ${step.dir}`, {
      cwd: REPO_ROOT,
      shell: true,
      stdio: 'inherit',
    });
    if (r.error)
      throw new Error(`${LOG} could not run the build of ${step.dir}: ${r.error.message}`);
    if (r.status !== 0) {
      throw new Error(
        `${LOG} \`npm run build -w ${step.dir}\` failed (exit ${r.status ?? r.signal})`
      );
    }
    const after = staleReason(step);
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
