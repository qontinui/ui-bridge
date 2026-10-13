/**
 * The shared real-Chromium gate (test-support/chromium-gate.mjs) refuses a test
 * file that `npm run test:smoke` would not run, flag or no flag. ci.yml's
 * browser-smokes job runs nothing but test:smoke, so a gated test anywhere else
 * would skip here in lint-and-test and run nowhere; the refusal fails it here
 * instead. Not a smoke file itself: it calls the gate with other files' paths.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  REQUIRE_CHROMIUM_ENV,
  chromiumAvailable,
  smokeFilters,
  smokeSelection,
} from '../../../test-support/chromium-gate.mjs';

// A test file beside this one. The gate reads only that path and this package's
// package.json, so the file need not exist.
const beside = (name: string) => new URL(`./${name}`, import.meta.url).href;

describe('the real-Chromium gate admits only a file test:smoke runs', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[REQUIRE_CHROMIUM_ENV];
    delete process.env[REQUIRE_CHROMIUM_ENV];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[REQUIRE_CHROMIUM_ENV];
    else process.env[REQUIRE_CHROMIUM_ENV] = saved;
  });

  it('refuses a caller outside a smoke file, flag or no flag', () => {
    const misplaced = beside('frame-pixels.test.ts');
    expect(() => chromiumAvailable(misplaced)).toThrow(
      /tests\/frame-pixels\.test\.ts runs a real-Chromium test, but its package's test:smoke \(`vitest run smoke`\) does not select it/
    );
    process.env[REQUIRE_CHROMIUM_ENV] = '1';
    expect(() => chromiumAvailable(misplaced)).toThrow(/does not select it/);
  });

  it('admits a smoke caller and answers whether Chromium is installed', () => {
    expect(typeof chromiumAvailable(beside('frame-pixels-smoke.test.ts'))).toBe('boolean');
  });

  it("selects by vitest's own filter rule: the path below the package, any case", () => {
    const at = (name: string) => smokeSelection(fileURLToPath(beside(name)));
    expect(at('Frame-SMOKE.test.ts').selected).toBe(true);
    expect(at('smoke/frame-pixels.test.ts').selected).toBe(true);
    expect(at('smoke.test.ts').relativePath).toBe('tests/smoke.test.ts');
    expect(at('frame-pixels.test.ts').selected).toBe(false);
  });

  it('refuses a call that does not say which file it comes from', () => {
    const gate = chromiumAvailable as (callerUrl?: unknown) => boolean;
    expect(() => gate()).toThrow(/pass the calling test file's import\.meta\.url/);
    expect(() => gate('/abs/path/x-smoke.test.ts')).toThrow(/pass the calling test file's/);
  });

  it('refuses a smoke file in a package with no test:smoke script', () => {
    const root = mkdtempSync(join(tmpdir(), 'chromium-gate-'));
    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ scripts: { test: 'vitest run' } })
      );
      const caller = pathToFileURL(join(root, 'tests', 'frame-pixels-smoke.test.ts')).href;
      expect(() => chromiumAvailable(caller)).toThrow(
        /package\.json has no test:smoke script running `vitest run <filter>`/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads the filters off the package's own test:smoke script", () => {
    expect(smokeSelection(fileURLToPath(import.meta.url)).filters).toEqual(['smoke']);
    expect(smokeFilters('vitest run --reporter=dot smoke frames && node x.mjs late')).toEqual([
      'smoke',
      'frames',
    ]);
    expect(smokeFilters('node scripts/run-smokes.mjs')).toEqual([]);
    expect(smokeFilters(undefined)).toEqual([]);
  });
});
