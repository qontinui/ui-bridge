/**
 * A tab that says it cannot measure is answered as a failure over the relay —
 * plan 2026-11-08-ui-bridge-relay-client-drops-refused-results-and-heartbeats-silently,
 * Phase 8 (D3), review fix M1.
 *
 * In the page, `getConsoleErrors` with no console capture answers
 * `{ success:false, error:'CAPTURE_UNAVAILABLE: …', failureDetails:{errorCode} }`
 * and the idle family answers the same with `IDLE_DETECTOR_UNAVAILABLE`. The
 * relay client posts that as a failed result, and the result route calls
 * `rejectCommand(commandId, result.error)` — only the message survives, which
 * is why the code leads it. The relay's `getConsoleErrors` used to treat every
 * rejection as a transport fault and answer its cache or `errors: []`,
 * re-creating the "no errors" default for the relayed population. A positive
 * "cannot measure" from the tab is never answered from the cache; a transport
 * fault keeps its old cache / empty fallback.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { CommandRelay } from './command-relay';
import { createRelayHandlers } from './relay-handlers';

const CAPTURE_MSG =
  'CAPTURE_UNAVAILABLE: No console capture is installed in this page, so its console errors are UNKNOWN (not zero)';
const IDLE_MSG =
  'IDLE_DETECTOR_UNAVAILABLE: No idle detector is available in this page, so whether it is idle is UNKNOWN (not idle)';

const relays: CommandRelay[] = [];

function freshRelay(): CommandRelay {
  const prefix = `__uiBridgeTest_${Math.random().toString(36).slice(2, 10)}`;
  const relay = new CommandRelay({ globalPrefix: prefix, sseTimeoutMs: 200 });
  relays.push(relay);
  return relay;
}

// Every relay a test built is torn down, so no subscription or timer outlives it.
afterEach(() => {
  for (const relay of relays.splice(0)) relay.destroy();
});

type TabAnswer = { ok: true; result: unknown } | { ok: false; error: string } | { silent: true };

/**
 * A tab whose Nth answer is `answers[N]`: `ok:true` resolves, `ok:false`
 * rejects with the message exactly as the result route does
 * (`rejectCommand(commandId, result.error)`), `silent` never answers.
 */
function registerScriptedTab(relay: CommandRelay, tabId: string, answers: TabAnswer[]): void {
  let n = 0;
  relay.subscribeToCommands((cmd) => {
    const answer = answers[Math.min(n++, answers.length - 1)];
    setTimeout(() => {
      if ('silent' in answer) return;
      if (answer.ok) relay.resolveCommand(cmd.commandId, answer.result, tabId);
      else relay.rejectCommand(cmd.commandId, answer.error, tabId);
    }, 0);
  }, tabId);
}

function inPageFailure(errorCode: string, message: string) {
  return {
    success: false,
    error: message,
    failureDetails: { errorCode, message, timestamp: Date.now() },
    timestamp: Date.now(),
  };
}

const CACHED = { errors: [{ message: 'an old error', timestamp: 1 }], count: 1 };

function expectCaptureUnavailable(r: unknown): void {
  const res = r as { success: boolean; code?: string; error?: string; data?: unknown };
  expect(res.success).toBe(false);
  expect(res.code).toBe('CAPTURE_UNAVAILABLE');
  expect(res.error).toContain('CAPTURE_UNAVAILABLE');
  expect((res.data as { errors?: unknown } | undefined)?.errors).toBeUndefined();
}

describe('relayed getConsoleErrors · the tab answers CAPTURE_UNAVAILABLE', () => {
  it('flat, no prior cache → a CAPTURE_UNAVAILABLE failure, not errors: []', async () => {
    const relay = freshRelay();
    registerScriptedTab(relay, 'tab-a', [{ ok: false, error: CAPTURE_MSG }]);
    expectCaptureUnavailable(await createRelayHandlers(relay).getConsoleErrors!({}));
  });

  it('flat, with a prior cache → a CAPTURE_UNAVAILABLE failure, never the cache', async () => {
    const relay = freshRelay();
    registerScriptedTab(relay, 'tab-a', [
      { ok: true, result: CACHED },
      { ok: false, error: CAPTURE_MSG },
    ]);
    const handlers = createRelayHandlers(relay);
    const first = (await handlers.getConsoleErrors!({})) as { success: boolean };
    expect(first.success).toBe(true);
    expectCaptureUnavailable(await handlers.getConsoleErrors!({}));
  });

  it('grouped, no prior cache → a CAPTURE_UNAVAILABLE failure, not empty groups', async () => {
    const relay = freshRelay();
    registerScriptedTab(relay, 'tab-a', [{ ok: false, error: CAPTURE_MSG }]);
    expectCaptureUnavailable(await createRelayHandlers(relay).getConsoleErrors!({ group: true }));
  });

  it('grouped, with a prior (flat) cache → a CAPTURE_UNAVAILABLE failure', async () => {
    const relay = freshRelay();
    registerScriptedTab(relay, 'tab-a', [
      { ok: true, result: CACHED },
      { ok: false, error: CAPTURE_MSG },
    ]);
    const handlers = createRelayHandlers(relay);
    await handlers.getConsoleErrors!({});
    expectCaptureUnavailable(await handlers.getConsoleErrors!({ group: true }));
  });

  it('a tab that RESOLVES with the in-page failure is an outer failure too', async () => {
    const relay = freshRelay();
    registerScriptedTab(relay, 'tab-a', [
      { ok: true, result: inPageFailure('CAPTURE_UNAVAILABLE', CAPTURE_MSG) },
    ]);
    const r = (await createRelayHandlers(relay).getConsoleErrors!({})) as {
      success: boolean;
      code?: string;
    };
    expect(r.success).toBe(false);
    expect(r.code).toBe('CAPTURE_UNAVAILABLE');
  });
});

describe('relayed getConsoleErrors · a transport fault keeps its fallback (controls)', () => {
  it('a timeout with a prior cache answers the cache', async () => {
    const relay = freshRelay();
    registerScriptedTab(relay, 'tab-a', [{ ok: true, result: CACHED }, { silent: true }]);
    const handlers = createRelayHandlers(relay);
    await handlers.getConsoleErrors!({});
    const r = (await handlers.getConsoleErrors!({})) as {
      success: boolean;
      data: typeof CACHED;
    };
    expect(r.success).toBe(true);
    expect(r.data.errors[0].message).toBe('an old error');
  });

  it('a timeout with no cache answers errors: [] (flat) and empty groups (grouped)', async () => {
    const relay = freshRelay();
    registerScriptedTab(relay, 'tab-a', [{ silent: true }]);
    const handlers = createRelayHandlers(relay);
    const flat = (await handlers.getConsoleErrors!({})) as {
      success: boolean;
      data: { errors: unknown[] };
    };
    expect(flat.success).toBe(true);
    expect(flat.data.errors).toEqual([]);
    const grouped = (await handlers.getConsoleErrors!({ group: true })) as {
      success: boolean;
      data: { groups: unknown[] };
    };
    expect(grouped.success).toBe(true);
    expect(grouped.data.groups).toEqual([]);
  });

  it('a rejection whose message does not lead with the code keeps the cache', async () => {
    const relay = freshRelay();
    registerScriptedTab(relay, 'tab-a', [
      { ok: true, result: CACHED },
      { ok: false, error: `page threw while reading CAPTURE_UNAVAILABLE: no` },
    ]);
    const handlers = createRelayHandlers(relay);
    await handlers.getConsoleErrors!({});
    const r = (await handlers.getConsoleErrors!({})) as { success: boolean };
    expect(r.success).toBe(true);
  });
});

describe('relayed idle reads · the tab answers IDLE_DETECTOR_UNAVAILABLE', () => {
  it.each([
    ['getIdleStatus', (h: ReturnType<typeof createRelayHandlers>) => h.getIdleStatus!()],
    [
      'getIdleSignalStatus',
      (h: ReturnType<typeof createRelayHandlers>) => h.getIdleSignalStatus!('network'),
    ],
    ['waitForIdle', (h: ReturnType<typeof createRelayHandlers>) => h.waitForIdle!({})],
    [
      'waitForSignalIdle',
      (h: ReturnType<typeof createRelayHandlers>) => h.waitForSignalIdle!('network', {}),
    ],
    [
      'waitForTargets',
      (h: ReturnType<typeof createRelayHandlers>) => h.waitForTargets!({ targets: [] } as never),
    ],
  ])(
    '%s (rejected) → failure carrying IDLE_DETECTOR_UNAVAILABLE and the message',
    async (_n, call) => {
      const relay = freshRelay();
      registerScriptedTab(relay, 'tab-a', [{ ok: false, error: IDLE_MSG }]);
      const r = (await call(createRelayHandlers(relay))) as {
        success: boolean;
        code?: string;
        error?: string;
      };
      expect(r.success).toBe(false);
      expect(r.code).toBe('IDLE_DETECTOR_UNAVAILABLE');
      expect(r.error).toContain(IDLE_MSG);
    }
  );

  it('getIdleStatus (resolved with the in-page failure) → IDLE_DETECTOR_UNAVAILABLE', async () => {
    const relay = freshRelay();
    registerScriptedTab(relay, 'tab-a', [
      { ok: true, result: inPageFailure('IDLE_DETECTOR_UNAVAILABLE', IDLE_MSG) },
    ]);
    const r = (await createRelayHandlers(relay).getIdleStatus!()) as {
      success: boolean;
      code?: string;
    };
    expect(r.success).toBe(false);
    expect(r.code).toBe('IDLE_DETECTOR_UNAVAILABLE');
  });
});
