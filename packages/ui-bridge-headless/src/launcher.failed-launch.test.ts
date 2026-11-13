/**
 * A launch that fails closes the browser it launched, and rejects with the
 * error that failed it.
 *
 * Every step between `chromium.launch` and the returned handle can reject:
 * `browser.newContext`, both `context.addInitScript` sites (the sessionStorage
 * restore, then each caller init script), `context.newPage`, and the first
 * `page.goto`. Up to 0.7.0 any of them rejected out of `launchHeadlessTab`
 * with the browser still running and no handle returned, so the caller had
 * nothing to close: one Chromium leaked per failed first page load until the
 * process exited (coord finding 45a8ff13; plan
 * 2026-11-10-ui-bridge-relay-and-assert-batch-drop-fields-and-headless-leaks-chromium,
 * Phase 2). The launcher now owns that cleanup.
 *
 * The fake browser's `close()` settles on a LATER macrotask, never at once, and
 * each failure case reads whether it had settled at the moment the rejection
 * arrived. So a launcher that fired the close and rejected without awaiting it
 * fails here, not only one that never closes.
 *
 * These cases pin the contract against a fake Playwright. The sibling
 * `launcher.failed-navigation.smoke.test.ts` reads it off a real Chromium.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, type Mock } from 'vitest';

/** The post-launch steps the fake can make reject, in the order the launcher runs them. */
type FailingStep = 'newContext' | 'addInitScript#1' | 'addInitScript#2' | 'newPage' | 'goto';

/** The fake `Browser` the mocked `chromium.launch` returns. */
interface FakeBrowser {
  newContext: Mock;
  close: Mock;
  /** Whether the promise `close()` returned has settled, resolved or rejected. */
  closeSettled: boolean;
}

const fake = vi.hoisted(() => ({
  /** How many times `chromium.launch` ran. */
  launches: 0,
  /** The step that rejects on the next launch; `null` for a launch that succeeds. */
  failAt: null as FailingStep | null,
  /** What that step rejects with. */
  error: undefined as unknown,
  /** Whether `browser.close()` itself rejects as well. */
  closeRejects: false,
  /** Every fake browser `chromium.launch` returned, in launch order. */
  browsers: [] as FakeBrowser[],
  /** The arguments of every `context.addInitScript` call, in call order. */
  initScriptCalls: [] as unknown[][],
}));

vi.mock('playwright', () => {
  const rejectIfFailingAt = (step: FailingStep): void => {
    if (fake.failAt === step) throw fake.error;
  };
  return {
    chromium: {
      launch: vi.fn(async () => {
        fake.launches += 1;
        const page = {
          on: vi.fn(),
          goto: vi.fn(async () => {
            rejectIfFailingAt('goto');
            return null;
          }),
          url: vi.fn(() => 'http://app.local/'),
          mainFrame: vi.fn(() => ({})),
        };
        let initScriptCall = 0;
        const context = {
          addInitScript: vi.fn(async (...args: unknown[]) => {
            initScriptCall += 1;
            fake.initScriptCalls.push(args);
            rejectIfFailingAt(initScriptCall === 1 ? 'addInitScript#1' : 'addInitScript#2');
          }),
          newPage: vi.fn(async () => {
            rejectIfFailingAt('newPage');
            return page;
          }),
          close: vi.fn(async () => undefined),
        };
        const browser: FakeBrowser = {
          newContext: vi.fn(async () => {
            rejectIfFailingAt('newContext');
            return context;
          }),
          // Settles on a LATER macrotask: only a caller that awaits the close
          // sees it settled.
          close: vi.fn(
            () =>
              new Promise<void>((resolve, reject) => {
                setTimeout(() => {
                  browser.closeSettled = true;
                  if (fake.closeRejects) reject(new Error('fake browser.close rejected'));
                  else resolve();
                }, 0);
              })
          ),
          closeSettled: false,
        };
        fake.browsers.push(browser);
        return browser;
      }),
    },
  };
});

// vitest hoists vi.mock above these imports, so the launcher binds the fake.
import { launchHeadlessTab, type LaunchHeadlessTabOptions } from './launcher.js';
import { restoreSessionStorageInitScript } from './storage-state.js';

const INIT_SCRIPT = 'window.__failedLaunchProbe = true;';

let dir: string;
let seededStateFile: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ui-bridge-headless-failed-launch-'));
  // A storageState artifact carrying `__sessionStorage`, so the launch reaches
  // BOTH addInitScript sites: the sessionStorage restore first, then the
  // caller's init script.
  seededStateFile = join(dir, 'state.json');
  writeFileSync(
    seededStateFile,
    JSON.stringify({
      cookies: [],
      origins: [],
      __sessionStorage: { 'http://app.local': { auth_bearer_access_token: 'token' } },
    })
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  fake.launches = 0;
  fake.failAt = null;
  fake.error = undefined;
  fake.closeRejects = false;
  fake.browsers.length = 0;
  fake.initScriptCalls.length = 0;
});

/** Options that walk every post-launch step, both addInitScript sites included. */
function walkEveryStep(): LaunchHeadlessTabOptions {
  return {
    url: 'http://app.local/',
    headless: true,
    forwardConsole: false,
    storageStatePath: seededStateFile,
    initScripts: [INIT_SCRIPT],
  };
}

/** Every line a `process.stderr.write` spy received. */
function writtenLines(spy: { mock: { calls: unknown } }): string[] {
  return (spy.mock.calls as unknown[][]).map((call) => String(call[0]));
}

/**
 * Make `step` reject, launch, and assert the contract: the launch rejects with
 * THAT error object (identity, not just its message), exactly one browser was
 * launched, and that browser was closed exactly once, with the close already
 * SETTLED when the rejection arrived.
 */
async function expectFailedLaunchClosesItsBrowser(step: FailingStep): Promise<void> {
  const original = new Error(`fake ${step} rejected`);
  fake.failAt = step;
  fake.error = original;

  // Read the close's state AT THE MOMENT the rejection arrives. A launcher that
  // fired browser.close() and rejected without awaiting it gets here while the
  // close is still pending.
  let closeSettledWhenRejected: boolean | undefined;
  const launch = launchHeadlessTab(walkEveryStep()).catch((error: unknown) => {
    closeSettledWhenRejected = fake.browsers[0]?.closeSettled;
    throw error;
  });

  await expect(launch).rejects.toBe(original);
  expect(fake.launches).toBe(1);
  expect(fake.browsers).toHaveLength(1);
  expect(fake.browsers[0]!.close).toHaveBeenCalledTimes(1);
  expect(closeSettledWhenRejected).toBe(true);
}

/** The error `launch` rejects with; a launch that resolves fails the test, saying so. */
async function rejectionOf(launch: Promise<unknown>): Promise<unknown> {
  return launch.then(
    () => {
      throw new Error('expected the launch to reject, and it resolved');
    },
    (error: unknown) => error
  );
}

describe('launchHeadlessTab — a step after the launch rejects: the browser is closed and the original error surfaces', () => {
  it('page.goto rejects (the first navigation fails)', async () => {
    await expectFailedLaunchClosesItsBrowser('goto');
  });

  it('context.newPage rejects', async () => {
    await expectFailedLaunchClosesItsBrowser('newPage');
  });

  it('browser.newContext rejects', async () => {
    await expectFailedLaunchClosesItsBrowser('newContext');
  });

  it('the first context.addInitScript call (the sessionStorage restore) rejects', async () => {
    await expectFailedLaunchClosesItsBrowser('addInitScript#1');
    expect(fake.initScriptCalls).toHaveLength(1);
    expect(fake.initScriptCalls[0]![0]).toBe(restoreSessionStorageInitScript);
  });

  it('the second context.addInitScript call (a caller init script) rejects', async () => {
    await expectFailedLaunchClosesItsBrowser('addInitScript#2');
    expect(fake.initScriptCalls).toHaveLength(2);
    expect(fake.initScriptCalls[1]![0]).toEqual({ content: INIT_SCRIPT });
  });

  it('browser.close rejects as well: the original error still surfaces, and the close failure is reported on stderr', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      fake.closeRejects = true;
      await expectFailedLaunchClosesItsBrowser('goto');
      expect(
        writtenLines(stderr).some((line) => line.includes('fake browser.close rejected'))
      ).toBe(true);
    } finally {
      stderr.mockRestore();
    }
  });
});

describe('launchHeadlessTab — a launch that succeeds, and its close()', () => {
  it('leaves the browser open; close() closes it once, and a second close() is a no-op', async () => {
    const tab = await launchHeadlessTab(walkEveryStep());
    const browser = fake.browsers[0]!;
    expect(browser.close).not.toHaveBeenCalled();

    await tab.close();
    expect(browser.closeSettled).toBe(true);
    await tab.close();
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('close() whose browser.close fails resolves, reports the failure on stderr, and stays idempotent', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const tab = await launchHeadlessTab(walkEveryStep());
      fake.closeRejects = true;

      await expect(tab.close()).resolves.toBeUndefined();
      await expect(tab.close()).resolves.toBeUndefined();

      expect(fake.browsers[0]!.close).toHaveBeenCalledTimes(1);
      expect(
        writtenLines(stderr).some((line) => line.includes('fake browser.close rejected'))
      ).toBe(true);
    } finally {
      stderr.mockRestore();
    }
  });
});

describe('launchHeadlessTab — a storageState file that cannot be used is refused BEFORE any browser launches', () => {
  it('an unreadable file (no such path) rejects with the read error and launches nothing', async () => {
    await expect(
      launchHeadlessTab({
        url: 'http://app.local/',
        headless: true,
        storageStatePath: join(dir, 'does-not-exist.json'),
      })
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fake.launches).toBe(0);
  });

  it('a file that is not valid JSON rejects with the parse error and launches nothing', async () => {
    const invalid = join(dir, 'invalid.json');
    writeFileSync(invalid, '{ "cookies": [');
    await expect(
      launchHeadlessTab({ url: 'http://app.local/', headless: true, storageStatePath: invalid })
    ).rejects.toBeInstanceOf(SyntaxError);
    expect(fake.launches).toBe(0);
  });

  it.each([
    {
      holds: 'null',
      file: 'shape-null.json',
      content: 'null',
      reason: /must hold a JSON object, got null/,
    },
    {
      holds: 'an array',
      file: 'shape-array.json',
      content: '[]',
      reason: /must hold a JSON object, got an array/,
    },
    {
      holds: '"cookies" that is not an array',
      file: 'shape-cookies.json',
      content: '{"cookies":"not-an-array","origins":[]}',
      reason: /"cookies" must be an array when present, got a string/,
    },
    {
      holds: '"origins" that is not an array',
      file: 'shape-origins.json',
      content: '{"cookies":[],"origins":{}}',
      reason: /"origins" must be an array when present, got an object/,
    },
  ])(
    'a file holding $holds rejects with an error naming the file, and launches nothing',
    async ({ file, content, reason }) => {
      const path = join(dir, file);
      writeFileSync(path, content);

      const error = await rejectionOf(
        launchHeadlessTab({ url: 'http://app.local/', headless: true, storageStatePath: path })
      );

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(path);
      expect((error as Error).message).toMatch(reason);
      expect(fake.launches).toBe(0);
    }
  );
});
