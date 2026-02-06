import type { Annotation, ElementSummary, CoverageStats } from '../shared/types';
import { STORAGE_KEYS } from '../shared/constants';

/** Prefix for individual annotation keys in chrome.storage.local */
const LOCAL_ANNOTATION_PREFIX = 'uib-annotation-';

/**
 * HTTP client for communicating with the UI Bridge server.
 * All endpoints return parsed JSON with the `.data` field extracted.
 *
 * When the server does not support annotation endpoints (older versions),
 * the client falls back to `chrome.storage.local` for annotation storage.
 */
export class BridgeClient {
  private serverUrl: string;

  /** Whether the server supports annotation endpoints. */
  supportsAnnotations = false;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
  }

  /** Update the server URL */
  setServerUrl(url: string): void {
    this.serverUrl = url.replace(/\/+$/, '');
    // Reset capability flag -- will be re-probed on next detectServer()
    this.supportsAnnotations = false;
  }

  /**
   * Check if the UI Bridge server is reachable.
   * Also probes the annotations endpoint to determine whether the server
   * supports annotations natively.
   */
  async detectServer(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        this.supportsAnnotations = false;
        return false;
      }

      // Probe annotation support
      this.supportsAnnotations = await this.probeAnnotationSupport();
      return true;
    } catch {
      this.supportsAnnotations = false;
      return false;
    }
  }

  // ── Public annotation API (delegates to server or local) ──

  /** Fetch a single annotation by element ID */
  async getAnnotation(id: string): Promise<Annotation | null> {
    if (!this.supportsAnnotations) {
      return this.getAnnotationLocal(id);
    }
    try {
      return await this.request<Annotation>(
        'GET',
        `/ui-bridge/annotations/${encodeURIComponent(id)}`
      );
    } catch {
      return null;
    }
  }

  /** Create or update an annotation */
  async setAnnotation(id: string, annotation: Annotation): Promise<Annotation> {
    if (!this.supportsAnnotations) {
      return this.setAnnotationLocal(id, annotation);
    }
    return this.request<Annotation>(
      'PUT',
      `/ui-bridge/annotations/${encodeURIComponent(id)}`,
      annotation
    );
  }

  /** Delete an annotation */
  async deleteAnnotation(id: string): Promise<void> {
    if (!this.supportsAnnotations) {
      return this.deleteAnnotationLocal(id);
    }
    await this.request<void>('DELETE', `/ui-bridge/annotations/${encodeURIComponent(id)}`);
  }

  /** Fetch all annotations */
  async getAnnotations(): Promise<Record<string, Annotation>> {
    if (!this.supportsAnnotations) {
      return this.getAnnotationsLocal();
    }
    return this.request<Record<string, Annotation>>('GET', '/ui-bridge/annotations');
  }

  // ── Non-annotation server methods (no fallback needed) ──

  /** Fetch all UI elements from the bridge */
  async getElements(): Promise<ElementSummary[]> {
    return this.request<ElementSummary[]>('GET', '/ui-bridge/control/elements');
  }

  /** Export all annotations as a config object */
  async exportAnnotations(): Promise<unknown> {
    if (!this.supportsAnnotations) {
      // Export from local storage
      const annotations = await this.getAnnotationsLocal();
      return { annotations };
    }
    return this.request<unknown>('GET', '/ui-bridge/annotations/export');
  }

  /** Import annotations from a config object */
  async importAnnotations(config: unknown): Promise<unknown> {
    if (!this.supportsAnnotations) {
      // Import into local storage
      const cfg = config as { annotations?: Record<string, Annotation> };
      if (cfg?.annotations) {
        for (const [id, annotation] of Object.entries(cfg.annotations)) {
          await this.setAnnotationLocal(id, annotation);
        }
      }
      return { imported: Object.keys(cfg?.annotations ?? {}).length };
    }
    return this.request<unknown>('POST', '/ui-bridge/annotations/import', config);
  }

  /** Get annotation coverage statistics */
  async getCoverage(): Promise<CoverageStats> {
    if (!this.supportsAnnotations) {
      // Compute from local data + elements
      try {
        const elements = await this.getElements();
        const annotations = await this.getAnnotationsLocal();
        const total = elements.length;
        const annotated = elements.filter((e) => e.id in annotations).length;
        return {
          total,
          annotated,
          percent: total > 0 ? Math.round((annotated / total) * 100) : 0,
        };
      } catch {
        return { total: 0, annotated: 0, percent: 0 };
      }
    }
    return this.request<CoverageStats>('GET', '/ui-bridge/annotations/coverage');
  }

  // ── Local storage fallback methods ──

  /** Read a single annotation from chrome.storage.local */
  async getAnnotationLocal(id: string): Promise<Annotation | null> {
    try {
      const key = LOCAL_ANNOTATION_PREFIX + id;
      const result = await chrome.storage.local.get(key);
      return (result[key] as Annotation) ?? null;
    } catch {
      return null;
    }
  }

  /** Write an annotation to chrome.storage.local */
  async setAnnotationLocal(id: string, annotation: Annotation): Promise<Annotation> {
    const key = LOCAL_ANNOTATION_PREFIX + id;
    const stored: Annotation = { ...annotation, updatedAt: Date.now() };
    await chrome.storage.local.set({ [key]: stored });

    // Also maintain the index so getAnnotationsLocal can find all keys
    await this.addToAnnotationIndex(id);

    return stored;
  }

  /** Remove an annotation from chrome.storage.local */
  async deleteAnnotationLocal(id: string): Promise<void> {
    const key = LOCAL_ANNOTATION_PREFIX + id;
    await chrome.storage.local.remove(key);
    await this.removeFromAnnotationIndex(id);
  }

  /** Read all annotations from chrome.storage.local */
  async getAnnotationsLocal(): Promise<Record<string, Annotation>> {
    try {
      const index = await this.getAnnotationIndex();
      if (index.length === 0) return {};

      const keys = index.map((id) => LOCAL_ANNOTATION_PREFIX + id);
      const result = await chrome.storage.local.get(keys);

      const annotations: Record<string, Annotation> = {};
      for (const id of index) {
        const key = LOCAL_ANNOTATION_PREFIX + id;
        if (result[key]) {
          annotations[id] = result[key] as Annotation;
        }
      }
      return annotations;
    } catch {
      return {};
    }
  }

  // ── Private helpers ──

  /**
   * Probe whether the server supports the annotations endpoint.
   * Sends a GET to /ui-bridge/annotations and treats 404 or network
   * failure as "not supported".
   */
  private async probeAnnotationSupport(): Promise<boolean> {
    try {
      const response = await fetch(`${this.serverUrl}/ui-bridge/annotations`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      // 404 or 405 means the endpoint doesn't exist on this server version
      if (response.status === 404 || response.status === 405) {
        return false;
      }
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Maintain an index of annotation IDs in chrome.storage.local so we can
   * enumerate them without scanning all keys (chrome.storage.local has no
   * prefix-scan API).
   */
  private async getAnnotationIndex(): Promise<string[]> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEYS.localAnnotations);
      const index = result[STORAGE_KEYS.localAnnotations];
      return Array.isArray(index) ? (index as string[]) : [];
    } catch {
      return [];
    }
  }

  private async addToAnnotationIndex(id: string): Promise<void> {
    const index = await this.getAnnotationIndex();
    if (!index.includes(id)) {
      index.push(id);
      await chrome.storage.local.set({ [STORAGE_KEYS.localAnnotations]: index });
    }
  }

  private async removeFromAnnotationIndex(id: string): Promise<void> {
    const index = await this.getAnnotationIndex();
    const filtered = index.filter((x) => x !== id);
    if (filtered.length !== index.length) {
      await chrome.storage.local.set({ [STORAGE_KEYS.localAnnotations]: filtered });
    }
  }

  /** Generic request helper that extracts `.data` from the JSON response */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.serverUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `UI Bridge request failed: ${method} ${path} - ${response.status} ${response.statusText}${text ? `: ${text}` : ''}`
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    const json = await response.json();

    // Extract .data if present, otherwise return the full response
    if (json && typeof json === 'object' && 'data' in json) {
      return json.data as T;
    }

    return json as T;
  }
}
