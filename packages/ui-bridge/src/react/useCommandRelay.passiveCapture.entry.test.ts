/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "http://localhost:3000/"}
 */

/**
 * Passive capture observed where an embedding app enters it: through
 * `useCommandRelay`, which `CommandRelayListener` mounts. Nothing from the
 * capture module is imported here, so the assertion reads only what reaches
 * the runner's wire.
 *
 * With the capture in place, a human's trusted toggle of a registered checkbox
 * is POSTed to the runner's observe route in the runner's closed body shape.
 * Without it, as in an SDK that predates passive capture, the same toggle sends
 * nothing and this test is RED.
 *
 * The registration answer carries the runner's admission field,
 * `journeyObserve.admitted: true`, inside its ApiResponse envelope.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
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
    resolveTabId: () => 'tab-entry',
  };
});

import { useCommandRelay } from './useCommandRelay';

const REGISTER_URL = 'http://127.0.0.1:9876/ui-bridge/apps/register';
const OBSERVE_URL = 'http://127.0.0.1:9876/apps/localhost%3A3000/journey/observe';

describe('passive capture, entered through useCommandRelay', () => {
  afterEach(() => {
    registry.clear();
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a human's trusted toggle reaches the runner's observe route in its closed body shape", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => {
      const registering = url === REGISTER_URL;
      const body = registering
        ? { success: true, data: { appId: 'localhost:3000', journeyObserve: { admitted: true } } }
        : {};
      return new Response(JSON.stringify(body), {
        status: registering ? 200 : 202,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    Object.defineProperty(checkbox, 'offsetParent', {
      configurable: true,
      get: () => document.body,
    });
    document.body.append(checkbox);
    registry.registerElement('accept-terms', checkbox, { type: 'checkbox' });

    const { unmount } = renderHook(() => useCommandRelay({ version: '4.5.6' }));
    await vi.advanceTimersByTimeAsync(0); // the registration answer arrives

    // jsdom fires the box's `change` as a TRUSTED event, outside any SDK action:
    // the shape a human's click takes.
    checkbox.click();
    await vi.advanceTimersByTimeAsync(0);

    const observed = fetchMock.mock.calls
      .filter(([url]) => url === OBSERVE_URL)
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
    expect(observed).toEqual([
      {
        actionType: 'check',
        targetElementId: 'accept-terms',
        tabId: 'tab-entry',
        sessionId: expect.stringMatching(/^passive-/),
        appVersion: '4.5.6',
      },
    ]);
    unmount();
  });
});
