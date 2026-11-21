/**
 * THE way a test in this repo makes sure its package's `dist/` is built before
 * it reads or runs it. One staleness rule and one build at a time per package,
 * so tests that read `dist/` never race each other.
 *
 *   beforeAll(() => ensureBuilt(PKG_DIR, [join(PKG_DIR, 'dist', 'cli.js')]), 600_000);
 *
 * STALENESS. `dist` is stale when any expected output is missing, or when the
 * OLDEST expected output is older than the NEWEST build input. The inputs are
 * every non-test `.ts`/`.tsx` under `src/` plus the package's `package.json`,
 * `tsup.config.ts` and `tsconfig.build.json`. Test files are not bundled, so
 * editing one does not make `dist` stale. `package.json` counts because its
 * `dependencies` decide what tsup externalises.
 *
 * ONE BUILD AT A TIME. Vitest runs test files in parallel, in separate workers,
 * and the package's tsup config sets `clean: true`, so two files that both
 * judged `dist` stale would each wipe it while the other reads it. The build
 * therefore runs under an exclusive lockfile in `os.tmpdir()`, keyed by the
 * package directory. A caller that finds the lock held waits for it to be
 * released, then checks staleness again, so the second caller reuses the first
 * caller's build instead of rebuilding over it. A lock whose holder process is
 * gone, or that is older than the build timeout, is treated as abandoned and
 * removed. Within one process, a package that has already been checked is not
 * checked again.
 *
 * CI builds before it tests, so the check passes at once there. Locally it runs
 * the package's own `npm run build`, never a second build path.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BUILD_TIMEOUT_MS = 600_000;
const POLL_MS = 250;
const CONFIG_INPUTS = ['package.json', 'tsup.config.ts', 'tsconfig.build.json'];

/** Package directories this process has already brought up to date. */
const checked = new Set();

function isSourceInput(name) {
  return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name);
}

function newestInputMtime(pkgDir) {
  let newest = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (isSourceInput(entry.name)) newest = Math.max(newest, statSync(abs).mtimeMs);
    }
  };
  walk(join(pkgDir, 'src'));
  for (const name of CONFIG_INPUTS) {
    const abs = join(pkgDir, name);
    if (existsSync(abs)) newest = Math.max(newest, statSync(abs).mtimeMs);
  }
  return newest;
}

/** True when an output is missing, or the oldest output predates the newest input. */
export function isStale(pkgDir, outputs) {
  if (outputs.length === 0) throw new Error('ensureBuilt: name at least one expected output');
  let oldest = Infinity;
  for (const out of outputs) {
    if (!existsSync(out)) return true;
    oldest = Math.min(oldest, statSync(out).mtimeMs);
  }
  return oldest < newestInputMtime(pkgDir);
}

function lockPath(pkgDir) {
  const key = createHash('sha256').update(resolve(pkgDir)).digest('hex').slice(0, 16);
  return join(tmpdir(), `ui-bridge-ensure-built-${key}.lock`);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function holderAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but belongs to someone else.
    return err?.code === 'EPERM';
  }
}

/** Remove the lock when its holder is gone or it has outlived any build. */
function clearIfAbandoned(lock) {
  try {
    const ageMs = Date.now() - statSync(lock).mtimeMs;
    const pid = Number.parseInt(readFileSync(lock, 'utf8'), 10);
    if (ageMs > BUILD_TIMEOUT_MS || (!Number.isNaN(pid) && !holderAlive(pid))) {
      rmSync(lock, { force: true });
    }
  } catch {
    // The holder released it between our checks; the next acquire attempt decides.
  }
}

function tryAcquire(lock) {
  try {
    const fd = openSync(lock, 'wx');
    writeSync(fd, String(process.pid));
    closeSync(fd);
    return true;
  } catch (err) {
    if (err?.code === 'EEXIST') return false;
    throw err;
  }
}

function runBuild(pkgDir) {
  // A fixed command string through the shell: npm is a .cmd on Windows, which
  // Node will not spawn without one, and a shell with an args array is
  // deprecated (DEP0190).
  execSync('npm run build', {
    cwd: pkgDir,
    stdio: 'inherit',
    timeout: BUILD_TIMEOUT_MS,
  });
}

/**
 * Make sure `outputs` (absolute paths under the package's `dist/`) are built
 * from the package's current sources, building at most once at a time.
 */
export function ensureBuilt(pkgDir, outputs) {
  const dir = resolve(pkgDir);
  if (checked.has(dir)) return;
  const lock = lockPath(dir);
  const deadline = Date.now() + BUILD_TIMEOUT_MS * 2;
  for (;;) {
    if (!isStale(dir, outputs)) {
      checked.add(dir);
      return;
    }
    if (tryAcquire(lock)) {
      try {
        // A holder may have finished between our staleness check and the acquire.
        if (isStale(dir, outputs)) runBuild(dir);
      } finally {
        rmSync(lock, { force: true });
      }
      if (isStale(dir, outputs)) {
        throw new Error(`ensureBuilt: ${dir} is still stale after npm run build`);
      }
      checked.add(dir);
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`ensureBuilt: timed out waiting for the build lock ${lock}`);
    }
    clearIfAbandoned(lock);
    sleepSync(POLL_MS);
  }
}
