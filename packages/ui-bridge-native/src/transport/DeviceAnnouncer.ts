/**
 * Device Announcer — mDNS + Cloud registration for physical device discovery
 *
 * Announces the UI Bridge service on the local network via mDNS (when
 * react-native-zeroconf is available) and optionally registers with the
 * cloud relay backend.
 */

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
   * Start mDNS advertisement using react-native-zeroconf.
   *
   * If the package is not installed the call is a no-op and a warning is logged.
   */
  async startMdnsAdvertise(): Promise<void> {
    try {
      // Dynamic import so apps without the package still compile
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ZeroconfModule = require('react-native-zeroconf');
      const Zeroconf = ZeroconfModule.default ?? ZeroconfModule;
      this.zeroconf = new Zeroconf() as ZeroconfService;

      const port = this.config.port ?? DEFAULT_PORT;
      const serviceName = `UIBridge-${this.config.deviceId.slice(0, 8)}`;

      this.zeroconf.publishService('_uibridge', '_tcp.', 'local.', serviceName, port, {
        device_id: this.config.deviceId,
        app_id: this.config.appId,
        version: this.config.version ?? 'unknown',
        pairing_token: this.pairingToken,
      });

      this.state = { ...this.state, mdnsActive: true };
      console.log(`[DeviceAnnouncer] mDNS: advertising "${serviceName}" on port ${port}`);
    } catch (_err) {
      console.warn(
        '[DeviceAnnouncer] react-native-zeroconf not available — mDNS advertisement skipped. ' +
          'Install it with: npx expo install react-native-zeroconf'
      );
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

    console.log('[DeviceAnnouncer] Cloud relay: connecting to', url);

    const ws = new WebSocket(url);
    this.cloudWs = ws;

    ws.onopen = () => {
      if (this.stopped) {
        ws.close();
        return;
      }
      this.reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
      this.state = { ...this.state, cloudConnected: true };
      console.log('[DeviceAnnouncer] Cloud relay: connected');

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
        console.log('[DeviceAnnouncer] Cloud relay message:', msg.type);
        // Tunneled HTTP requests are handled by CloudRelayClient when wired up
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      this.state = { ...this.state, cloudConnected: false };
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = (err: Event) => {
      console.warn('[DeviceAnnouncer] Cloud relay error:', err);
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
    console.log(`[DeviceAnnouncer] Cloud relay: reconnecting in ${delay}ms`);
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
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Platform } = require('react-native');
    return (Platform.OS as string) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
