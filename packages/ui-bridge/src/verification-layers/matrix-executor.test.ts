/**
 * Matrix Executor & API Executor Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MatrixExecutor } from './matrix-executor';
import { ApiLayerExecutor } from './api-executor';
import type { ExecutionMatrix, LayeredAssertion, ApiAssertion } from './types';

// Mock the sub-executors that need browser/Tauri — use real classes
vi.mock('./ui-executor', () => {
  const MockUiLayerExecutor = class {
    updateElements = vi.fn();
    execute = vi.fn().mockResolvedValue({
      assertionId: 'ui-1',
      layer: 'ui',
      passed: true,
      details: { type: 'ui', assertionResult: { passed: true } },
      durationMs: 10,
    });
  };
  return { UiLayerExecutor: MockUiLayerExecutor };
});

vi.mock('./ipc-executor', () => {
  const MockIpcLayerExecutor = class {
    executeFs = vi.fn().mockResolvedValue({
      assertionId: 'fs-1',
      layer: 'fs',
      passed: true,
      details: { type: 'fs', exists: true },
      durationMs: 5,
    });
    executeDb = vi.fn().mockResolvedValue({
      assertionId: 'db-1',
      layer: 'db',
      passed: true,
      details: { type: 'db', rowCount: 1 },
      durationMs: 5,
    });
  };
  return { IpcLayerExecutor: MockIpcLayerExecutor };
});

// =============================================================================
// MatrixExecutor
// =============================================================================

describe('MatrixExecutor', () => {
  let matrixExecutor: MatrixExecutor;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    matrixExecutor = new MatrixExecutor();
    fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      statusText: 'OK',
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeApiAssertion(id: string): LayeredAssertion {
    return {
      id,
      description: `API check ${id}`,
      layer: 'api',
      assertion: {
        type: 'api',
        endpoint: 'http://localhost:3000/api/test',
        method: 'GET',
        expectedStatus: 200,
      },
    };
  }

  function makeUiAssertion(id: string): LayeredAssertion {
    return {
      id,
      description: `UI check ${id}`,
      layer: 'ui',
      assertion: {
        type: 'ui',
        assertion: {
          id: `spec-${id}`,
          description: 'Test',
          category: 'element-presence' as const,
          severity: 'info' as const,
          target: { type: 'elementId' as const, elementId: 'el1' },
          assertionType: 'visible' as const,
          source: 'manual' as const,
          reviewed: true,
          enabled: true,
        },
      },
    };
  }

  function makeMatrix(
    strategy: 'parallel' | 'sequential' | 'ui-first',
    layers: LayeredAssertion[]
  ): ExecutionMatrix {
    return {
      id: 'matrix-1',
      name: 'Test Matrix',
      layers,
      strategy,
    };
  }

  describe('parallel strategy', () => {
    it('should run all assertions and return aggregated results', async () => {
      const matrix = makeMatrix('parallel', [
        makeApiAssertion('api-1'),
        makeApiAssertion('api-2'),
        makeUiAssertion('ui-1'),
      ]);

      const result = await matrixExecutor.execute(matrix);
      expect(result.totalAssertions).toBe(3);
      expect(result.overallPassed).toBe(true);
      expect(result.passedCount).toBe(3);
      expect(result.failedCount).toBe(0);
      expect(result.strategy).toBe('parallel');
    });
  });

  describe('sequential strategy', () => {
    it('should run assertions one by one', async () => {
      const callOrder: string[] = [];
      fetchMock.mockImplementation(async () => {
        callOrder.push('api');
        return { status: 200, ok: true, statusText: 'OK', json: async () => ({}) };
      });

      const matrix = makeMatrix('sequential', [
        makeApiAssertion('api-1'),
        makeApiAssertion('api-2'),
      ]);

      const result = await matrixExecutor.execute(matrix);
      expect(result.totalAssertions).toBe(2);
      expect(result.overallPassed).toBe(true);
      // Both API calls should have been made
      expect(callOrder).toHaveLength(2);
    });
  });

  describe('ui-first strategy', () => {
    it('should run UI assertions first, then others', async () => {
      const matrix = makeMatrix('ui-first', [
        makeApiAssertion('api-1'),
        makeUiAssertion('ui-1'),
        makeUiAssertion('ui-2'),
      ]);

      const result = await matrixExecutor.execute(matrix);
      expect(result.totalAssertions).toBe(3);
      expect(result.overallPassed).toBe(true);
    });
  });

  describe('layer summaries', () => {
    it('should aggregate results by layer', async () => {
      const matrix = makeMatrix('parallel', [
        makeApiAssertion('api-1'),
        makeApiAssertion('api-2'),
        makeUiAssertion('ui-1'),
      ]);

      const result = await matrixExecutor.execute(matrix);
      expect(result.layerSummaries.length).toBeGreaterThanOrEqual(2);

      const apiSummary = result.layerSummaries.find((s) => s.layer === 'api');
      expect(apiSummary).toBeDefined();
      expect(apiSummary!.totalAssertions).toBe(2);
      expect(apiSummary!.passedCount).toBe(2);

      const uiSummary = result.layerSummaries.find((s) => s.layer === 'ui');
      expect(uiSummary).toBeDefined();
      expect(uiSummary!.totalAssertions).toBe(1);
    });
  });

  describe('overall pass/fail', () => {
    it('should report overallPassed=false when any assertion fails', async () => {
      fetchMock.mockResolvedValue({
        status: 500,
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      });

      const matrix = makeMatrix('parallel', [
        {
          id: 'api-fail',
          description: 'Failing API check',
          layer: 'api',
          assertion: {
            type: 'api' as const,
            endpoint: 'http://localhost:3000/api/fail',
            method: 'GET' as const,
            expectedStatus: 200,
          },
        },
      ]);

      const result = await matrixExecutor.execute(matrix);
      expect(result.overallPassed).toBe(false);
      expect(result.failedCount).toBe(1);
    });
  });
});

// =============================================================================
// ApiLayerExecutor
// =============================================================================

describe('ApiLayerExecutor', () => {
  let apiExecutor: ApiLayerExecutor;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    apiExecutor = new ApiLayerExecutor();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('successful response matching expectedStatus', () => {
    it('should pass when status matches expectedStatus', async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        ok: true,
        statusText: 'OK',
        json: async () => ({ data: 'ok' }),
      });

      const assertion: ApiAssertion = {
        type: 'api',
        endpoint: 'http://localhost:3000/api/test',
        method: 'GET',
        expectedStatus: 200,
      };

      const result = await apiExecutor.execute('a1', assertion);
      expect(result.passed).toBe(true);
      expect(result.layer).toBe('api');
      expect(result.details.type).toBe('api');
      if (result.details.type === 'api') {
        expect(result.details.status).toBe(200);
      }
    });

    it('should fail when status does not match expectedStatus', async () => {
      fetchMock.mockResolvedValue({
        status: 404,
        ok: false,
        statusText: 'Not Found',
        json: async () => ({}),
      });

      const assertion: ApiAssertion = {
        type: 'api',
        endpoint: 'http://localhost:3000/api/missing',
        method: 'GET',
        expectedStatus: 200,
      };

      const result = await apiExecutor.execute('a1', assertion);
      expect(result.passed).toBe(false);
    });
  });

  describe('body path assertions with expectedBody', () => {
    it('should pass when body paths match expected values', async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        ok: true,
        statusText: 'OK',
        json: async () => ({ user: { name: 'Alice', role: 'admin' } }),
      });

      const assertion: ApiAssertion = {
        type: 'api',
        endpoint: 'http://localhost:3000/api/user',
        method: 'GET',
        expectedStatus: 200,
        expectedBody: {
          'user.name': 'Alice',
          'user.role': 'admin',
        },
      };

      const result = await apiExecutor.execute('a1', assertion);
      expect(result.passed).toBe(true);
      if (result.details.type === 'api' && result.details.bodyMatches) {
        expect(result.details.bodyMatches['user.name'].matched).toBe(true);
        expect(result.details.bodyMatches['user.role'].matched).toBe(true);
      }
    });

    it('should fail when body path does not match', async () => {
      fetchMock.mockResolvedValue({
        status: 200,
        ok: true,
        statusText: 'OK',
        json: async () => ({ user: { name: 'Bob' } }),
      });

      const assertion: ApiAssertion = {
        type: 'api',
        endpoint: 'http://localhost:3000/api/user',
        method: 'GET',
        expectedStatus: 200,
        expectedBody: {
          'user.name': 'Alice',
        },
      };

      const result = await apiExecutor.execute('a1', assertion);
      expect(result.passed).toBe(false);
      if (result.details.type === 'api' && result.details.bodyMatches) {
        expect(result.details.bodyMatches['user.name'].matched).toBe(false);
        expect(result.details.bodyMatches['user.name'].actual).toBe('Bob');
      }
    });
  });

  describe('timeout handling', () => {
    it('should fail with error when request times out', async () => {
      fetchMock.mockImplementation(async (_url: string, opts: { signal: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      });

      const assertion: ApiAssertion = {
        type: 'api',
        endpoint: 'http://localhost:3000/api/slow',
        method: 'GET',
        timeout: 10, // 10ms timeout
      };

      const result = await apiExecutor.execute('a1', assertion);
      expect(result.passed).toBe(false);
      expect(result.details.type).toBe('api');
      if (result.details.type === 'api') {
        expect(result.details.status).toBe(0);
      }
    });
  });

  describe('network error handling', () => {
    it('should fail gracefully on network error', async () => {
      fetchMock.mockRejectedValue(new Error('Network error'));

      const assertion: ApiAssertion = {
        type: 'api',
        endpoint: 'http://localhost:3000/api/down',
        method: 'GET',
      };

      const result = await apiExecutor.execute('a1', assertion);
      expect(result.passed).toBe(false);
      expect(result.details.type).toBe('api');
      if (result.details.type === 'api') {
        expect(result.details.status).toBe(0);
        expect(result.details.statusText).toContain('Network error');
      }
    });
  });

  describe('base URL resolution', () => {
    it('should prepend baseUrl for relative endpoints', async () => {
      const executorWithBase = new ApiLayerExecutor({ baseUrl: 'http://localhost:3000' });
      fetchMock.mockResolvedValue({
        status: 200,
        ok: true,
        statusText: 'OK',
        json: async () => ({}),
      });

      const assertion: ApiAssertion = {
        type: 'api',
        endpoint: '/api/test',
        method: 'GET',
        expectedStatus: 200,
      };

      await executorWithBase.execute('a1', assertion);
      expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/test', expect.any(Object));
    });

    it('should not prepend baseUrl for absolute endpoints', async () => {
      const executorWithBase = new ApiLayerExecutor({ baseUrl: 'http://localhost:3000' });
      fetchMock.mockResolvedValue({
        status: 200,
        ok: true,
        statusText: 'OK',
        json: async () => ({}),
      });

      const assertion: ApiAssertion = {
        type: 'api',
        endpoint: 'http://external.com/api/test',
        method: 'GET',
        expectedStatus: 200,
      };

      await executorWithBase.execute('a1', assertion);
      expect(fetchMock).toHaveBeenCalledWith('http://external.com/api/test', expect.any(Object));
    });
  });
});
