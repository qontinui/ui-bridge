/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

// Mock react-native before importing the provider (and, through it,
// DeviceAnnouncer, which reads `Platform`).
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  StyleSheet: {
    flatten: (style: unknown) => style ?? undefined,
  },
  PixelRatio: {
    get: () => 1,
  },
  Dimensions: {
    get: () => ({ width: 390, height: 844 }),
  },
}));

import { UIBridgeNativeProvider } from '../UIBridgeNativeProvider';
import type { ZeroconfConstructor } from '../../transport/DeviceAnnouncer';

/**
 * The phone never advertised `_uibridge._tcp`. The host passed
 * `enableMdnsAnnounce={true}`, but the provider called
 * `announcer.startMdnsAdvertise()` with NO constructor, so the announcer took
 * its "no Zeroconf constructor provided" skip arm every time. The `zeroconf`
 * prop forwards the host's constructor; omitting it must keep the skip.
 */

interface PublishCall {
  type: string;
  protocol: string;
  domain: string;
  name: string;
  port: number;
  txt: Record<string, string>;
}

let published: PublishCall[];
let unpublished: string[];
let constructed: number;

class FakeZeroconf {
  constructor() {
    constructed += 1;
  }
  publishService(
    type: string,
    protocol: string,
    domain: string,
    name: string,
    port: number,
    txt: Record<string, string>
  ): void {
    published.push({ type, protocol, domain, name, port, txt });
  }
  unpublishService(name: string): void {
    unpublished.push(name);
  }
}

// Compile-time proof the fake satisfies the exported constructor type.
const FakeCtor: ZeroconfConstructor = FakeZeroconf;

const DEVICE_ID = 'abcdef0123456789';
const CONFIG = { serverPort: 8087, appInfo: { appId: 'io.qontinui.mobile' } };

/** Let the provider's effect and the announcer's async start settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('UIBridgeNativeProvider mDNS advertisement', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    published = [];
    unpublished = [];
    constructed = 0;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function skipLogged(): boolean {
    return logSpy.mock.calls.some((args: unknown[]) =>
      String(args[0]).includes('mDNS advertisement skipped (no Zeroconf constructor provided)')
    );
  }

  it('publishes _uibridge._tcp through the zeroconf constructor it is given', async () => {
    const { unmount } = render(
      <UIBridgeNativeProvider
        config={CONFIG}
        enableMdnsAnnounce
        deviceId={DEVICE_ID}
        zeroconf={FakeCtor}
      >
        {null}
      </UIBridgeNativeProvider>
    );
    await flush();

    expect(constructed).toBe(1);
    expect(published).toHaveLength(1);
    const call = published[0]!;
    expect(call.type).toBe('_uibridge');
    expect(call.protocol).toBe('_tcp.');
    expect(call.domain).toBe('local.');
    expect(call.name).toBe('UIBridge-abcdef01');
    expect(call.port).toBe(8087);
    expect(call.txt.device_id).toBe(DEVICE_ID);
    expect(call.txt.app_id).toBe('io.qontinui.mobile');
    expect(skipLogged()).toBe(false);

    // Unmount stops the announcer, which withdraws the advertisement.
    unmount();
    await flush();
    expect(unpublished).toEqual(['UIBridge-abcdef01']);
  });

  it('keeps the skip arm when no zeroconf constructor is passed', async () => {
    render(
      <UIBridgeNativeProvider config={CONFIG} enableMdnsAnnounce deviceId={DEVICE_ID}>
        {null}
      </UIBridgeNativeProvider>
    );
    await flush();

    expect(constructed).toBe(0);
    expect(published).toHaveLength(0);
    expect(skipLogged()).toBe(true);
  });

  it('does not construct zeroconf when enableMdnsAnnounce is off', async () => {
    render(
      <UIBridgeNativeProvider config={CONFIG} deviceId={DEVICE_ID} zeroconf={FakeCtor}>
        {null}
      </UIBridgeNativeProvider>
    );
    await flush();

    expect(constructed).toBe(0);
    expect(published).toHaveLength(0);
  });

  it('re-advertises when the constructor is supplied after mount', async () => {
    const { rerender } = render(
      <UIBridgeNativeProvider config={CONFIG} enableMdnsAnnounce deviceId={DEVICE_ID}>
        {null}
      </UIBridgeNativeProvider>
    );
    await flush();
    expect(published).toHaveLength(0);

    rerender(
      <UIBridgeNativeProvider
        config={CONFIG}
        enableMdnsAnnounce
        deviceId={DEVICE_ID}
        zeroconf={FakeCtor}
      >
        {null}
      </UIBridgeNativeProvider>
    );
    await flush();

    expect(constructed).toBe(1);
    expect(published).toHaveLength(1);
    expect(published[0]!.type).toBe('_uibridge');
  });
});

/**
 * The app mounts with `features.server` on (in `__DEV__`), so `serverRunning`
 * flips false → true after the HTTP server starts and the transport effect
 * RE-RUNS: announcer A is stopped and announcer B publishes the same requested
 * name. The fake below models the native side the way react-native-zeroconf
 * does on Android: one process-wide registry keyed by the RESOLVED name, a
 * taken name registered as `"<name> (2)"`, and an unpublish that completes
 * asynchronously — so B's publish lands while A's registration is still live.
 */
describe('UIBridgeNativeProvider mDNS advertisement across a serverRunning re-run', () => {
  const nativeRegistry = new Set<string>();
  let liveListeners = 0;

  class NativeLikeZeroconf {
    constructor() {
      liveListeners += 1; // 0.17.3's constructor calls addDeviceListeners()
    }
    publishService(
      _type: string,
      _protocol: string,
      _domain: string,
      name: string
    ): Promise<{ name: string }> {
      let resolved = name;
      for (let n = 2; nativeRegistry.has(resolved); n += 1) resolved = `${name} (${n})`;
      nativeRegistry.add(resolved);
      return Promise.resolve({ name: resolved });
    }
    unpublishService(name: string): Promise<null> {
      return Promise.resolve().then(() => {
        nativeRegistry.delete(name);
        return null;
      });
    }
    removeDeviceListeners(): void {
      liveListeners -= 1;
    }
  }
  const NativeCtor: ZeroconfConstructor = NativeLikeZeroconf;

  const serverAdapter = {
    running: false,
    async start(): Promise<void> {
      this.running = true;
    },
    async stop(): Promise<void> {
      this.running = false;
    },
    isRunning(): boolean {
      return this.running;
    },
  };

  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    nativeRegistry.clear();
    liveListeners = 0;
    serverAdapter.running = false;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i += 1) await flush();
  }

  it('leaves exactly one live advertisement after the re-run and withdraws it on unmount', async () => {
    const { unmount } = render(
      <UIBridgeNativeProvider
        features={{ server: true }}
        config={CONFIG}
        serverAdapter={serverAdapter}
        enableMdnsAnnounce
        deviceId={DEVICE_ID}
        zeroconf={NativeCtor}
      >
        {null}
      </UIBridgeNativeProvider>
    );
    await settle();

    // The server came up, so the effect re-ran (two instances constructed)...
    expect(serverAdapter.running).toBe(true);
    // ...and B was registered under the RENAMED name while A was still live.
    // Only that one advertisement may survive A's teardown.
    expect([...nativeRegistry]).toEqual(['UIBridge-abcdef01 (2)']);
    // A's instance released its native listeners; B's is the one live set.
    expect(liveListeners).toBe(1);

    unmount();
    await settle();

    // B withdrew the name it actually registered, not the requested one.
    expect([...nativeRegistry]).toEqual([]);
    expect(liveListeners).toBe(0);
  });
});
