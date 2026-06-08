/**
 * Phase 3 (plan 2026-06-07-multi-window-sdk-automation) — window-scoped facade.
 *
 * Asserts the facade is pure sugar over the Phase-1 per-call option: each scoped
 * method delegates to the matching handler with `windowLabel` injected, and the
 * delegated payload is otherwise byte-identical to a bare call.
 */

import { describe, expect, it, vi } from 'vitest';
import { windowScope } from './window-scope';
import type { UIBridgeServerHandlers } from './types';

function stubHandlers() {
  const pageEvaluate = vi.fn().mockResolvedValue({ success: true, data: 'ok' });
  const getElements = vi.fn().mockResolvedValue({ success: true, data: [] });
  const executeElementAction = vi.fn().mockResolvedValue({ success: true, data: {} });
  const handlers = {
    pageEvaluate,
    getElements,
    executeElementAction,
  } as unknown as UIBridgeServerHandlers;
  return { handlers, pageEvaluate, getElements, executeElementAction };
}

describe('windowScope — pre-binds windowLabel (Phase 3)', () => {
  it('exposes the bound windowLabel', () => {
    const { handlers } = stubHandlers();
    expect(windowScope(handlers, 'term-2').windowLabel).toBe('term-2');
  });

  it('evaluate() injects windowLabel into pageEvaluate', async () => {
    const { handlers, pageEvaluate } = stubHandlers();
    await windowScope(handlers, 'term-2').evaluate({ expression: 'document.title' });
    expect(pageEvaluate).toHaveBeenCalledTimes(1);
    expect(pageEvaluate.mock.calls[0]![0]).toEqual({
      expression: 'document.title',
      windowLabel: 'term-2',
    });
  });

  it('getElements() injects windowLabel into the options bag', async () => {
    const { handlers, getElements } = stubHandlers();
    await windowScope(handlers, 'term-2').getElements({ text: 'Save' });
    expect(getElements).toHaveBeenCalledTimes(1);
    expect(getElements.mock.calls[0]![0]).toEqual({ text: 'Save', windowLabel: 'term-2' });
  });

  it('getElements() with no options still injects windowLabel', async () => {
    const { handlers, getElements } = stubHandlers();
    await windowScope(handlers, 'term-2').getElements();
    expect(getElements.mock.calls[0]![0]).toEqual({ windowLabel: 'term-2' });
  });

  it('executeAction() injects windowLabel into the request bag', async () => {
    const { handlers, executeElementAction } = stubHandlers();
    await windowScope(handlers, 'term-2').executeAction('btn-save', { action: 'click' });
    expect(executeElementAction).toHaveBeenCalledTimes(1);
    expect(executeElementAction.mock.calls[0]![0]).toBe('btn-save');
    expect(executeElementAction.mock.calls[0]![1]).toEqual({
      action: 'click',
      windowLabel: 'term-2',
    });
  });

  it('forwards the optional context argument unchanged', async () => {
    const { handlers, pageEvaluate } = stubHandlers();
    const ctx = { callerUserId: 'u1' } as never;
    await windowScope(handlers, 'term-2').evaluate({ expression: '1+1' }, ctx);
    expect(pageEvaluate.mock.calls[0]![1]).toBe(ctx);
  });

  it('is byte-identical to a bare call with windowLabel (one code path)', async () => {
    const { handlers, pageEvaluate } = stubHandlers();
    // bare call
    await handlers.pageEvaluate({ expression: 'x', windowLabel: 'term-2' });
    // scoped call
    await windowScope(handlers, 'term-2').evaluate({ expression: 'x' });
    expect(pageEvaluate.mock.calls[0]![0]).toEqual(pageEvaluate.mock.calls[1]![0]);
  });
});
