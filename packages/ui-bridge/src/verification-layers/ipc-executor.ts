/**
 * IPC Layer Executor
 *
 * Executes filesystem and database assertions via Tauri IPC.
 * Only works in a Tauri (runner) context. Returns failures in browser-only environments.
 */

import type {
  FsAssertion,
  DbAssertion,
  LayerAssertionResult,
  FsLayerResult,
  DbLayerResult,
} from './types';

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function getTauriInvoke(): TauriInvoke | null {
  try {
    if (typeof window !== 'undefined' && '__TAURI__' in window) {
      const tauri = (window as Record<string, unknown>).__TAURI__ as Record<string, unknown>;
      const core = tauri.core as Record<string, unknown> | undefined;
      if (core && typeof core.invoke === 'function') {
        return core.invoke as TauriInvoke;
      }
    }
  } catch {
    // Not in Tauri
  }
  return null;
}

export class IpcLayerExecutor {
  private invoke: TauriInvoke | null;

  constructor() {
    this.invoke = getTauriInvoke();
  }

  get isAvailable(): boolean {
    return this.invoke !== null;
  }

  async executeFs(id: string, assertion: FsAssertion): Promise<LayerAssertionResult> {
    const startTime = Date.now();

    if (!this.invoke) {
      return {
        assertionId: id,
        layer: 'fs',
        passed: false,
        details: { type: 'fs', exists: false } satisfies FsLayerResult,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const result = await this.invoke('plugin:ui-bridge|fs_assert', {
        path: assertion.path,
        check: assertion.check,
        expected: assertion.expected,
      }) as { passed: boolean; exists: boolean; content?: string; size?: number };

      const details: FsLayerResult = {
        type: 'fs',
        exists: result.exists,
        content: result.content,
        size: result.size,
      };

      return {
        assertionId: id,
        layer: 'fs',
        passed: result.passed,
        details,
        durationMs: Date.now() - startTime,
      };
    } catch {
      return {
        assertionId: id,
        layer: 'fs',
        passed: false,
        details: { type: 'fs', exists: false } satisfies FsLayerResult,
        durationMs: Date.now() - startTime,
      };
    }
  }

  async executeDb(id: string, assertion: DbAssertion): Promise<LayerAssertionResult> {
    const startTime = Date.now();

    if (!this.invoke) {
      return {
        assertionId: id,
        layer: 'db',
        passed: false,
        details: { type: 'db', rowCount: 0 } satisfies DbLayerResult,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const result = await this.invoke('plugin:ui-bridge|db_assert', {
        query: assertion.query,
        connectionRef: assertion.connectionRef,
        expectedRows: assertion.expectedRows,
        expectedValues: assertion.expectedValues,
      }) as { passed: boolean; rowCount: number; rows?: Record<string, unknown>[] };

      const details: DbLayerResult = {
        type: 'db',
        rowCount: result.rowCount,
        rows: result.rows,
      };

      return {
        assertionId: id,
        layer: 'db',
        passed: result.passed,
        details,
        durationMs: Date.now() - startTime,
      };
    } catch {
      return {
        assertionId: id,
        layer: 'db',
        passed: false,
        details: { type: 'db', rowCount: 0 } satisfies DbLayerResult,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
