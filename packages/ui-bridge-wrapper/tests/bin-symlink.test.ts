import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regression guard for the CLI entry-point guard.
 *
 * Every bin in this package used to decide "am I the entry point?" by
 * comparing `process.argv[1]` against its own filename. `process.argv[1]` is
 * the path AS INVOKED and Node never resolves symlinks in it, so when the CLI
 * ran through its installed bin symlink — `node_modules/.bin/ui-bridge-inject`,
 * which is exactly what `npx -p @qontinui/ui-bridge-wrapper ui-bridge-inject`
 * resolves to — argv[1] was the symlink while the module's own filename was the
 * real `dist/*.cjs`. The two differed, `main()` never ran, and the process
 * exited 0 having printed NOTHING. Measured on 0.7.1: `exit=0`, zero bytes on
 * both streams, no browser, no tab — and every caller reads exit 0 as success.
 *
 * The unit tests around it all called `parseArgs` / `validateArgs` directly,
 * which is precisely why this shipped: the entry guard itself was never
 * executed by anything. So this test executes the BUILT bin THROUGH A SYMLINK
 * and asserts it behaves exactly as the real path does.
 *
 * The bin roster is read from package.json, so a newly added bin is covered
 * automatically rather than needing someone to remember this file.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, '..');

const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as {
  bin: Record<string, string>;
};
const BINS = Object.entries(pkg.bin).map(([name, rel]) => ({
  name,
  dist: resolve(PKG_DIR, rel),
}));

/** Newest mtime under `src/` — used to detect a dist built from older sources. */
function newestSourceMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestSourceMtime(abs));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
      newest = Math.max(newest, statSync(abs).mtimeMs);
  }
  return newest;
}

/**
 * The bins only exist once the package is built. CI builds before it tests
 * (see .github/workflows/ci.yml), so this is a no-op there; locally it runs the
 * package's own `npm run build` rather than inventing a second build path.
 * A dist older than any source file is rebuilt too — a stale bundle would make
 * this test report on code that is no longer in the tree.
 */
function ensureBuilt(): void {
  const srcNewest = newestSourceMtime(join(PKG_DIR, 'src'));
  const stale = BINS.some((b) => !existsSync(b.dist) || statSync(b.dist).mtimeMs < srcNewest);
  if (!stale) return;
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: PKG_DIR,
    stdio: 'inherit',
    timeout: 600_000,
  });
}

/**
 * npm only materialises bins as real symlinks on POSIX; on Windows it writes
 * `.cmd`/`.ps1` shims and creating a symlink usually needs elevation. Probe
 * rather than assume, and skip loudly where the mechanism does not exist.
 */
const SYMLINK_DIR = mkdtempSync(join(tmpdir(), 'ui-bridge-bin-symlink-'));
const SYMLINKS_AVAILABLE = (() => {
  try {
    symlinkSync(join(PKG_DIR, 'package.json'), join(SYMLINK_DIR, '__probe'));
    return true;
  } catch {
    return false;
  }
})();

function run(entry: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [entry], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe.skipIf(!SYMLINKS_AVAILABLE)('bin entry guard survives the bin symlink', () => {
  beforeAll(() => {
    ensureBuilt();
  }, 600_000);

  for (const bin of BINS) {
    it(`${bin.name} runs main() when invoked through node_modules/.bin/${bin.name}`, () => {
      const link = join(SYMLINK_DIR, bin.name);
      if (!existsSync(link)) symlinkSync(bin.dist, link);

      // No args: every bin here is missing a required option, so it must
      // complain and exit non-zero. Before the fix this was a silent exit 0.
      const viaSymlink = run(link);

      expect(
        viaSymlink.stdout + viaSymlink.stderr,
        `${bin.name} produced no output at all through its bin symlink — the ` +
          'entry-point guard did not fire and main() never ran'
      ).not.toBe('');
      expect(
        viaSymlink.status,
        `${bin.name} exited 0 through its bin symlink with a required option missing`
      ).not.toBe(0);

      // ...and it must behave the same as invoking the real file directly.
      const viaRealPath = run(bin.dist);
      expect(viaSymlink.status).toBe(viaRealPath.status);
      expect(viaSymlink.stdout + viaSymlink.stderr).toBe(viaRealPath.stdout + viaRealPath.stderr);
    }, 120_000);
  }
});
