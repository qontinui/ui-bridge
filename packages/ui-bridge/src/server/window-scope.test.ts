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
  const readValue = vi.fn().mockResolvedValue({ success: true, data: { value: '', length: 0 } });
  const typeInto = vi.fn().mockResolvedValue({ success: true, data: { typed: true } });
  const clickByText = vi.fn().mockResolvedValue({ success: true, data: { clicked: true } });
  const clickBySelector = vi.fn().mockResolvedValue({ success: true, data: { clicked: true } });
  const findByText = vi.fn().mockResolvedValue({ success: true, data: [] });
  const handlers = {
    pageEvaluate,
    getElements,
    executeElementAction,
    readValue,
    typeInto,
    clickByText,
    clickBySelector,
    findByText,
  } as unknown as UIBridgeServerHandlers;
  return {
    handlers,
    pageEvaluate,
    getElements,
    executeElementAction,
    readValue,
    typeInto,
    clickByText,
    clickBySelector,
    findByText,
  };
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

describe('windowScope — read/convenience family (Phase 4)', () => {
  it('readValue() injects windowLabel', async () => {
    const { handlers, readValue } = stubHandlers();
    await windowScope(handlers, 'term-2').readValue({ selector: 'input' });
    expect(readValue.mock.calls[0]![0]).toEqual({ selector: 'input', windowLabel: 'term-2' });
  });

  it('typeInto() injects windowLabel', async () => {
    const { handlers, typeInto } = stubHandlers();
    await windowScope(handlers, 'term-2').typeInto({ selector: 'input', text: 'hi' });
    expect(typeInto.mock.calls[0]![0]).toEqual({
      selector: 'input',
      text: 'hi',
      windowLabel: 'term-2',
    });
  });

  it('clickByText() injects windowLabel', async () => {
    const { handlers, clickByText } = stubHandlers();
    await windowScope(handlers, 'term-2').clickByText({ text: 'Save' });
    expect(clickByText.mock.calls[0]![0]).toEqual({ text: 'Save', windowLabel: 'term-2' });
  });

  it('clickBySelector() injects windowLabel', async () => {
    const { handlers, clickBySelector } = stubHandlers();
    await windowScope(handlers, 'term-2').clickBySelector({ selector: '.btn' });
    expect(clickBySelector.mock.calls[0]![0]).toEqual({ selector: '.btn', windowLabel: 'term-2' });
  });

  it('findByText() injects windowLabel', async () => {
    const { handlers, findByText } = stubHandlers();
    await windowScope(handlers, 'term-2').findByText({ text: 'Save' });
    expect(findByText.mock.calls[0]![0]).toEqual({ text: 'Save', windowLabel: 'term-2' });
  });
});
