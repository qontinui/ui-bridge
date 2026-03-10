/**
 * Network Idle Detector
 *
 * Intercepts fetch() and XMLHttpRequest to track in-flight network requests.
 * Reports idle when no requests have been pending for `debounceMs`.
 */

import type {
  IdleSignal,
  NetworkSignalStatus,
  NetworkIdleConfig,
  PendingRequest,
  SignalWaitOptions,
  SignalTransitionCallback,
} from './types';

interface TrackedRequest {
  url: string;
  method: string;
  startedAt: number;
}

export class NetworkIdleDetector implements IdleSignal<NetworkSignalStatus> {
  readonly name = 'network';
  readonly weight: number;

  private pending = new Map<number, TrackedRequest>();
  private nextId = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private _isIdle = true;
  private debounceMs: number;
  private ignorePatterns: RegExp[];
  private trackXHR: boolean;
  private listeners: Array<SignalTransitionCallback<NetworkSignalStatus>> = [];
  private installed = false;

  // Saved originals for cleanup
  private originalFetch: typeof globalThis.fetch | null = null;
  private originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null;
  private originalXHRSend: typeof XMLHttpRequest.prototype.send | null = null;

  // Event callbacks for external consumers (e.g., composite emitting bridge events)
  onRequestStart?: (data: { url: string; method: string; pendingCount: number }) => void;
  onRequestEnd?: (data: {
    url: string;
    method: string;
    status?: number;
    durationMs: number;
    pendingCount: number;
  }) => void;

  constructor(config: NetworkIdleConfig & { weight?: number } = {}) {
    this.weight = config.weight ?? 0.9;
    this.debounceMs = config.debounceMs ?? 500;
    this.ignorePatterns = (config.ignorePatterns ?? []).map((p) => new RegExp(p));
    this.trackXHR = config.trackXHR ?? true;
  }

  install(): void {
    if (this.installed) return;
    this.installed = true;

    this.installFetchInterceptor();
    if (this.trackXHR) {
      this.installXHRInterceptor();
    }
  }

  destroy(): void {
    if (!this.installed) return;
    this.installed = false;

    // Restore fetch
    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = null;
    }

    // Restore XHR
    if (this.originalXHROpen) {
      XMLHttpRequest.prototype.open = this.originalXHROpen;
      this.originalXHROpen = null;
    }
    if (this.originalXHRSend) {
      XMLHttpRequest.prototype.send = this.originalXHRSend;
      this.originalXHRSend = null;
    }

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    this.pending.clear();
    this.listeners = [];
  }

  isIdle(): boolean {
    return this._isIdle;
  }

  getStatus(): NetworkSignalStatus {
    const now = Date.now();
    const pendingRequests: PendingRequest[] = [];

    for (const tracked of this.pending.values()) {
      pendingRequests.push({
        url: tracked.url,
        method: tracked.method,
        startedAt: tracked.startedAt,
        durationMs: now - tracked.startedAt,
      });
    }

    return {
      idle: this._isIdle,
      pendingCount: this.pending.size,
      pendingRequests,
      timestamp: now,
    };
  }

  async waitForIdle(options?: SignalWaitOptions): Promise<NetworkSignalStatus> {
    const timeout = options?.timeout ?? 30000;
    const minStable = options?.minStableMs ?? 0;

    return new Promise<NetworkSignalStatus>((resolve, reject) => {
      const startTime = Date.now();
      let stableSince: number | null = null;

      const check = () => {
        const status = this.getStatus();

        if (status.idle) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= minStable) {
            return resolve(status);
          }
        } else {
          stableSince = null;
        }

        if (Date.now() - startTime > timeout) {
          return reject(
            new Error(
              `Network idle timeout after ${timeout}ms. ` +
                `${this.pending.size} requests still pending.`
            )
          );
        }

        setTimeout(check, 50);
      };

      check();
    });
  }

  onTransition(callback: SignalTransitionCallback<NetworkSignalStatus>): () => void {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  // ==========================================================================
  // Private
  // ==========================================================================

  private shouldIgnore(url: string): boolean {
    return this.ignorePatterns.some((re) => re.test(url));
  }

  private trackRequest(url: string, method: string): number {
    const id = this.nextId++;
    this.pending.set(id, { url, method, startedAt: Date.now() });

    // Cancel any pending idle timer
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    // Transition to busy
    if (this._isIdle) {
      this._isIdle = false;
      this.notifyTransition();
    }

    this.onRequestStart?.({
      url,
      method,
      pendingCount: this.pending.size,
    });

    return id;
  }

  private completeRequest(id: number, status?: number): void {
    const tracked = this.pending.get(id);
    if (!tracked) return;

    this.pending.delete(id);

    this.onRequestEnd?.({
      url: tracked.url,
      method: tracked.method,
      status,
      durationMs: Date.now() - tracked.startedAt,
      pendingCount: this.pending.size,
    });

    if (this.pending.size === 0) {
      this.scheduleIdle();
    }
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);

    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size === 0 && !this._isIdle) {
        this._isIdle = true;
        this.notifyTransition();
      }
    }, this.debounceMs);
  }

  private notifyTransition(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(this._isIdle, status);
      } catch {
        // Don't let listener errors break the detector
      }
    }
  }

  private installFetchInterceptor(): void {
    this.originalFetch = globalThis.fetch;
    const self = this;
    const original = this.originalFetch;

    globalThis.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method?.toUpperCase() || 'GET';

      if (self.shouldIgnore(url)) {
        return original.call(globalThis, input, init);
      }

      const id = self.trackRequest(url, method);

      return original.call(globalThis, input, init).then(
        (response) => {
          self.completeRequest(id, response.status);
          return response;
        },
        (error) => {
          self.completeRequest(id, 0);
          throw error;
        }
      );
    };
  }

  private installXHRInterceptor(): void {
    this.originalXHROpen = XMLHttpRequest.prototype.open;
    this.originalXHRSend = XMLHttpRequest.prototype.send;
    const self = this;

    // Patch open to capture URL and method
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null
    ) {
      (
        this as XMLHttpRequest & { __uiBridgeMethod?: string; __uiBridgeUrl?: string }
      ).__uiBridgeMethod = method;
      (this as XMLHttpRequest & { __uiBridgeUrl?: string }).__uiBridgeUrl =
        typeof url === 'string' ? url : url.href;
      return self.originalXHROpen!.call(this, method, url, async ?? true, username, password);
    };

    // Patch send to track the request
    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const xhr = this as XMLHttpRequest & {
        __uiBridgeMethod?: string;
        __uiBridgeUrl?: string;
        __uiBridgeTrackId?: number;
      };
      const url = xhr.__uiBridgeUrl || '';
      const method = (xhr.__uiBridgeMethod || 'GET').toUpperCase();

      if (self.shouldIgnore(url)) {
        return self.originalXHRSend!.call(this, body);
      }

      const id = self.trackRequest(url, method);
      xhr.__uiBridgeTrackId = id;

      xhr.addEventListener('loadend', () => {
        self.completeRequest(id, xhr.status);
      });

      return self.originalXHRSend!.call(this, body);
    };
  }
}
