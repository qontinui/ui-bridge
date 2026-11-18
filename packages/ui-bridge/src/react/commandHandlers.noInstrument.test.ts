/**
 * A relay read whose instrument is not running answers a typed UNKNOWN —
 * plan 2026-11-08-ui-bridge-relay-client-drops-refused-results-and-heartbeats-silently,
 * Phase 8 (D3 h2).
 *
 * `getConsoleErrors` with no `browserCapture` in the realm used to answer
 * `{ errors: [] }` (or empty groups): "no errors" from an instrument that never
 * ran. The idle family with no idle detector — or with one lacking the method
 * the action needs — answered `{ idle: true }`: "settled" that was never
 * measured, which a waiter then acted on. Each such arm now answers the
 * failure envelope callers already branch on (`success: false` +
 * `failureDetails.errorCode`).
 *
 * The idle detector comes from `CompositeIdleDetector.create` in `../idle`,
 * which `getIdleDetector` imports lazily; it is stubbed here so a test can
 * make it fail (the `catch → null` arm), return a detector lacking a method,
 * or return a present detector (the controls).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { executeCommand, __resetRelayForTest, type BridgeAccess } from './commandHandlers';
import { BrowserEventCapture } from '../debug/browser-capture';

const idle = vi.hoisted(() => ({
  create: null as null | (() => unknown),
}));

vi.mock('../idle', async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    CompositeIdleDetector: {
      create: () => {
        if (!idle.create) throw new Error('idle detector unavailable (test)');
        return idle.create();
      },
    },
  };
});

const emptyBridge: BridgeAccess = {
  elements: [],
  getElement: () => undefined,
  components: [],
  workflows: [],
};

type Failure = {
  success: false;
  error: string;
  failureDetails: { errorCode: string; message: string; timestamp: number };
};

function setRealm(root: Record<string, unknown>): void {
  (globalThis as unknown as { __UI_BRIDGE__?: unknown }).__UI_BRIDGE__ = root;
}

function expectUnavailable(result: unknown, errorCode: string): void {
  const r = result as Failure;
  expect(r.success).toBe(false);
  expect(r.failureDetails.errorCode).toBe(errorCode);
  expect(typeof r.error).toBe('string');
  expect(r.error.length).toBeGreaterThan(0);
  // The code leads the message: a relayed failure reaches the server as its message alone.
  expect(r.error.startsWith(`${errorCode}: `)).toBe(true);
  expect(r.failureDetails.message).toBe(r.error);
  expect(typeof r.failureDetails.timestamp).toBe('number');
  // The default it replaced must not ride along beside the failure.
  expect(r).not.toHaveProperty('idle');
  expect(r).not.toHaveProperty('errors');
  expect(r).not.toHaveProperty('groups');
}

/** A detector that answers every method with a marker the controls assert on. */
function presentDetector() {
  return {
    getStatus: () => ({ idle: false, signals: { network: false }, marker: 'getStatus' }),
    getSignalStatus: (signal: string) => ({ idle: false, signal, marker: 'getSignalStatus' }),
    waitForIdle: async () => ({ idle: false, marker: 'waitForIdle' }),
    waitForSignal: async (signal: string) => ({ idle: false, signal, marker: 'waitForSignal' }),
    waitFor: async (targets: unknown[]) => ({ idle: false, targets, marker: 'waitFor' }),
    destroy: () => undefined,
  };
}

beforeEach(() => {
  __resetRelayForTest();
  idle.create = null;
  setRealm({});
});

afterEach(() => {
  __resetRelayForTest();
  idle.create = null;
  setRealm({});
});

describe('getConsoleErrors with no capture in the realm answers CAPTURE_UNAVAILABLE', () => {
  it('arm 1 — flat', async () => {
    expectUnavailable(
      await executeCommand('getConsoleErrors', {}, emptyBridge),
      'CAPTURE_UNAVAILABLE'
    );
  });

  it('arm 2 — grouped', async () => {
    expectUnavailable(
      await executeCommand('getConsoleErrors', { group: true }, emptyBridge),
      'CAPTURE_UNAVAILABLE'
    );
  });
});

describe('getConsoleErrors with a capture present (controls)', () => {
  let cap: BrowserEventCapture;
  const realError = console.error;

  beforeEach(() => {
    console.error = () => undefined;
    cap = new BrowserEventCapture();
    cap.install();
    setRealm({ browserCapture: cap });
  });

  afterEach(() => {
    cap.uninstall();
    console.error = realError;
  });

  it('flat — returns the captured error', async () => {
    console.error('control flat error');
    const r = (await executeCommand('getConsoleErrors', {}, emptyBridge)) as {
      errors: Array<{ message?: string }>;
    };
    expect(r.errors.some((e) => String(e.message).includes('control flat error'))).toBe(true);
  });

  it('grouped — returns the captured error as a group', async () => {
    console.error('control grouped error');
    const r = (await executeCommand('getConsoleErrors', { group: true }, emptyBridge)) as {
      groups: Array<{ message: string }>;
      totalErrors: number;
    };
    expect(r.totalErrors).toBeGreaterThan(0);
    expect(r.groups.some((g) => g.message.includes('control grouped error'))).toBe(true);
  });
});

describe('the idle family with no idle detector answers IDLE_DETECTOR_UNAVAILABLE', () => {
  it('arm 3 — getIdleStatus', async () => {
    expectUnavailable(
      await executeCommand('getIdleStatus', {}, emptyBridge),
      'IDLE_DETECTOR_UNAVAILABLE'
    );
  });

  it('arm 4 — getIdleSignalStatus', async () => {
    expectUnavailable(
      await executeCommand('getIdleSignalStatus', { signal: 'network' }, emptyBridge),
      'IDLE_DETECTOR_UNAVAILABLE'
    );
  });

  it('arm 5 — waitForIdle', async () => {
    expectUnavailable(
      await executeCommand('waitForIdle', {}, emptyBridge),
      'IDLE_DETECTOR_UNAVAILABLE'
    );
  });

  it('arm 6 — waitForSignalIdle', async () => {
    expectUnavailable(
      await executeCommand('waitForSignalIdle', { signal: 'network' }, emptyBridge),
      'IDLE_DETECTOR_UNAVAILABLE'
    );
  });

  it('arm 8 — waitForTargets', async () => {
    expectUnavailable(
      await executeCommand('waitForTargets', { targets: [] }, emptyBridge),
      'IDLE_DETECTOR_UNAVAILABLE'
    );
  });
});

describe('a detector lacking the method the action needs answers IDLE_DETECTOR_UNAVAILABLE', () => {
  beforeEach(() => {
    idle.create = () => {
      const d: Record<string, unknown> = presentDetector();
      delete d.waitForSignal;
      delete d.waitFor;
      return d;
    };
  });

  it('arm 7 — waitForSignalIdle without waitForSignal', async () => {
    expectUnavailable(
      await executeCommand('waitForSignalIdle', { signal: 'network' }, emptyBridge),
      'IDLE_DETECTOR_UNAVAILABLE'
    );
  });

  it('arm 9 — waitForTargets without waitFor', async () => {
    expectUnavailable(
      await executeCommand('waitForTargets', { targets: [] }, emptyBridge),
      'IDLE_DETECTOR_UNAVAILABLE'
    );
  });
});

describe('the idle family with a detector present passes its answer through (controls)', () => {
  beforeEach(() => {
    idle.create = presentDetector;
  });

  it.each([
    ['getIdleStatus', {}, 'getStatus'],
    ['getIdleSignalStatus', { signal: 'network' }, 'getSignalStatus'],
    ['waitForIdle', {}, 'waitForIdle'],
    ['waitForSignalIdle', { signal: 'network' }, 'waitForSignal'],
    ['waitForTargets', { targets: [] }, 'waitFor'],
  ])('%s', async (action, payload, marker) => {
    const r = (await executeCommand(action, payload, emptyBridge)) as { marker?: string };
    expect(r.marker).toBe(marker);
  });
});
