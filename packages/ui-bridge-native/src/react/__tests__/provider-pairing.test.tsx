/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  StyleSheet: { flatten: (style: unknown) => style ?? undefined },
  PixelRatio: { get: () => 1 },
  Dimensions: { get: () => ({ width: 390, height: 844 }) },
}));

import { UIBridgeNativeProvider, useUIBridgeNative } from '../UIBridgeNativeProvider';
import type { HTTPRequest, RequestHandler, WebSocketServerAdapter } from '../../server/http-server';
import { signUIBridgeRequest, type PairingStore } from '../../server/pairing';

const FEATURES = { server: true };
const LAN: HTTPRequest = {
  method: 'GET',
  path: '/ui-bridge/control/snapshot',
  headers: { host: '192.168.1.20:8087' },
  query: {},
  remoteAddress: '192.168.1.50',
};
const CABLE_PAIR: HTTPRequest = {
  method: 'POST',
  path: '/ui-bridge/pair',
  headers: { host: 'localhost:8087' },
  query: {},
  remoteAddress: '127.0.0.1',
};

type TestAdapter = WebSocketServerAdapter & { starts: number; http: RequestHandler };

function fakeAdapter(): TestAdapter {
  const adapter = {
    starts: 0,
    http: (async () => {
      throw new Error('never started');
    }) as RequestHandler,
    async start(_port: number, handler: RequestHandler) {
      adapter.starts += 1;
      adapter.http = handler;
    },
    async stop() {},
    isRunning: () => true,
    broadcast() {},
    sendToConnection() {},
  };
  return adapter as unknown as TestAdapter;
}

function storeWith(state: { token: string | null }): PairingStore {
  return {
    get: () => state.token,
    set: (token) => {
      state.token = token;
    },
    clear: () => {
      state.token = null;
    },
    randomBytes: (n) => new Uint8Array(n).fill(0x42),
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('UIBridgeNativeProvider pairing wiring', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    adapter = fakeAdapter();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hands the store to the server, whose gate the adapter then enters', async () => {
    const state = { token: null as string | null };
    const { unmount } = render(
      <UIBridgeNativeProvider
        features={FEATURES}
        serverAdapter={adapter}
        deviceId="device-1"
        pairingStore={storeWith(state)}
      >
        {null}
      </UIBridgeNativeProvider>
    );
    await flush();

    const refused = await adapter.http(LAN);
    expect(refused.status).toBe(401);
    expect(JSON.parse(refused.body).code).toBe('PAIRING_REQUIRED');

    const paired = JSON.parse((await adapter.http(CABLE_PAIR)).body);
    expect(paired.data.token).toBe('42'.repeat(32));
    expect(paired.data.deviceId).toBe('device-1');
    expect(state.token).toBe('42'.repeat(32));
    unmount();
  });

  it('answers PAIRING_UNCONFIGURED when the host passes no store', async () => {
    const { unmount } = render(
      <UIBridgeNativeProvider features={FEATURES} serverAdapter={adapter}>
        {null}
      </UIBridgeNativeProvider>
    );
    await flush();
    expect(JSON.parse((await adapter.http(LAN)).body).code).toBe('PAIRING_UNCONFIGURED');
    unmount();
  });

  it('passes allowUnauthenticatedNetwork through', async () => {
    const { unmount } = render(
      <UIBridgeNativeProvider
        features={FEATURES}
        serverAdapter={adapter}
        allowUnauthenticatedNetwork
      >
        {null}
      </UIBridgeNativeProvider>
    );
    await flush();
    expect((await adapter.http(LAN)).status).toBe(200);
    unmount();
  });

  it('gates the upgrade and the socket messages on the adapter', async () => {
    const { unmount } = render(
      <UIBridgeNativeProvider
        features={FEATURES}
        serverAdapter={adapter}
        pairingStore={storeWith({ token: null })}
      >
        {null}
      </UIBridgeNativeProvider>
    );
    await flush();

    expect(typeof adapter.onWebSocketUpgrade).toBe('function');
    const decision = adapter.onWebSocketUpgrade!({ ...LAN, path: '/' });
    expect(decision.admit).toBe(false);

    unmount();

    // A fresh mount whose adapter never called the upgrade hook: its messages are refused.
    const second = fakeAdapter();
    const again = render(
      <UIBridgeNativeProvider
        features={FEATURES}
        serverAdapter={second}
        pairingStore={storeWith({ token: null })}
      >
        {null}
      </UIBridgeNativeProvider>
    );
    await flush();
    const answer = await second.onWebSocketMessage!(
      'c',
      JSON.stringify({ id: 1, method: 'health' })
    );
    expect(JSON.parse(answer ?? '{}')).toMatchObject({
      id: 1,
      result: { code: 'PAIRING_UNCONFIGURED' },
    });
    again.unmount();
  });

  it('does not restart the server when an inline store changes identity', async () => {
    const state = { token: null as string | null };
    const tree = () => (
      <UIBridgeNativeProvider
        features={FEATURES}
        serverAdapter={adapter}
        // A fresh object on every render, which is what an inline prop is.
        pairingStore={{ ...storeWith(state) }}
      >
        {null}
      </UIBridgeNativeProvider>
    );
    const { rerender, unmount } = render(tree());
    await flush();
    expect(adapter.starts).toBe(1);

    rerender(tree());
    await flush();
    rerender(tree());
    await flush();
    expect(adapter.starts).toBe(1);
    unmount();
  });

  it('calls the latest store after a re-render, not the first one', async () => {
    const first = { token: 'first-token' as string | null };
    const second = { token: 'second-token' as string | null };
    const tree = (store: PairingStore) => (
      <UIBridgeNativeProvider
        features={FEATURES}
        serverAdapter={adapter}
        deviceId="device-1"
        pairingStore={store}
      >
        {null}
      </UIBridgeNativeProvider>
    );
    const { rerender, unmount } = render(tree(storeWith(first)));
    await flush();
    rerender(tree(storeWith(second)));
    await flush();
    expect(JSON.parse((await adapter.http(CABLE_PAIR)).body).data.token).toBe('second-token');
    unmount();
  });

  it('takes a device id that loads late, without a restart', async () => {
    const tree = (deviceId?: string) => (
      <UIBridgeNativeProvider
        features={FEATURES}
        serverAdapter={adapter}
        deviceId={deviceId}
        pairingStore={storeWith({ token: 't'.repeat(64) })}
      >
        {null}
      </UIBridgeNativeProvider>
    );
    const { rerender, unmount } = render(tree(undefined));
    await flush();
    expect((await adapter.http(CABLE_PAIR)).status).toBe(503);

    rerender(tree('device-late'));
    await flush();
    const paired = await adapter.http(CABLE_PAIR);
    expect(JSON.parse(paired.body).data.deviceId).toBe('device-late');
    expect(adapter.starts).toBe(1);
    unmount();
  });

  it('gives the app the arm, state and revoke doors through context', async () => {
    let bridge!: ReturnType<typeof useUIBridgeNative>;
    function Capture() {
      bridge = useUIBridgeNative();
      return null;
    }
    const state = { token: 'o'.repeat(64) as string | null };
    const { unmount } = render(
      <UIBridgeNativeProvider
        features={FEATURES}
        serverAdapter={adapter}
        deviceId="device-1"
        pairingStore={storeWith(state)}
      >
        <Capture />
      </UIBridgeNativeProvider>
    );
    await flush();

    const armed = await bridge.armPairingCode();
    expect(armed.code).toMatch(/^\d{6}$/);
    expect(bridge.getPairingState().armed).toBe(true);
    bridge.disarmPairingCode();
    expect(bridge.getPairingState().armed).toBe(false);

    await bridge.revokePairing();
    expect(state.token).toBe('42'.repeat(32));
    unmount();
  });

  it('keeps refusing the old token after a failed revoke, across a remount over the same store', async () => {
    let bridge!: ReturnType<typeof useUIBridgeNative>;
    function Capture() {
      bridge = useUIBridgeNative();
      return null;
    }
    const oldToken = 'o'.repeat(64);
    const state = { token: oldToken as string | null };
    // One object the app keeps, as a module-level store would be.
    const host = storeWith(state);
    const tree = (into: TestAdapter) => (
      <UIBridgeNativeProvider
        features={FEATURES}
        serverAdapter={into}
        deviceId="device-1"
        pairingStore={host}
      >
        <Capture />
      </UIBridgeNativeProvider>
    );
    const first = render(tree(adapter));
    await flush();
    const realGet = host.get;
    host.get = () => {
      throw new Error('not loaded');
    };
    await expect(bridge.revokePairing()).rejects.toMatchObject({ code: 'PAIRING_UNAVAILABLE' });
    host.get = realGet;
    first.unmount();

    // A remount builds a new wrapper, and a new server, over the same app store.
    const second = fakeAdapter();
    const again = render(tree(second));
    await flush();
    const suspended = {
      code: 'PAIRING_UNAVAILABLE',
      error: 'Pairing is suspended until a revoke succeeds on the device.',
    };
    const header = signUIBridgeRequest(oldToken, {
      method: LAN.method,
      pathAndQuery: LAN.path,
      ts: Date.now(),
      nonce: 'remountnonce0000001',
    });
    const refused = await second.http({
      ...LAN,
      headers: { ...LAN.headers, 'x-ui-bridge-auth': header },
    });
    expect(refused.status).toBe(503);
    expect(JSON.parse(refused.body)).toMatchObject(suspended);
    const pair = await second.http(CABLE_PAIR);
    expect(pair.status).toBe(503);
    expect(JSON.parse(pair.body)).toMatchObject(suspended);

    await bridge.revokePairing();
    expect(state.token).toBe('42'.repeat(32));
    expect(JSON.parse((await second.http(CABLE_PAIR)).body).data.token).toBe('42'.repeat(32));
    again.unmount();
  });

  it('leaves an app store the wrapper moved away from mid-revoke suspect', async () => {
    let bridge!: ReturnType<typeof useUIBridgeNative>;
    function Capture() {
      bridge = useUIBridgeNative();
      return null;
    }
    const oldToken = 'o'.repeat(64);
    const firstState = { token: oldToken as string | null };
    const secondState = { token: null as string | null };
    const firstHost = storeWith(firstState);
    const secondHost = storeWith(secondState);
    const tree = (into: TestAdapter, host: PairingStore) => (
      <UIBridgeNativeProvider
        features={FEATURES}
        serverAdapter={into}
        deviceId="device-1"
        pairingStore={host}
      >
        <Capture />
      </UIBridgeNativeProvider>
    );
    const view = render(tree(adapter, firstHost));
    await flush();
    const realGet = firstHost.get;
    firstHost.get = () => {
      throw new Error('not loaded');
    };
    await expect(bridge.revokePairing()).rejects.toMatchObject({ code: 'PAIRING_UNAVAILABLE' });

    // The next revoke reads the first store, and the app swaps stores before it writes.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    firstHost.get = async () => {
      await gate;
      return realGet();
    };
    const revoking = bridge.revokePairing();
    await flush();
    view.rerender(tree(adapter, secondHost));
    await flush();
    release();
    await act(async () => {
      await revoking;
    });
    expect(secondState.token).toBe('42'.repeat(32));
    expect(firstState.token).toBe(oldToken);
    firstHost.get = realGet;
    view.unmount();

    // The write never reached the first store, which still holds the old token.
    const second = fakeAdapter();
    const again = render(tree(second, firstHost));
    await flush();
    const pair = await second.http(CABLE_PAIR);
    expect(pair.status).toBe(503);
    expect(JSON.parse(pair.body)).toMatchObject({
      code: 'PAIRING_UNAVAILABLE',
      error: 'Pairing is suspended until a revoke succeeds on the device.',
    });
    again.unmount();
  });

  it('answers the doors honestly when no server is running', async () => {
    let bridge!: ReturnType<typeof useUIBridgeNative>;
    function Capture() {
      bridge = useUIBridgeNative();
      return null;
    }
    const { unmount } = render(
      <UIBridgeNativeProvider features={{}}>
        <Capture />
      </UIBridgeNativeProvider>
    );
    await flush();
    await expect(bridge.armPairingCode()).rejects.toMatchObject({ code: 'PAIRING_UNCONFIGURED' });
    await expect(bridge.revokePairing()).rejects.toMatchObject({ code: 'PAIRING_UNCONFIGURED' });
    expect(bridge.getPairingState().configured).toBe(false);
    unmount();
  });
});
