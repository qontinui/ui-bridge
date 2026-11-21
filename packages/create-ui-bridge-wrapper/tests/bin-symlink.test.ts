import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missingOutputMessage } from '../../../test-support/build-if-stale.mjs';

/**
 * Regression guard for the `create-ui-bridge-wrapper` entry-point guard.
 *
 * The guard used to compare `resolve(process.argv[1])` — the path AS INVOKED,
 * which Node never resolves symlinks in — against `import.meta.url`. Since the
 * ONLY supported way to run this bin is through a symlink npm materialises
 * (`npm create @qontinui/ui-bridge-wrapper` / `npx create-ui-bridge-wrapper`),
 * the two always differed: `run()` never ran and the process exited 0 having
 * printed nothing at all. `cli-smoke.test.ts` calls `run()` in-process, so
 * nothing executed the guard until this test.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_DIR = resolve(HERE, '..');
const BIN_NAME = 'create-ui-bridge-wrapper';
const DIST = join(PKG_DIR, 'dist', 'cli.js');

// npm only materialises bins as real symlinks on POSIX; probe rather than assume.
const SYMLINK_DIR = mkdtempSync(join(tmpdir(), 'create-ui-bridge-wrapper-symlink-'));
const SYMLINKS_AVAILABLE = (() => {
  try {
    symlinkSync(join(PKG_DIR, 'package.json'), join(SYMLINK_DIR, '__probe'));
    return true;
  } catch {
    return false;
  }
})();

function run(entry: string): { status: number | null; output: string } {
  const r = spawnSync(process.execPath, [entry, '--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  return { status: r.status, output: (r.stdout ?? '') + (r.stderr ?? '') };
}

describe.skipIf(!SYMLINKS_AVAILABLE)(
  'create-ui-bridge-wrapper entry guard survives the bin symlink',
  () => {
    beforeAll(() => {
      // Built once by vitest.global-setup.ts before any worker starts.
      expect(existsSync(DIST), missingOutputMessage(DIST)).toBe(true);
    });

    it('runs the CLI when invoked through node_modules/.bin/create-ui-bridge-wrapper', () => {
      const link = join(SYMLINK_DIR, BIN_NAME);
      if (!existsSync(link)) symlinkSync(DIST, link);

      const viaSymlink = run(link);
      expect(
        viaSymlink.output,
        'no output at all through the bin symlink — the entry guard never fired'
      ).not.toBe('');
      expect(viaSymlink.output).toContain('create-ui-bridge-wrapper');

      const viaRealPath = run(DIST);
      expect(viaSymlink.status).toBe(viaRealPath.status);
      expect(viaSymlink.output).toBe(viaRealPath.output);
    }, 120_000);
  }
);
