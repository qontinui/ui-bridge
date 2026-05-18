/**
 * Phase 4.1 (plan 2026-05-03) — POST /control/sdk/spawn-headless tests.
 *
 * Verifies the gate flag, validation, dynamic-import error handling,
 * happy-path response shape, and shutdown cleanup. The actual
 * `@qontinui/ui-bridge-headless` package is mocked end-to-end so these
 * tests never launch a real Chromium browser.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createHandlers,
  closeAllSpawnedHeadlessTabs,
  type RegistryLike,
} from './handlers';
import { resetGlobalRegistry, getGlobalRegistry } from '../core/registry';

// Hoisted mock state: tests can mutate `mockState` before invoking the
// handler to choose between "import fails", "launch succeeds", etc.
const mockState = vi.hoisted(() => {
  return {
    importShouldThrow: false,
    importErrorMessage: 'Cannot find module @qontinui/ui-bridge-headless',
    launchShouldThrow: false,
    launchError: new Error('chromium failed to start'),
    lastLaunchOptions: null as unknown,
    closeCalls: 0,
  };
});

vi.mock('@qontinui/ui-bridge-headless', () => {
  return {
    launchHeadlessTab: vi.fn(async (opts: Record<string, unknown>) => {
      if (mockState.importShouldThrow) {
        // Simulate an import-time failure by throwing eagerly. (The
        // actual handler dynamic-imports the module, so a runtime error
        // when the bound function is invoked surfaces the same way.)
        throw new Error(mockState.importErrorMessage);
      }
      if (mockState.launchShouldThrow) {
        throw mockState.launchError;
      }
      mockState.lastLaunchOptions = opts;
      const close = async () => {
        mockState.closeCalls += 1;
      };
      return {
        page: {} as unknown,
        context: {} as unknown,
        browser: {} as unknown,
        navigate: async () => {},
        close,
        finalUrl: 'http://example.com/',
        uiBridgeRegistered: true,
        tabId: 'tab-abc',
      };
    }),
  };
});

function makeRegistryLike(): RegistryLike {
  const reg = getGlobalRegistry();
  return {
    getAllElements: () => reg.getAllElements(),
    getElement: (id) => reg.getElement(id),
    getAllComponents: () => reg.getAllComponents(),
    getComponent: (id) => reg.getComponent(id),
    getComponentState: (id) => reg.getComponentState?.(id) ?? null,
    createSnapshot: () => reg.createSnapshot() as ReturnType<RegistryLike['createSnapshot']>,
  };
}

function makeActionExecutor() {
  return {
    executeAction: async () => ({ success: true }),
    executeComponentAction: async () => ({ success: true }),
  };
}

describe('spawnHeadless (Phase 4.1)', () => {
  const originalEnv = process.env.ENABLE_HEADLESS_SPAWN;

  beforeEach(() => {
    resetGlobalRegistry();
    delete process.env.ENABLE_HEADLESS_SPAWN;
    mockState.importShouldThrow = false;
    mockState.launchShouldThrow = false;
    mockState.closeCalls = 0;
    mockState.lastLaunchOptions = null;
  });

  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.ENABLE_HEADLESS_SPAWN;
    else process.env.ENABLE_HEADLESS_SPAWN = originalEnv;
    // Make sure no test leaks tracked tabs into the next one.
    await closeAllSpawnedHeadlessTabs();
    resetGlobalRegistry();
  });

  it('returns 503 when disabled by default', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never);
    const resp = await handlers.spawnHeadless({ url: 'http://localhost:3000/' });
    expect(resp.success).toBe(false);
    expect(resp.httpStatus).toBe(503);
    // Phase 1 (diagnostic discipline): APIResponse.code is now a canonical
    // UiBridgeErrorCode. 'HEADLESS_SPAWN_DISABLED' → UB-ACTION-REJECTED.
    // The prose `error` keeps the human-readable detail (goal #3).
    expect(resp.code).toBe('UB-ACTION-REJECTED');
    expect(resp.error).toContain('not enabled');
  });

  it('honors ENABLE_HEADLESS_SPAWN=1 env var', async () => {
    process.env.ENABLE_HEADLESS_SPAWN = '1';
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never);
    const resp = await handlers.spawnHeadless({ url: 'http://localhost:3000/' });
    expect(resp.code).not.toBe('HEADLESS_SPAWN_DISABLED');
    expect(resp.httpStatus).not.toBe(503);
  });

  it('honors enableHeadlessSpawn config option', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never, {
      enableHeadlessSpawn: true,
    });
    const resp = await handlers.spawnHeadless({ url: 'http://localhost:3000/' });
    expect(resp.code).not.toBe('HEADLESS_SPAWN_DISABLED');
  });

  it('returns 400 when url is missing', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never, {
      enableHeadlessSpawn: true,
    });
    const resp = await handlers.spawnHeadless({} as never);
    expect(resp.success).toBe(false);
    expect(resp.httpStatus).toBe(400);
    // Phase 1: canonical APIResponse.code. 'VALIDATION_ERROR' → UB-VALIDATION-ERROR.
    expect(resp.code).toBe('UB-VALIDATION-ERROR');
    expect(resp.error).toContain('url is required');
  });

  it('returns 400 when url has bad scheme', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never, {
      enableHeadlessSpawn: true,
    });
    const resp = await handlers.spawnHeadless({ url: 'ftp://example.com/' });
    expect(resp.success).toBe(false);
    expect(resp.httpStatus).toBe(400);
    // Phase 1: canonical APIResponse.code. 'VALIDATION_ERROR' → UB-VALIDATION-ERROR.
    expect(resp.code).toBe('UB-VALIDATION-ERROR');
    expect(resp.error).toContain('http://');
  });

  it('surfaces a 500 HEADLESS_LAUNCH_FAILED when launchHeadlessTab itself rejects', async () => {
    // We can't easily trigger HEADLESS_PEER_MISSING (the actual import-fail
    // path) without re-mocking the module, which leaks state between
    // tests in this file. Instead, exercise the equivalent runtime-failure
    // path: launchHeadlessTab throws after a successful import. The
    // import-fail path itself is covered by the dedicated test below.
    mockState.launchShouldThrow = true;
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never, {
      enableHeadlessSpawn: true,
    });
    const resp = await handlers.spawnHeadless({ url: 'http://localhost:3000/' });
    expect(resp.success).toBe(false);
    // Phase 1: canonical APIResponse.code. 'HEADLESS_LAUNCH_FAILED' → UB-ACTION-FAILED.
    expect(resp.code).toBe('UB-ACTION-FAILED');
    expect(resp.httpStatus).toBe(500);
    expect(resp.error).toContain('chromium failed to start');
  });

  it('returns 200 with the documented shape on a successful launch', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never, {
      enableHeadlessSpawn: true,
    });
    const resp = await handlers.spawnHeadless({
      url: 'http://localhost:3000/dashboard',
      timeoutMs: 5000,
      keepAliveSecs: 60,
      headless: true,
      viewport: { width: 1024, height: 768 },
    });
    expect(resp.success).toBe(true);
    expect(resp.httpStatus).toBeUndefined();
    expect(resp.data).toEqual({
      spawned: true,
      tabId: 'tab-abc',
      uiBridgeRegistered: true,
      finalUrl: 'http://example.com/',
    });
    // Confirm the projected options reached launchHeadlessTab.
    const opts = mockState.lastLaunchOptions as Record<string, unknown> | null;
    expect(opts).not.toBeNull();
    expect(opts).toMatchObject({
      url: 'http://localhost:3000/dashboard',
      headless: true,
      waitForUiBridgeMs: 5000,
      viewportWidth: 1024,
      viewportHeight: 768,
    });
  });

  it('clamps timeoutMs to the 60_000 ceiling', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never, {
      enableHeadlessSpawn: true,
    });
    await handlers.spawnHeadless({
      url: 'http://localhost:3000/',
      timeoutMs: 999_999,
    });
    const opts = mockState.lastLaunchOptions as Record<string, unknown> | null;
    expect(opts).not.toBeNull();
    expect(opts!.waitForUiBridgeMs).toBe(60_000);
  });

  it('closeAllSpawnedHeadlessTabs() awaits close() on every tracked tab', async () => {
    const handlers = createHandlers(makeRegistryLike(), makeActionExecutor() as never, {
      enableHeadlessSpawn: true,
    });
    // Disable the keep-alive auto-close so it doesn't race the assertion.
    const r1 = await handlers.spawnHeadless({
      url: 'http://localhost/1',
      keepAliveSecs: 0,
    });
    const r2 = await handlers.spawnHeadless({
      url: 'http://localhost/2',
      keepAliveSecs: 0,
    });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    const before = mockState.closeCalls;
    await closeAllSpawnedHeadlessTabs();
    expect(mockState.closeCalls).toBe(before + 2);
  });
});

// ---------------------------------------------------------------------------
// Phase 4.1 — separate suite for the import-failure path. Kept isolated so
// the `vi.resetModules` + replacement mock-factory don't leak into the main
// suite's happy-path tests (which depend on the module-level vi.mock binding
// remaining intact).
// ---------------------------------------------------------------------------

describe('spawnHeadless (Phase 4.1) — import failure', () => {
  beforeEach(() => {
    resetGlobalRegistry();
  });

  afterEach(async () => {
    await closeAllSpawnedHeadlessTabs();
    resetGlobalRegistry();
  });

  it('returns 503 HEADLESS_PEER_MISSING when the optional peer fails to import', async () => {
    vi.resetModules();
    vi.doMock('@qontinui/ui-bridge-headless', () => {
      throw new Error('Cannot find module @qontinui/ui-bridge-headless');
    });
    try {
      const isolated = await import('./handlers');
      const handlers = isolated.createHandlers(
        makeRegistryLike(),
        makeActionExecutor() as never,
        { enableHeadlessSpawn: true }
      );
      const resp = await handlers.spawnHeadless({ url: 'http://localhost:3000/' });
      expect(resp.success).toBe(false);
      expect(resp.httpStatus).toBe(503);
      // Phase 1: canonical APIResponse.code. 'HEADLESS_PEER_MISSING' → UB-UNSUPPORTED-ACTION.
      expect(resp.code).toBe('UB-UNSUPPORTED-ACTION');
      expect(resp.error).toContain('@qontinui/ui-bridge-headless');
    } finally {
      vi.doUnmock('@qontinui/ui-bridge-headless');
      vi.resetModules();
    }
  });
});
