import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingOutputMessage } from '../../../test-support/build-if-stale.mjs';

/**
 * Regression guard for the entry-point guard of both bins (`entry-guard.ts`).
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
/** Every bin the manifest ships; each must run main() through its symlink. */
const BINS = [
  { name: 'ui-bridge-tab', dist: join(PKG_DIR, 'dist', 'cli.js') },
  { name: 'ui-bridge-density', dist: join(PKG_DIR, 'dist', 'density-cli.js') },
];

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

describe.skipIf(!SYMLINKS_AVAILABLE)('the entry guard survives the bin symlink', () => {
  beforeAll(() => {
    // Built once by vitest.global-setup.ts before any worker starts.
    for (const bin of BINS) expect(existsSync(bin.dist), missingOutputMessage(bin.dist)).toBe(true);
  });

  it('the list covers every bin in the manifest', () => {
    const manifest = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as {
      bin: Record<string, string>;
    };
    expect(Object.keys(manifest.bin).sort()).toEqual(BINS.map((b) => b.name).sort());
  });

  it.each(BINS)(
    'runs main() when invoked through node_modules/.bin/$name',
    ({ name, dist }) => {
      const link = join(SYMLINK_DIR, name);
      if (!existsSync(link)) symlinkSync(dist, link);

      // No argument: must complain and exit non-zero, never a silent exit 0.
      const viaSymlink = run(link);
      expect(
        viaSymlink.output,
        'no output at all through the bin symlink — the entry guard never fired'
      ).not.toBe('');
      expect(viaSymlink.status, 'exited 0 through the bin symlink with no argument').not.toBe(0);

      const viaRealPath = run(dist);
      expect(viaSymlink.status).toBe(viaRealPath.status);
      expect(viaSymlink.output).toBe(viaRealPath.output);
    },
    120_000
  );
});
