/**
 * Chrome DevTools Protocol Tab Discovery
 *
 * Opt-in module that connects to Chrome's CDP endpoint to discover ALL
 * browser tabs, including those without the UI Bridge SDK loaded.
 *
 * Requires Chrome/Edge to be launched with `--remote-debugging-port=9222`.
 */

export interface CDPTarget {
  id: string;
  type: string; // "page", "background_page", "service_worker", etc.
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
  /** True if this target also has an SDK connection (merged from UI Bridge) */
  hasSDK?: boolean;
  sdkTabId?: string;
}

export interface CDPTabsConfig {
  /** CDP endpoint URL. Empty string or undefined = disabled. */
  endpoint?: string;
  /** Timeout for CDP HTTP requests in ms. Default 5000. */
  timeout?: number;
}

/**
 * CDP-based browser tab discovery and control.
 *
 * Requires Chrome/Edge to be launched with `--remote-debugging-port=9222`.
 * When enabled, extends UI Bridge's tab awareness beyond SDK-connected
 * tabs to include ALL browser tabs.
 */
export class CDPTabDiscovery {
  private endpoint: string;
  private timeout: number;
  private enabled: boolean;

  constructor(config?: CDPTabsConfig) {
    this.endpoint = (config?.endpoint || process.env.CDP_ENDPOINT || '').replace(/\/$/, '');
    this.timeout = config?.timeout ?? 5000;
    this.enabled = this.endpoint.length > 0;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * List all CDP targets (tabs, service workers, etc.).
   * Returns an empty array if CDP is disabled or unreachable.
   */
  async listTargets(): Promise<CDPTarget[]> {
    if (!this.enabled) return [];
    try {
      const response = await fetch(`${this.endpoint}/json`, {
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!response.ok) return [];
      const targets = (await response.json()) as CDPTarget[];
      return targets.map((t) => ({
        id: t.id,
        type: t.type,
        title: t.title,
        url: t.url,
        webSocketDebuggerUrl: t.webSocketDebuggerUrl,
      }));
    } catch {
      // CDP not running or unreachable — graceful degradation
      return [];
    }
  }

  /**
   * Activate (bring to front) a tab by its CDP target ID.
   */
  async activateTarget(targetId: string): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const response = await fetch(
        `${this.endpoint}/json/activate/${encodeURIComponent(targetId)}`,
        { signal: AbortSignal.timeout(this.timeout) }
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Close a tab by its CDP target ID.
   */
  async closeTarget(targetId: string): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      const response = await fetch(`${this.endpoint}/json/close/${encodeURIComponent(targetId)}`, {
        signal: AbortSignal.timeout(this.timeout),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Open a new tab, optionally navigated to a URL.
   * Returns the new target metadata, or null on failure.
   */
  async openNewTab(url?: string): Promise<CDPTarget | null> {
    if (!this.enabled) return null;
    try {
      const query = url ? `?${encodeURIComponent(url)}` : '';
      const response = await fetch(`${this.endpoint}/json/new${query}`, {
        signal: AbortSignal.timeout(this.timeout),
      });
      if (!response.ok) return null;
      const target = (await response.json()) as CDPTarget;
      return {
        id: target.id,
        type: target.type,
        title: target.title,
        url: target.url,
        webSocketDebuggerUrl: target.webSocketDebuggerUrl,
      };
    } catch {
      return null;
    }
  }

  /**
   * Merge CDP targets with SDK-connected tab metadata.
   *
   * For each CDP target, checks if any SDK tab has a matching URL.
   * If so, sets hasSDK=true and sdkTabId on the target.
   */
  mergeWithSDKTabs(
    cdpTargets: CDPTarget[],
    sdkTabMetadata: Map<string, { url: string }>
  ): CDPTarget[] {
    // Build a URL → tabId lookup from SDK tabs
    const urlToTabId = new Map<string, string>();
    for (const [tabId, meta] of sdkTabMetadata) {
      if (meta.url) {
        urlToTabId.set(meta.url, tabId);
      }
    }

    return cdpTargets.map((target) => {
      const sdkTabId = urlToTabId.get(target.url);
      if (sdkTabId) {
        return { ...target, hasSDK: true, sdkTabId };
      }
      return { ...target, hasSDK: false };
    });
  }
}
