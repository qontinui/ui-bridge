import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regression guard for the `ui-bridge-tab` entry-point guard.
 *
 * The guard used to compare `process.argv[1]` — the path AS INVOKED, which
 * Node never resolves symlinks in — against `import.meta.url`. Run through the
 * installed bin symlink (`node_modules/.bin/ui-bridge-tab`, i.e. what `npx`
 * resolves to) the two differed, `main()` never ran, and the process exited 0
 * having printed nothing at all. `cli.test.ts` only exercises `parseArgs`, so
 * nothing executed the guard until this test.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, '..');
const BIN_NAME = 'ui-bridge-tab';
const DIST = join(PKG_DIR, 'dist', 'cli.js');

function newestSourceMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestSourceMtime(abs));
    else if (entry.name.endsWith('.ts')) newest = Math.max(newest, statSync(abs).mtimeMs);
  }
  return newest;
}

/** CI builds before it tests, so this is a no-op there; locally it runs the
 * package's own build rather than inventing a second build path. */
function ensureBuilt(): void {
  if (existsSync(DIST) && statSync(DIST).mtimeMs >= newestSourceMtime(join(PKG_DIR, 'src'))) return;
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: PKG_DIR,
    stdio: 'inherit',
    timeout: 600_000,
  });
}

// npm only materialises bins as real symlinks on POSIX; probe rather than assume.
const SYMLINK_DIR = mkdtempSync(join(tmpdir(), 'ui-bridge-tab-symlink-'));
const SYMLINKS_AVAILABLE = (() => {
  try {
    symlinkSync(join(PKG_DIR, 'package.json'), join(SYMLINK_DIR, '__probe'));
    return true;
  } catch {
    return false;
  }
})();

function run(entry: string): { status: number | null; output: string } {
  const r = spawnSync(process.execPath, [entry], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return { status: r.status, output: (r.stdout ?? '') + (r.stderr ?? '') };
}

describe.skipIf(!SYMLINKS_AVAILABLE)('ui-bridge-tab entry guard survives the bin symlink', () => {
  beforeAll(() => {
    ensureBuilt();
  }, 600_000);

  it('runs main() when invoked through node_modules/.bin/ui-bridge-tab', () => {
    const link = join(SYMLINK_DIR, BIN_NAME);
    if (!existsSync(link)) symlinkSync(DIST, link);

    // No `--url`: must complain and exit non-zero, never a silent exit 0.
    const viaSymlink = run(link);
    expect(
      viaSymlink.output,
      'no output at all through the bin symlink — the entry guard never fired'
    ).not.toBe('');
    expect(viaSymlink.status, 'exited 0 through the bin symlink with --url missing').not.toBe(0);

    const viaRealPath = run(DIST);
    expect(viaSymlink.status).toBe(viaRealPath.status);
    expect(viaSymlink.output).toBe(viaRealPath.output);
  }, 120_000);
});
