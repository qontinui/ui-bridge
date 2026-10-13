/**
 * The shared real-Chromium gate (test-support/chromium-gate.mjs) refuses a test
 * file that `npm run test:smoke` would not run, flag or no flag. ci.yml's
 * browser-smokes job runs nothing but test:smoke, so a gated test anywhere else
 * would skip here in lint-and-test and run nowhere; the refusal fails it here
 * instead.
 *
 * This file is not a smoke file, which is what makes it a misplaced caller: every
 * call to the gate below must be refused. The file the gate judges comes from
 * vitest's runtime, so neither a smoke-named helper (review case i) nor a
 * made-up smoke URL (case ii) can admit it. Case iii, a test with its own
 * Chromium gate, is the static check's: scripts/check-browser-test-placement.test.mjs.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REQUIRE_CHROMIUM_ENV, chromiumAvailable } from '../../../test-support/chromium-gate.mjs';
import { smokeFilters, smokeSelection } from '../../../test-support/smoke-selection.mjs';

const THIS_FILE_REFUSED =
  /packages\/ui-bridge-wrapper\/tests\/chromium-gate\.test\.ts runs a real-Chromium test, but its package's test:smoke \(`vitest run smoke`\) does not select it/;

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

  it('refuses the test file vitest is running when test:smoke does not select it, flag or no flag', () => {
    expect(() => chromiumAvailable()).toThrow(THIS_FILE_REFUSED);
    process.env[REQUIRE_CHROMIUM_ENV] = '1';
    expect(() => chromiumAvailable()).toThrow(THIS_FILE_REFUSED);
  });

  it('(i) a smoke-named helper does not admit the test file that imports it', async () => {
    await expect(import('./fixtures/smoke-helpers')).rejects.toThrow(THIS_FILE_REFUSED);
  });

  it('(ii) a made-up smoke URL admits nothing: the gate takes no argument', () => {
    const gate = chromiumAvailable as (...args: unknown[]) => boolean;
    const madeUp = new URL('./anything-smoke.test.ts', import.meta.url).href;
    expect(() => gate(madeUp)).toThrow(
      /takes no argument: the test file it checks comes from vitest/
    );
  });

  it("selects by vitest's own filter rule: the path below the package, any case", () => {
    const at = (name: string) =>
      smokeSelection(fileURLToPath(new URL(`./${name}`, import.meta.url)));
    expect(at('Frame-SMOKE.test.ts').selected).toBe(true);
    expect(at('smoke/frame-pixels.test.ts').selected).toBe(true);
    expect(at('smoke.test.ts').relativePath).toBe('tests/smoke.test.ts');
    expect(at('frame-pixels.test.ts').selected).toBe(false);
  });

  it('selects nothing in a package with no test:smoke script', () => {
    const root = mkdtempSync(join(tmpdir(), 'chromium-gate-'));
    try {
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ scripts: { test: 'vitest run' } })
      );
      expect(smokeSelection(join(root, 'tests', 'frame-pixels-smoke.test.ts'))).toMatchObject({
        packageDir: root,
        filters: [],
        selected: false,
      });
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
