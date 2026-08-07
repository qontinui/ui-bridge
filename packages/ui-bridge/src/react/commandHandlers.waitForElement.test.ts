/**
 * Loop B iter 3 — browser-side wait-for-element / wait-for-route handlers.
 *
 * Locks in the fix for the 2026-04-24 `0b5b438` orphan: the server relay
 * (`relay-handlers.ts:1832-1842`) forwards `waitForElementRegistered`,
 * `waitForElementByCondition`, and `waitForRouteChange` to the browser
 * dispatcher, but the browser-side switch in `commandHandlers.ts` never
 * had cases for them — every paired web frontend was getting
 * `COMMAND_FAILED: "Unknown command action: …"`.
 *
 * The DOM-driven browser implementations mirror the server-side shape
 * (success payload vs `{reason: 'timeout', ...}` envelope) so cross-runtime
 * callers can keep one response-handling code path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeCommand, type BridgeAccess } from './commandHandlers';
import { getGlobalRegistry, resetGlobalRegistry } from '../core/registry';

/**
 * How far below the nominal timeout an elapsed-time assertion may land.
 *
 * The handlers arm `setTimeout(…, timeoutMs)` and then report
 * `Date.now() - started`. Those are two different clocks: `setTimeout`'s
 * guarantee is against libuv's cached loop time, and `Date.now()` truncates to
 * whole milliseconds, so the reported delta can come in a millisecond or two
 * UNDER the nominal timeout even though the timer waited correctly. Asserting
 * `>= timeoutMs` exactly is therefore racy — it flaked in CI on 2026-08-07
 * with `expected 149 to be greater than or equal to 150`, on a commit whose
 * only diff was tooling, and the same suite passed in the parallel workflow.
 *
 * What these assertions actually care about is that the handler WAITED rather
 * than returning immediately, so a couple of milliseconds of clock slop is
 * exactly the tolerance that belongs here.
 */
const TIMER_SLOP_MS = 5;

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

describe('executeCommand · waitForElementRegistered (browser-side)', () => {
  let container: HTMLDivElement;
  const originalPathname = window.location.pathname;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
    window.history.pushState(null, '', '/');
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
    window.history.pushState(null, '', originalPathname);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('resolves when a matching element appears in the registry', async () => {
    const registry = getGlobalRegistry();

    // Schedule the registration after the call begins; the handler must
    // poll until it appears.
    setTimeout(() => {
      const btn = document.createElement('button');
      btn.textContent = 'Save';
      container.appendChild(btn);
      registry.registerElement('save-btn', btn, {
        label: 'Save profile',
      });
    }, 80);

    const result = (await executeCommand(
      'waitForElementRegistered',
      { predicate: { id: 'save-btn' }, timeoutMs: 2000 },
      emptyBridge
    )) as {
      element?: { id: string };
      elapsedMs?: number;
      reason?: string;
    };

    expect(result.reason).toBeUndefined();
    expect(result.element).toBeDefined();
    expect(result.element?.id).toBe('save-btn');
    expect(typeof result.elapsedMs).toBe('number');
  });

  it('matches via label substring (case-insensitive)', async () => {
    const registry = getGlobalRegistry();
    const el = document.createElement('button');
    el.textContent = 'Submit Form';
    container.appendChild(el);
    registry.registerElement('btn-1', el, { label: 'Submit Form' });

    const result = (await executeCommand(
      'waitForElementRegistered',
      { predicate: { label: 'submit' }, timeoutMs: 500 },
      emptyBridge
    )) as { element?: { id: string }; reason?: string };

    expect(result.reason).toBeUndefined();
    expect(result.element?.id).toBe('btn-1');
  });

  it('returns timeout shape when predicate never matches', async () => {
    const result = (await executeCommand(
      'waitForElementRegistered',
      { predicate: { id: 'nonexistent' }, timeoutMs: 150 },
      emptyBridge
    )) as { reason?: string; elapsedMs?: number };

    expect(result.reason).toBe('timeout');
    expect(typeof result.elapsedMs).toBe('number');
    expect(result.elapsedMs!).toBeGreaterThanOrEqual(150 - TIMER_SLOP_MS);
  });

  it('falls back to document.querySelector when predicate.selector is given', async () => {
    setTimeout(() => {
      const div = document.createElement('div');
      div.setAttribute('data-third-party', 'widget-x');
      div.id = 'third-party';
      container.appendChild(div);
    }, 60);

    const result = (await executeCommand(
      'waitForElementRegistered',
      {
        predicate: { selector: '[data-third-party="widget-x"]' },
        timeoutMs: 1500,
      },
      emptyBridge
    )) as { element?: { id: string }; reason?: string };

    expect(result.reason).toBeUndefined();
    expect(result.element?.id).toBe('third-party');
  });
});

describe('executeCommand · waitForElementByCondition (browser-side)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    resetGlobalRegistry();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    resetGlobalRegistry();
    vi.restoreAllMocks();
  });

  it('resolves matched=true when the present condition is satisfied', async () => {
    const registry = getGlobalRegistry();
    const btn = document.createElement('button');
    btn.textContent = 'Pay now';
    container.appendChild(btn);
    registry.registerElement('pay-btn', btn, { label: 'Pay now' });

    const result = (await executeCommand(
      'waitForElementByCondition',
      {
        selector: { id: 'pay-btn' },
        condition: 'present',
        timeout_ms: 500,
      },
      emptyBridge
    )) as { matched: boolean; element?: { id: string }; waited_ms: number };

    expect(result.matched).toBe(true);
    expect(result.element?.id).toBe('pay-btn');
    expect(typeof result.waited_ms).toBe('number');
  });

  it('text-matches condition uses textContent fallback for unlabeled elements', async () => {
    const registry = getGlobalRegistry();
    const el = document.createElement('span');
    el.textContent = 'Order confirmed';
    container.appendChild(el);
    registry.registerElement('status', el, {});

    const result = (await executeCommand(
      'waitForElementByCondition',
      {
        selector: { id: 'status' },
        condition: 'text-matches',
        text_match: 'confirmed',
        timeout_ms: 500,
      },
      emptyBridge
    )) as { matched: boolean };

    expect(result.matched).toBe(true);
  });

  it('returns matched=false when no element satisfies the selector before timeout', async () => {
    const result = (await executeCommand(
      'waitForElementByCondition',
      {
        selector: { id: 'never-registered' },
        condition: 'present',
        timeout_ms: 150,
      },
      emptyBridge
    )) as { matched: boolean; waited_ms: number };

    expect(result.matched).toBe(false);
    expect(result.waited_ms).toBeGreaterThanOrEqual(150 - TIMER_SLOP_MS);
  });
});

describe('executeCommand · waitForRouteChange (browser-side)', () => {
  const originalPathname = window.location.pathname;

  beforeEach(() => {
    window.history.pushState(null, '', '/');
  });

  afterEach(() => {
    window.history.pushState(null, '', originalPathname);
    vi.restoreAllMocks();
  });

  it('resolves when window.history.pushState fires', async () => {
    const pending = executeCommand(
      'waitForRouteChange',
      { timeoutMs: 2000 },
      emptyBridge
    );

    setTimeout(() => {
      window.history.pushState(null, '', '/dashboard');
    }, 50);

    const result = (await pending) as {
      from?: string;
      to?: string;
      elapsedMs?: number;
      reason?: string;
    };

    expect(result.reason).toBeUndefined();
    expect(result.from).toBe('/');
    expect(result.to).toBe('/dashboard');
    expect(typeof result.elapsedMs).toBe('number');
  });

  it('honors toRoute exact match', async () => {
    const pending = executeCommand(
      'waitForRouteChange',
      { toRoute: '/settings', timeoutMs: 2000 },
      emptyBridge
    );

    setTimeout(() => {
      // First pushState goes somewhere else — must NOT resolve the wait.
      window.history.pushState(null, '', '/fleet');
    }, 30);
    setTimeout(() => {
      window.history.pushState(null, '', '/settings');
    }, 80);

    const result = (await pending) as {
      to?: string;
      reason?: string;
    };

    expect(result.reason).toBeUndefined();
    expect(result.to).toBe('/settings');
  });

  it('resolves on synthetic popstate (browser back/forward)', async () => {
    // Seed history so back navigation has a target.
    window.history.pushState(null, '', '/page-a');
    window.history.pushState(null, '', '/page-b');

    const pending = executeCommand(
      'waitForRouteChange',
      { timeoutMs: 2000 },
      emptyBridge
    );

    setTimeout(() => {
      // Simulate the user pressing back. jsdom doesn't fire popstate from
      // history.back(), so we drive the synthetic event the same way the
      // SDK's soft-navigate path does — pushState to a new url and
      // dispatch popstate explicitly.
      window.history.pushState(null, '', '/page-a');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, 50);

    const result = (await pending) as { to?: string; reason?: string };

    expect(result.reason).toBeUndefined();
    expect(result.to).toBe('/page-a');
  });

  it('returns timeout envelope when no matching route change occurs', async () => {
    const result = (await executeCommand(
      'waitForRouteChange',
      { toRoute: '/never-visited', timeoutMs: 150 },
      emptyBridge
    )) as { reason?: string; elapsedMs?: number; lastKnownRoute?: string };

    expect(result.reason).toBe('timeout');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(150 - TIMER_SLOP_MS);
  });

  it('rejects an invalid regex toRoute synchronously', async () => {
    const result = (await executeCommand(
      'waitForRouteChange',
      { toRoute: '[unclosed', matchMode: 'regex', timeoutMs: 500 },
      emptyBridge
    )) as { success?: boolean; error?: string; code?: string };

    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.error).toMatch(/Invalid regex/);
  });
});
