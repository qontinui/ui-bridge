/**
 * Device Announcer — mDNS + Cloud registration for physical device discovery
 *
 * Announces the UI Bridge service on the local network via mDNS (when
 * react-native-zeroconf is available) and optionally registers with the
 * cloud relay backend.
 */

import { Platform } from 'react-native';
import { transportLogger } from './logger';
import { describeCloseEvent, describeErrorEvent, redactRelayUrl } from './relay-logging';

export interface AnnouncerConfig {
  /** Stable device identifier */
  deviceId: string;
  /** App bundle/package ID */
  appId: string;
  /** UI Bridge server port (default 8087) */
  port?: number;
  /** Cloud relay WebSocket URL for registration */
  cloudRelayUrl?: string;
  /** Auth token for cloud relay */
  cloudToken?: string;
  /** UI Bridge SDK version */
  version?: string;
}

export interface DeviceAnnouncerState {
  mdnsActive: boolean;
  cloudConnected: boolean;
}

/**
 * Minimal interface for the react-native-zeroconf Zeroconf instance.
 *
 * The positional `publishService` form is the one every published version
 * accepts (0.17.x keeps it as a deprecated overload beside the options object).
 * Both methods are typed `void | Promise<unknown>` because 0.17.x returns a
 * Promise that REJECTS on failure (e.g. local-network permission denied); the
 * announcer awaits it so a failure lands in its catch instead of becoming an
 * unhandled rejection with `mdnsActive` already reporting true.
 */
export interface ZeroconfService {
  /** `type` / `protocol` are bare (`'uibridge'`, `'tcp'`): the library adds the underscores. */
  publishService(
    type: string,
    protocol: string,
    domain: string,
    name: string,
    port: number,
    txtRecord: Record<string, string>
  ): void | Promise<unknown>;
  unpublishService(name: string): void | Promise<unknown>;
  /**
   * 0.17.x's constructor subscribes native event listeners
   * (`addDeviceListeners()`); without this call every discarded instance keeps
   * them. Optional because older versions and test fakes may not have it.
   */
  removeDeviceListeners?(): void;
}

/**
 * The name the library actually registered. 0.17.x resolves `publishService`
 * with the published service, whose name can differ from the requested one when
 * that name is taken (Android registers `"<name> (2)"`); unpublishing the
 * REQUESTED name would then remove someone else's advertisement and leak ours.
 * A library that resolves nothing (older versions) registered the requested name.
 */
function registeredServiceName(result: unknown, requested: string): string {
  if (result !== null && typeof result === 'object') {
    const name = (result as { name?: unknown }).name;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return requested;
}

/**
 * The `Zeroconf` constructor `startMdnsAdvertise` accepts — the default export
 * of `react-native-zeroconf` satisfies it. The one definition of the type: the
 * provider's `zeroconf` prop is declared as this, not a parallel copy.
 */
export type ZeroconfConstructor = new () => ZeroconfService;

/** Possible messages received over the cloud relay WebSocket */
interface RelayMessage {
  type: string;
  [key: string]: unknown;
}

const DEFAULT_PORT = 8087;

/**
 * Withdraw `name` (when one was registered) and drop the instance's native
 * listeners. Best-effort: cleanup never throws.
 */
async function releaseZeroconf(zeroconf: ZeroconfService, name: string | null): Promise<void> {
  if (name !== null) {
    try {
      await zeroconf.unpublishService(name);
    } catch {
      // ignore
    }
  }
  try {
    zeroconf.removeDeviceListeners?.();
  } catch {
    // ignore
  }
}
const RECONNECT_INITIAL_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 60_000;

/**
 * Announces the UI Bridge server on the local network (mDNS) and optionally
 * registers with the qontinui.io cloud relay for remote discovery.
 */
export class DeviceAnnouncer {
  private config: Required<Pick<AnnouncerConfig, 'deviceId' | 'appId'>> & AnnouncerConfig;
  private state: DeviceAnnouncerState = {
    mdnsActive: false,
    cloudConnected: false,
  };
  private cloudWs: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
  private stopped = false;
  /** Zeroconf instance, set when mDNS is started (cleared by `stop()`) */
  private zeroconf: ZeroconfService | null = null;
  /** The name the library registered — the only name this announcer may unpublish */
  private publishedName: string | null = null;
  /**
   * True while a publish is awaiting the library. A `stop()` that lands in that
   * window leaves the cleanup to the publish path, which is the only side that
   * will learn the registered name.
   */
  private publishInFlight = false;
  /** Rotated pairing token for mDNS TXT records */
  private pairingToken: string;

  constructor(config: AnnouncerConfig) {
    this.config = config;
    this.pairingToken = generateHex(16);
  }

  // ── mDNS ──────────────────────────────────────────────────────────────────

  /**
   * Start mDNS advertisement.
   *
   * The consumer must pass the `Zeroconf` constructor (from `react-native-zeroconf`)
   * explicitly; otherwise this is a no-op.
   *
   * Rationale: Metro's `require()` throws an uncatchable module-load error if the
   * bundle doesn't include the named package. That error escapes async try/catch
   * boundaries and crashes the app. We avoid it by never calling `require()`
   * ourselves — the consumer imports the package when they know it's installed.
   *
   * @param ZeroconfCtor - constructor from `import Zeroconf from 'react-native-zeroconf'`
   */
  async startMdnsAdvertise(ZeroconfCtor?: ZeroconfConstructor): Promise<void> {
    if (!ZeroconfCtor) {
      transportLogger.log(
        '[DeviceAnnouncer] mDNS advertisement skipped (no Zeroconf constructor provided). ' +
          'Pass one to enable mDNS.'
      );
      return;
    }
    if (this.stopped) return;
    let zeroconf: ZeroconfService | null = null;
    try {
      zeroconf = new ZeroconfCtor();
      this.zeroconf = zeroconf;

      const port = this.config.port ?? DEFAULT_PORT;
      const serviceName = `UIBridge-${this.config.deviceId.slice(0, 8)}`;

      this.publishInFlight = true;
      let result: unknown;
      try {
        // react-native-zeroconf takes the type and protocol WITHOUT their
        // leading underscores and formats `_%s._%s` natively (iOS
        // RNZeroconf.m, Android NsdServiceImpl/DnssdImpl), so passing
        // '_uibridge' / '_tcp.' registered `__uibridge.__tcp.`, which no
        // `_uibridge._tcp` browser (the runner's mdns_scanner) ever matches.
        result = await zeroconf.publishService('uibridge', 'tcp', 'local.', serviceName, port, {
          device_id: this.config.deviceId,
          app_id: this.config.appId,
          version: this.config.version ?? 'unknown',
          pairing_token: this.pairingToken,
        });
      } finally {
        this.publishInFlight = false;
      }
      const registered = registeredServiceName(result, serviceName);

      // `stop()` ran while the publish was in flight and deferred to us: withdraw
      // the name that was actually registered, and never report active.
      if (this.stopped) {
        await releaseZeroconf(zeroconf, registered);
        return;
      }

      this.publishedName = registered;
      this.state = { ...this.state, mdnsActive: true };
      transportLogger.log(`[DeviceAnnouncer] mDNS: advertising "${registered}" on port ${port}`);
    } catch (err) {
      if (this.stopped) {
        // A publish that fails after we were told to stop is not a start
        // failure anyone needs to act on; just drop the instance.
        if (zeroconf) await releaseZeroconf(zeroconf, null);
        return;
      }
      transportLogger.warn('[DeviceAnnouncer] mDNS start failed:', err);
    }
  }

  // ── Cloud relay ───────────────────────────────────────────────────────────

  /**
   * Connect to the cloud relay WebSocket and send a device_register message.
   *
   * Reconnects automatically with exponential backoff (2 s → 60 s) if the
   * connection drops.
   */
  async connectCloudRelay(): Promise<void> {
    if (!this.config.cloudRelayUrl || !this.config.cloudToken) {
      return;
    }
    if (this.stopped) return;

    const url = `${this.config.cloudRelayUrl}?token=${encodeURIComponent(this.config.cloudToken)}`;
    // Same credential, same sink, same rule as `CloudRelayClient`: the relay URL
    // carries the device auth token in its query string and `transportLogger`
    // feeds the ring buffer behind `/control/console-errors`, so nothing that
    // reaches a log sink may name the raw URL.
    const safeUrl = redactRelayUrl(url);

    transportLogger.log('[DeviceAnnouncer] Cloud relay: connecting to', safeUrl);

    const ws = new WebSocket(url);
    this.cloudWs = ws;

    ws.onopen = () => {
      if (this.stopped) {
        ws.close();
        return;
      }
      this.reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
      this.state = { ...this.state, cloudConnected: true };
      transportLogger.log('[DeviceAnnouncer] Cloud relay: connected');

      // Register this device with the backend
      ws.send(
        JSON.stringify({
          type: 'device_register',
          device_id: this.config.deviceId,
          app_id: this.config.appId,
          platform: getPlatform(),
          display_name: this.config.deviceId,
          ui_bridge_version: this.config.version ?? 'unknown',
        })
      );
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as RelayMessage;
        transportLogger.log('[DeviceAnnouncer] Cloud relay message:', msg.type);
        // Tunneled HTTP requests are handled by CloudRelayClient when wired up
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = (event: CloseEvent) => {
      this.state = { ...this.state, cloudConnected: false };
      const detail = describeCloseEvent(event);
      if (this.stopped) {
        // Expected: `stop()` asked for this close. Defensive rather than
        // reachable in the normal lifecycle — `stop()` nulls this handler
        // before calling `close()`, and `connectCloudRelay()` early-returns
        // once stopped — so this arm only fires if a transport delivers a
        // close to a handler captured before `stop()` ran. Kept because
        // "logged nothing" is what made the pre-fix behaviour undiagnosable.
        transportLogger.log(`[DeviceAnnouncer] Cloud relay closed ${detail} url=${safeUrl}`);
      } else {
        // Unexpected: the registration socket died and we are about to
        // reconnect. Logging the bare event said nothing — a DOM `CloseEvent`
        // has no own enumerable properties, so the observability capture's
        // `JSON.stringify` rendered it as `{}`. The close code is the whole
        // diagnosis: 1008/4001-class means the relay rejected this device's
        // token, which is otherwise indistinguishable from a flaky network.
        transportLogger.warn(
          `[DeviceAnnouncer] Cloud relay closed unexpectedly ${detail} url=${safeUrl}`
        );
        this.scheduleReconnect();
      }
    };

    ws.onerror = (err: Event) => {
      transportLogger.warn(
        `[DeviceAnnouncer] Cloud relay error: ${describeErrorEvent(err)} url=${safeUrl}`
      );
      // onclose will fire after this and trigger reconnect
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Stop all advertising and registration. */
  async stop(): Promise<void> {
    this.stopped = true;

    // Cancel any pending reconnect
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Unpublish mDNS service. Only the REGISTERED name is ours to withdraw;
    // with a publish still in flight the publish path does the cleanup once it
    // learns that name (see `startMdnsAdvertise`).
    const zeroconf = this.zeroconf;
    const publishedName = this.publishedName;
    const inFlight = this.publishInFlight;
    this.zeroconf = null;
    this.publishedName = null;
    this.state = { ...this.state, mdnsActive: false };
    if (zeroconf && !inFlight) {
      await releaseZeroconf(zeroconf, publishedName);
    }

    // Close cloud WebSocket
    if (this.cloudWs) {
      this.cloudWs.onclose = null; // prevent reconnect loop
      this.cloudWs.close();
      this.cloudWs = null;
    }
    this.state = { ...this.state, cloudConnected: false };
  }

  /** Return a copy of the current announcer state. */
  getState(): DeviceAnnouncerState {
    return { ...this.state };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = this.reconnectDelay;
    transportLogger.log(`[DeviceAnnouncer] Cloud relay: reconnecting in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) {
        void this.connectCloudRelay();
      }
    }, delay);
    // Exponential backoff
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function generateHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  // In React Native, Math.random() is fine for a non-security pairing token
  for (let i = 0; i < bytes; i++) {
    arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getPlatform(): string {
  return Platform?.OS ?? 'unknown';
}
