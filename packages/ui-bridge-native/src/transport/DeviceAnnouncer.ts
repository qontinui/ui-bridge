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

/** Minimal interface for the react-native-zeroconf Zeroconf instance */
interface ZeroconfService {
  publishService(
    type: string,
    protocol: string,
    domain: string,
    name: string,
    port: number,
    txtRecord: Record<string, string>
  ): void;
  unpublishService(name: string): void;
}

/** Possible messages received over the cloud relay WebSocket */
interface RelayMessage {
  type: string;
  [key: string]: unknown;
}

const DEFAULT_PORT = 8087;
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
  /** Zeroconf instance, set when mDNS is successfully started */
  private zeroconf: ZeroconfService | null = null;
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
  async startMdnsAdvertise(ZeroconfCtor?: new () => ZeroconfService): Promise<void> {
    if (!ZeroconfCtor) {
      transportLogger.log(
        '[DeviceAnnouncer] mDNS advertisement skipped (no Zeroconf constructor provided). ' +
          'Pass one to enable mDNS.'
      );
      return;
    }
    try {
      this.zeroconf = new ZeroconfCtor();

      const port = this.config.port ?? DEFAULT_PORT;
      const serviceName = `UIBridge-${this.config.deviceId.slice(0, 8)}`;

      this.zeroconf.publishService('_uibridge', '_tcp.', 'local.', serviceName, port, {
        device_id: this.config.deviceId,
        app_id: this.config.appId,
        version: this.config.version ?? 'unknown',
        pairing_token: this.pairingToken,
      });

      this.state = { ...this.state, mdnsActive: true };
      transportLogger.log(`[DeviceAnnouncer] mDNS: advertising "${serviceName}" on port ${port}`);
    } catch (err) {
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

    // Unpublish mDNS service
    if (this.zeroconf) {
      try {
        const serviceName = `UIBridge-${this.config.deviceId.slice(0, 8)}`;
        this.zeroconf.unpublishService(serviceName);
      } catch {
        // ignore
      }
      this.zeroconf = null;
    }
    this.state = { ...this.state, mdnsActive: false };

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
