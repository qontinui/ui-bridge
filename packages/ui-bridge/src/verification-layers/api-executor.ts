/**
 * API Layer Executor
 *
 * Executes HTTP assertions for the API verification layer.
 * Works in both browser and server contexts via fetch().
 */

import type { ApiAssertion, LayerAssertionResult, ApiLayerResult } from './types';

const DEFAULT_TIMEOUT = 10000;

export class ApiLayerExecutor {
  private baseUrl?: string;

  constructor(options?: { baseUrl?: string }) {
    this.baseUrl = options?.baseUrl;
  }

  async execute(id: string, assertion: ApiAssertion): Promise<LayerAssertionResult> {
    const startTime = Date.now();

    const url =
      this.baseUrl && !assertion.endpoint.startsWith('http')
        ? `${this.baseUrl}${assertion.endpoint}`
        : assertion.endpoint;

    try {
      const controller = new AbortController();
      const timeout = assertion.timeout ?? DEFAULT_TIMEOUT;
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error(`Unsafe protocol: ${parsedUrl.protocol}`);
      }

      const response = await fetch(url, {
        method: assertion.method,
        headers: assertion.headers,
        body: assertion.body ? JSON.stringify(assertion.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        // Response may not be JSON
      }

      // Check status
      let passed = true;
      if (assertion.expectedStatus !== undefined) {
        passed = response.status === assertion.expectedStatus;
      }

      // Check body paths
      let bodyMatches:
        | Record<string, { expected: unknown; actual: unknown; matched: boolean }>
        | undefined;
      if (passed && assertion.expectedBody && body && typeof body === 'object') {
        bodyMatches = {};
        for (const [path, expected] of Object.entries(assertion.expectedBody)) {
          const actual = getNestedValue(body as Record<string, unknown>, path);
          const matched = JSON.stringify(actual) === JSON.stringify(expected);
          bodyMatches[path] = { expected, actual, matched };
          if (!matched) passed = false;
        }
      }

      const details: ApiLayerResult = {
        type: 'api',
        status: response.status,
        statusText: response.statusText,
        body,
        bodyMatches,
      };

      return {
        assertionId: id,
        layer: 'api',
        passed,
        details,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const details: ApiLayerResult = {
        type: 'api',
        status: 0,
        statusText: error instanceof Error ? error.message : 'Unknown error',
      };

      return {
        assertionId: id,
        layer: 'api',
        passed: false,
        details,
        durationMs: Date.now() - startTime,
      };
    }
  }
}

/**
 * Get a nested value from an object using dot-path notation.
 * e.g., getNestedValue({ a: { b: 1 } }, 'a.b') === 1
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
