/**
 * Network Capture Sub-module
 *
 * Wraps window.fetch to emit events on failure only (4xx/5xx, network error,
 * timeout, CORS, abort). Coexists with other fetch wrappers (e.g., DevDebugLogger)
 * by chaining rather than replacing.
 */

import type { NetworkCapturedEvent, AnyCapturedEvent } from '../browser-capture-types';

type Emit = (event: AnyCapturedEvent) => void;

interface NetworkOptions {
  ignorePatterns?: string[];
}

const DEFAULT_IGNORE = ['/api/dev-debug/', '/api/ui-bridge/', 'localhost:9876'];

export function installNetworkCapture(emit: Emit, options?: NetworkOptions): () => void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return () => {};
  }

  const originalFetch = window.fetch;
  const ignorePatterns = options?.ignorePatterns ?? DEFAULT_IGNORE;

  function shouldIgnore(url: string): boolean {
    return ignorePatterns.some((p) => url.includes(p));
  }

  function getMethod(input: RequestInfo | URL, init?: RequestInit): string {
    if (init?.method) return init.method.toUpperCase();
    if (input instanceof Request) return input.method.toUpperCase();
    return 'GET';
  }

  function getUrl(input: RequestInfo | URL): string {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    if (input instanceof Request) return input.url;
    return String(input);
  }

  window.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const requestUrl = getUrl(input);
    if (shouldIgnore(requestUrl)) {
      return originalFetch.call(window, input, init);
    }

    const method = getMethod(input, init);
    const start = performance.now();

    try {
      const response = await originalFetch.call(window, input, init);
      const durationMs = Math.round(performance.now() - start);

      if (response.status >= 400) {
        const event: NetworkCapturedEvent = {
          type: 'network',
          timestamp: Date.now(),
          url: typeof window !== 'undefined' ? window.location.href : '',
          method,
          requestUrl,
          status: response.status,
          statusText: response.statusText,
          durationMs,
          kind: 'http-error',
        };
        emit(event);
      }

      return response;
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const errorMessage = err instanceof Error ? err.message : String(err);

      let kind: NetworkCapturedEvent['kind'] = 'network-error';
      if (err instanceof DOMException && err.name === 'AbortError') {
        kind = 'abort';
      } else if (errorMessage.includes('CORS') || errorMessage.includes('cross-origin')) {
        kind = 'cors';
      } else if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
        kind = 'timeout';
      }

      const event: NetworkCapturedEvent = {
        type: 'network',
        timestamp: Date.now(),
        url: typeof window !== 'undefined' ? window.location.href : '',
        method,
        requestUrl,
        durationMs,
        kind,
        errorMessage,
      };
      emit(event);

      throw err;
    }
  };

  return () => {
    window.fetch = originalFetch;
  };
}
