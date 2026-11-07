/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "http://localhost:3000/"}
 */

/**
 * Passive real-session capture mounted by useCommandRelay (plan
 * 2026-09-20-ui-bridge-represents-the-users-path-and-the-passage-of-time,
 * Phase 3).
 *
 * It is a built-in of the command relay — no flag — so every app that mounts
 * `CommandRelayListener` gets it by upgrading the package. These tests pin
 * the wiring: it relays under phone-home's appId and the relay's tabId to the
 * runner phone-home talks to, only while the runner's registration answer
 * says `journeyObserve.admitted === true`, never an agent's action, and it
 * stops with the relay (unmount, `enabled: false`, `disablePhoneHome`) or on a
 * 403.
 *
 * The registration answers model the runner's PENDING `journeyObserve`
 * admission field (see `admittedBody`); no runner emits it yet.
 *
 * Nothing about the human-event predicate is stubbed: the "human" here is a
 * TRUSTED event jsdom fires — the `change` of a checkbox clicked outside any
 * SDK action — and the agent is the SDK's own relayed click on that checkbox,
 * which makes the browser fire the very same trusted `change`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getGlobalRegistry } from '../core/registry';

const registry = getGlobalRegistry();
const context = { registry };

vi.mock('./useUIBridge', () => ({ useUIBridge: () => ({}) }));
vi.mock('./UIBridgeProvider', () => ({ useUIBridgeOptional: () => context }));
vi.mock('../relay/relay-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../relay/relay-client')>();
  return {
    ...actual,
    startRelayClient: () => ({ stop: () => {} }),
    resolveTabId: () => 'tab-7f3a',
  };
});

import { useCommandRelay } from './useCommandRelay';
import { executeCommand } from './commandHandlers';
import {
  __clearPassiveCaptureStatusForTest,
  getPassiveCaptureStatuses,
} from '../recording/passive-capture';

const REGISTER_URL = 'http://127.0.0.1:9876/ui-bridge/apps/register';
const OBSERVE_URL = 'http://127.0.0.1:9876/apps/localhost%3A3000/journey/observe';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function observeBodies(fetchMock: FetchMock): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([url]) => url === OBSERVE_URL)
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

/**
 * The runner's ApiResponse envelope around a registration answer, CARRYING the
 * `journeyObserve` admission field. These bodies model the PENDING runner
 * answer: no runner build emits `journeyObserve` yet (it is a qontinui-runner
 * follow-up stacked on qontinui-runner#2438). Against today's runner every
 * mount is the "no admission field" case below — `admission_unknown`.
 */
const admittedBody = (admitted: boolean) => ({
  success: true,
  data: { appId: 'localhost:3000', journeyObserve: { admitted } },
});

describe('useCommandRelay passive capture', () => {
  let fetchMock: FetchMock;
  let registerStatus: number;
  let registerBody: unknown;
  let observeStatus: number;
  let checkbox: HTMLInputElement;

  /** A human ticking the box: a trusted `change` outside any SDK action. */
  const humanToggle = async () => {
    checkbox.click();
    await vi.advanceTimersByTimeAsync(0);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    __clearPassiveCaptureStatusForTest();
    registerStatus = 200;
    registerBody = admittedBody(true);
    observeStatus = 202;
    fetchMock = vi.fn(async (url: string) =>
      url === REGISTER_URL
        ? jsonResponse(registerStatus, registerBody)
        : jsonResponse(observeStatus, observeStatus === 403 ? { code: 'CROSS_ORIGIN_REFUSED' } : {})
    );
    vi.stubGlobal('fetch', fetchMock);
    checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    Object.defineProperty(checkbox, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    document.body.append(checkbox);
    registry.registerElement('remember-me', checkbox, { type: 'checkbox' });
  });

  afterEach(() => {
    registry.clear();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("relays a human toggle under phone-home's appId and the relay's tabId", async () => {
    const { unmount } = renderHook(() => useCommandRelay({ version: '2.3.1' }));
    await vi.advanceTimersByTimeAsync(0); // the registration resolves

    await humanToggle();

    const bodies = observeBodies(fetchMock);
    expect(bodies).toEqual([
      {
        actionType: 'check',
        targetElementId: 'remember-me',
        tabId: 'tab-7f3a',
        sessionId: expect.stringMatching(/^passive-/),
        appVersion: '2.3.1',
      },
    ]);
    expect(getPassiveCaptureStatuses()).toMatchObject([
      { state: 'active', admission: 'admitted', relayed: 1 },
    ]);
    unmount();
  });

  it("does not relay the agent's relayed click — the browser's trusted change is the SDK's", async () => {
    const { unmount } = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(0);

    const r = (await executeCommand(
      'executeElementAction',
      { id: 'remember-me', request: { action: 'click' } },
      { elements: [], getElement: () => undefined, components: [], workflows: [] }
    )) as { success?: boolean };
    expect(r.success).toBe(true);
    expect(checkbox.checked).toBe(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(observeBodies(fetchMock)).toHaveLength(0);
    expect(getPassiveCaptureStatuses()[0].suppressedSdkActionEvents).toBeGreaterThanOrEqual(1);
    unmount();
  });

  it('relays nothing when the registration answer says not admitted', async () => {
    registerBody = admittedBody(false);
    const { unmount } = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(0);
    await humanToggle();

    expect(observeBodies(fetchMock)).toHaveLength(0);
    expect(getPassiveCaptureStatuses()).toMatchObject([
      { admission: 'not_admitted', skippedNotAdmitted: 1 },
    ]);
    unmount();
  });

  it('relays nothing when the registration answer has no admission field (an older runner)', async () => {
    registerBody = { success: true, data: { appId: 'localhost:3000' } };
    const { unmount } = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(0);
    await humanToggle();

    expect(observeBodies(fetchMock)).toHaveLength(0);
    expect(getPassiveCaptureStatuses()).toMatchObject([
      { admission: 'admission_unknown', skippedNotAdmitted: 1 },
    ]);
    unmount();
  });

  it('relays nothing while the runner has not accepted the registration', async () => {
    registerStatus = 409;
    registerBody = { success: false, code: 'UIB_REGISTRATION_HELD' };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { unmount } = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(0);
    await humanToggle();

    expect(observeBodies(fetchMock)).toHaveLength(0);
    expect(getPassiveCaptureStatuses()).toMatchObject([
      { admission: 'unregistered', skippedUnregistered: 1 },
    ]);
    unmount();
  });

  it('stops for the mount on a 403 from observe — no loop of refusals', async () => {
    observeStatus = 403;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { unmount } = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(0);
    await humanToggle();
    await humanToggle();
    await humanToggle();

    expect(observeBodies(fetchMock)).toHaveLength(1);
    expect(getPassiveCaptureStatuses()).toMatchObject([
      { state: 'disabled', lastRefusalStatus: 403, lastRefusalReason: 'CROSS_ORIGIN_REFUSED' },
    ]);
    unmount();
  });

  it('stops on unmount', async () => {
    const { unmount } = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(0);
    unmount();
    await humanToggle();

    expect(observeBodies(fetchMock)).toHaveLength(0);
    expect(getPassiveCaptureStatuses()).toEqual([]);
  });

  it('stops when the relay is disabled', async () => {
    const { rerender, unmount } = renderHook(
      ({ enabled }: { enabled: boolean }) => useCommandRelay({ enabled }),
      { initialProps: { enabled: true } }
    );
    await vi.advanceTimersByTimeAsync(0);
    rerender({ enabled: false });
    await humanToggle();

    expect(observeBodies(fetchMock)).toHaveLength(0);
    expect(getPassiveCaptureStatuses()).toEqual([]);
    unmount();
  });

  it('does not start where phone-home is disabled', async () => {
    const { unmount } = renderHook(() => useCommandRelay({ disablePhoneHome: true }));
    await vi.advanceTimersByTimeAsync(0);
    await humanToggle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getPassiveCaptureStatuses()).toEqual([]);
    unmount();
  });
});
