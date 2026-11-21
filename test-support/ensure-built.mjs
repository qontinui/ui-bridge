/**
 * THE way a test in this repo makes sure its package's `dist/` is built before
 * it reads or runs it. One staleness rule and one build at a time per package,
 * so tests that read `dist/` never race each other.
 *
 *   beforeAll(() => {
 *     ensureBuilt(PKG_DIR, [join(PKG_DIR, 'dist', 'cli.js')], {
 *       prerequisites: [CLI_ARGS_PREREQUISITE],
 *     });
 *   }, 1_200_000);
 *
 * STALENESS. `dist` is stale when any expected output is missing, or when the
 * OLDEST expected output is older than the NEWEST build input. The inputs are
 * every non-test `.ts`/`.tsx` under the package's `src/`, plus its
 * `package.json`, `tsup.config.ts` and `tsconfig.build.json`, plus the same
 * inputs of every prerequisite package, plus any `extraInputs` (a directory is
 * walked like `src/`, a file counts as itself). Test files are not bundled, so
 * editing one does not make `dist` stale. `package.json` counts because its
 * `dependencies` decide what tsup externalises; a prerequisite's sources count
 * because tsup inlines them (headless and wrapper inline cli-args).
 *
 * PREREQUISITES are built first, each through ensureBuilt under its own lock, so
 * a package is never bundled from a missing or stale prerequisite `dist`.
 *
 * ONE BUILD AT A TIME. Vitest runs test files in parallel, in separate workers,
 * and the tsup configs set `clean: true`, so two files that both judged `dist`
 * stale would each wipe it while the other reads it. A build therefore runs
 * under an exclusive lockfile in `os.tmpdir()`, keyed by the package directory.
 * The lock is created atomically WITH its owner record (pid, random token,
 * start time) by hard-linking a fully written temp file into place, so no reader
 * ever sees an empty lock. A caller that finds the lock held waits, then checks
 * staleness again, so it reuses the holder's build instead of rebuilding over it.
 *
 * ABANDONED LOCKS are stolen atomically. A lock is abandoned when its holder
 * process is gone, or when it is older than LOCK_EXPIRY_MS (twice the build
 * timeout, so a live build is never judged abandoned). A waiter renames the lock
 * to a name of its own; only one rename can succeed. The winner re-reads the
 * renamed record and deletes it only when it still carries the token judged
 * abandoned. If it does not (a new holder took the lock between the judgement
 * and the rename), the winner links it back into place. Releasing a lock goes
 * through the same rename, so a holder only ever deletes its own record.
 *
 * TIMEOUT. The build runs under a small supervisor (ensure-built-runner.mjs)
 * that kills the build's whole process tree when it outlives the timeout: on
 * Windows `taskkill /T /F /PID <the build's own pid>`, elsewhere a SIGKILL to
 * the build's own process group. Never by image name.
 *
 * FAILURE MARKER. A failed build records its error and the newest input mtime
 * beside the lock for FAILURE_TTL_MS. Until the inputs change or the marker
 * expires, every caller and waiter fails fast with that error instead of running
 * the same failing build again. A successful build removes the marker.
 *
 * Within one process, a (package, outputs) pair already brought up to date is
 * not checked again. A waiter that has waited more than WAIT_NOTICE_MS prints the
 * lock path and holder pid once.
 *
 * CI builds before it tests, so the check passes at once there. Locally it runs
 * the package's own `npm run build`, never a second build path.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, 'ensure-built-runner.mjs');

export const BUILD_TIMEOUT_MS = 600_000;
export const LOCK_EXPIRY_MS = 2 * BUILD_TIMEOUT_MS;
export const FAILURE_TTL_MS = 300_000;
const WAIT_NOTICE_MS = 10_000;
const POLL_MS = 250;
const CONFIG_INPUTS = ['package.json', 'tsup.config.ts', 'tsconfig.build.json'];

/** `@qontinui/ui-bridge-cli-args`, which headless and the wrapper inline. */
const CLI_ARGS_DIR = resolve(HERE, '..', 'packages', 'ui-bridge-cli-args');
export const CLI_ARGS_PREREQUISITE = {
  pkgDir: CLI_ARGS_DIR,
  outputs: [join(CLI_ARGS_DIR, 'dist', 'index.js'), join(CLI_ARGS_DIR, 'dist', 'index.cjs')],
};

/** Memo keys (package dir + sorted outputs) this process has brought up to date. */
const checked = new Set();

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

function newestOf(path) {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  return st.isDirectory() ? newestUnder(path) : st.mtimeMs;
}

/** The build inputs of one package: its src/ tree and its build config files. */
function packageInputs(pkgDir) {
  return [join(pkgDir, 'src'), ...CONFIG_INPUTS.map((name) => join(pkgDir, name))];
}

function allInputs(pkgDir, options) {
  return [
    ...packageInputs(pkgDir),
    ...(options.prerequisites ?? []).flatMap((p) => packageInputs(resolve(p.pkgDir))),
    ...(options.extraInputs ?? []).map((p) => resolve(p)),
  ];
}

/** Newest mtime across the package's build inputs (see STALENESS). */
export function newestInputMtime(pkgDir, options = {}) {
  return Math.max(0, ...allInputs(resolve(pkgDir), options).map(newestOf));
}

/** True when an output is missing, or the oldest output predates the newest input. */
export function isStale(pkgDir, outputs, options = {}) {
  if (outputs.length === 0) throw new Error('ensureBuilt: name at least one expected output');
  let oldest = Infinity;
  for (const out of outputs) {
    if (!existsSync(out)) return true;
    oldest = Math.min(oldest, statSync(out).mtimeMs);
  }
  return oldest < newestInputMtime(pkgDir, options);
}

/** The lockfile for a package directory (exported for tests of this helper). */
export function lockPathFor(pkgDir) {
  const key = createHash('sha256').update(resolve(pkgDir)).digest('hex').slice(0, 16);
  return join(tmpdir(), `ui-bridge-ensure-built-${key}.lock`);
}

function failurePathFor(lock) {
  return `${lock}.failed`;
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return err?.code === 'EPERM';
  }
}

function readRecord(path) {
  try {
    const rec = JSON.parse(readFileSync(path, 'utf8'));
    return rec && typeof rec.token === 'string' ? rec : null;
  } catch {
    return null;
  }
}

/** Create `lock` holding `record`, atomically; false when it already exists. */
function tryAcquire(lock, record) {
  const temp = `${lock}.${process.pid}.${randomUUID()}.new`;
  writeFileSync(temp, JSON.stringify(record));
  try {
    linkSync(temp, lock);
    return true;
  } catch (err) {
    if (err?.code === 'EEXIST') return false;
    throw err;
  } finally {
    rmSync(temp, { force: true });
  }
}

/**
 * Take `lock` out of place by an atomic rename and delete it only when it still
 * carries `token`; otherwise put it back. False when someone else got there first.
 */
function removeIfToken(lock, token) {
  const aside = `${lock}.${process.pid}.${randomUUID()}.stale`;
  try {
    renameSync(lock, aside);
  } catch (err) {
    if (err?.code === 'ENOENT') return false;
    throw err;
  }
  const rec = readRecord(aside);
  if (rec?.token === token) {
    rmSync(aside, { force: true });
    return true;
  }
  // A new holder took the lock between the judgement and the rename: restore it.
  try {
    linkSync(aside, lock);
  } catch {
    // Another lock already took its place; the restored record would duplicate it.
  }
  rmSync(aside, { force: true });
  return false;
}

/** Steal the lock when its holder is gone or it has outlived LOCK_EXPIRY_MS. */
function stealIfAbandoned(lock, now = Date.now()) {
  const rec = readRecord(lock);
  if (rec === null) {
    // Unreadable: a record from an older helper, or garbage. Age decides.
    try {
      if (now - statSync(lock).mtimeMs > LOCK_EXPIRY_MS) rmSync(lock, { force: true });
    } catch {
      // Released meanwhile.
    }
    return;
  }
  if (now - rec.startedAt > LOCK_EXPIRY_MS || !pidAlive(rec.pid)) removeIfToken(lock, rec.token);
}

function readFailure(lock, newestInput) {
  try {
    const rec = JSON.parse(readFileSync(failurePathFor(lock), 'utf8'));
    if (Date.now() - rec.at > FAILURE_TTL_MS) return null;
    if (rec.newestInput !== newestInput) return null;
    return rec;
  } catch {
    return null;
  }
}

function failFast(dir, failure) {
  throw new Error(
    `ensureBuilt: the last build of ${dir} failed and its inputs have not changed since ` +
      `(recorded ${new Date(failure.at).toISOString()}): ${failure.error}`
  );
}

function runBuild(pkgDir, command, timeoutMs) {
  const r = spawnSync(process.execPath, [RUNNER, pkgDir, String(timeoutMs), command], {
    stdio: 'inherit',
  });
  if (r.error) return `could not start the build supervisor: ${r.error.message}`;
  if (r.status === 124)
    return `\`${command}\` timed out after ${timeoutMs} ms (process tree killed)`;
  if (r.status !== 0) return `\`${command}\` exited with ${r.status ?? r.signal}`;
  return null;
}

/**
 * Make sure `outputs` (absolute paths under the package's `dist/`) are built
 * from the package's current sources, one build at a time per package.
 *
 * options.prerequisites  [{ pkgDir, outputs }] built first; their inputs count.
 * options.extraInputs    further files or directories whose mtimes count.
 * options.buildCommand   default `npm run build`; tests of this helper override it.
 * options.timeoutMs      default BUILD_TIMEOUT_MS.
 */
export function ensureBuilt(pkgDir, outputs, options = {}) {
  const dir = resolve(pkgDir);
  const memoKey = `${dir}\0${[...outputs]
    .map((o) => resolve(o))
    .sort()
    .join('\0')}`;
  if (checked.has(memoKey)) return;

  for (const pre of options.prerequisites ?? []) ensureBuilt(pre.pkgDir, pre.outputs);

  const command = options.buildCommand ?? 'npm run build';
  const timeoutMs = options.timeoutMs ?? BUILD_TIMEOUT_MS;
  const lock = lockPathFor(dir);
  const waitStart = Date.now();
  const deadline = waitStart + LOCK_EXPIRY_MS + timeoutMs;
  let noticed = false;

  for (;;) {
    if (!isStale(dir, outputs, options)) {
      checked.add(memoKey);
      return;
    }
    const failure = readFailure(lock, newestInputMtime(dir, options));
    if (failure) failFast(dir, failure);

    const record = { pid: process.pid, token: randomUUID(), startedAt: Date.now() };
    if (tryAcquire(lock, record)) {
      let error = null;
      try {
        // A holder may have finished between our staleness check and the acquire.
        if (isStale(dir, outputs, options)) {
          error = runBuild(dir, command, timeoutMs);
          if (error === null && isStale(dir, outputs, options)) {
            error = `\`${command}\` succeeded but left ${dir} stale (an expected output is missing or old)`;
          }
          if (error === null) {
            rmSync(failurePathFor(lock), { force: true });
          } else {
            writeFileSync(
              failurePathFor(lock),
              JSON.stringify({ error, newestInput: newestInputMtime(dir, options), at: Date.now() })
            );
          }
        }
      } finally {
        removeIfToken(lock, record.token);
      }
      if (error !== null) throw new Error(`ensureBuilt: ${error}`);
      checked.add(memoKey);
      return;
    }

    if (Date.now() > deadline) {
      throw new Error(`ensureBuilt: timed out waiting for the build lock ${lock}`);
    }
    if (!noticed && Date.now() - waitStart > WAIT_NOTICE_MS) {
      noticed = true;
      const holder = readRecord(lock);
      console.error(
        `ensureBuilt: waiting for ${lock}, held by pid ${holder?.pid ?? 'unknown'} (building ${dir})`
      );
    }
    stealIfAbandoned(lock);
    sleepSync(POLL_MS);
  }
}
