/**
 * The DIRECT transport's `executeWithDiff` answers with the action's verdict.
 *
 * THE DEFECT these tests pin down: `createHandlers`' `executeWithDiff` returned
 * `success(result)` for any action that returned, so a failed action came back
 * as `{ success: true, data: { actionSuccess: false, … } }` — the same
 * double-wrap `executeElementAction` shed in 81bf703, on another handler. The
 * runner's `/ui-bridge/sdk/ai/execute-with-diff` passes the body through, so
 * every caller was told the action worked.
 *
 * The envelope now fails when `actionSuccess` is not `true`, and the full
 * result stays under `data` — the diff around a failed action is diagnostic.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from '../control/action-executor';
import type { ActionDiffResult } from '../ai';

beforeAll(() => {
  if (typeof document !== 'undefined' && !document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => null,
    });
  }
});

/** Keep the settle window short — these tests are about the verdict. */
const FAST = { settleTimeout: 50, settleMinStable: 5 };

describe('direct executeWithDiff · a failed action is an OUTER failure', () => {
  let registry: UIBridgeRegistry;
  let handlers: ReturnType<typeof createHandlers>;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    const executor = new DefaultActionExecutor(registry);
    handlers = createHandlers(registry as unknown as RegistryLike, executor as never);
    container = document.createElement('div');
    document.body.appendChild(container);
    registry.registerElement('pane', container, {
      type: 'custom',
      customActions: {
        write: { id: 'write', handler: () => ({ bytesWritten: 3 }) },
        writeDead: {
          id: 'writeDead',
          handler: () => {
            throw Object.assign(new Error('terminal has exited'), { code: 'TERMINAL_EXITED' });
          },
        },
      },
    });
  });

  afterEach(() => {
    container.remove();
    registry.clear();
  });

  it('actionSuccess false → outer failure carrying the inner error, data kept', async () => {
    const result = await handlers.executeWithDiff!({
      elementAction: { elementId: 'pane', action: 'writeDead' },
      ...FAST,
    });

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('terminal has exited');
    // The handler's own vocabulary, propagated verbatim.
    expect(result.code).toBe('TERMINAL_EXITED');
    const data = result.data as ActionDiffResult;
    expect(data.actionSuccess).toBe(false);
    expect((data.actionResult as { success?: unknown }).success).toBe(false);
    expect(data.diff).toBeDefined();
    expect(data.beforeSnapshot).toBeDefined();
  });

  it('actionSuccess true → outer success', async () => {
    const result = await handlers.executeWithDiff!({
      elementAction: { elementId: 'pane', action: 'write' },
      ...FAST,
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect((result.data as ActionDiffResult).actionSuccess).toBe(true);
  });

  it('an action result with no verdict is a failure, never a success', async () => {
    const verdictless = {
      executeAction: async () => ({ elementState: {} }),
    };
    const h = createHandlers(registry as unknown as RegistryLike, verdictless as never);

    const result = await h.executeWithDiff!({
      elementAction: { elementId: 'pane', action: 'write' },
      ...FAST,
    });

    expect(result.success).toBe(false);
    expect(String(result.error).length).toBeGreaterThan(0);
    expect(String(result.code).length).toBeGreaterThan(0);
    expect((result.data as ActionDiffResult).actionSuccess).toBe(false);
  });
});
