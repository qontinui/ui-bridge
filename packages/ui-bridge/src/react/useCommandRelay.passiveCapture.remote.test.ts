/**
 * @vitest-environment jsdom
 * @vitest-environment-options {"url": "https://app.example.com/"}
 */

/**
 * Passive capture rides phone-home's gate: a page on neither a localhost
 * host nor an explicit `runnerUrl` never starts it (a deployed app must not
 * relay its users' interactions to a loopback runner). The explicit-runnerUrl
 * case is the positive control. The registration answer models the runner's
 * PENDING `journeyObserve` admission field (no runner emits it yet).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getGlobalRegistry } from '../core/registry';

const context = { registry: getGlobalRegistry() };

vi.mock('./useUIBridge', () => ({ useUIBridge: () => ({}) }));
vi.mock('./UIBridgeProvider', () => ({ useUIBridgeOptional: () => context }));
vi.mock('../relay/relay-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../relay/relay-client')>();
  return { ...actual, startRelayClient: () => ({ stop: () => {} }) };
});

import { useCommandRelay } from './useCommandRelay';
import {
  __clearPassiveCaptureStatusForTest,
  getPassiveCaptureStatuses,
} from '../recording/passive-capture';

describe('passive capture on a non-localhost page', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    __clearPassiveCaptureStatusForTest();
    fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ success: true, data: { journeyObserve: { admitted: true } } }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders at https://app.example.com', () => {
    expect(window.location.hostname).toBe('app.example.com');
  });

  it('never starts without an explicit runnerUrl', async () => {
    const { unmount } = renderHook(() => useCommandRelay());
    await vi.advanceTimersByTimeAsync(0);
    expect(getPassiveCaptureStatuses()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
  });

  it('starts with an explicit runnerUrl (positive control)', async () => {
    const { unmount } = renderHook(() => useCommandRelay({ runnerUrl: 'http://127.0.0.1:9876' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(getPassiveCaptureStatuses()).toMatchObject([
      { state: 'active', appId: 'app.example.com', admission: 'admitted' },
    ]);
    unmount();
  });
});
