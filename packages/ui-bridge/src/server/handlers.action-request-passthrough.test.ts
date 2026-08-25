/**
 * Regression: the exported action handler must forward the WHOLE request.
 *
 * `POST /control/element/:id/action` is the one seam every transport lands on
 * — the Express/Next/standalone adapters, the WebSocket handler, the window
 * scoper. It used to reconstruct the request field-by-field
 * (`{ action, params, waitOptions }`), so every option added to
 * `ControlActionRequest` afterwards was silently dropped on the floor here.
 *
 * That failure mode is specifically nasty and specifically invisible:
 *
 *   - The caller opts in (`fromSnapshotId`, `includeResolutionAlternates`, …).
 *   - The field never reaches `DefaultActionExecutor.executeAction`.
 *   - The executor does the default thing.
 *   - The response comes back `success: true`.
 *
 * A guarantee that reports success without being checked is worse than no
 * guarantee at all, because it is believed. Type-checking cannot catch it (the
 * narrowed literal was assignable), and neither can a unit test of the
 * executor — which is exactly how it survived a full green suite.
 *
 * So these tests deliberately go through `createHandlers`, not through the
 * executor: the defect lived in the mile of wire between them.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { createHandlers, type RegistryLike } from './handlers';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from '../control/action-executor';
import type { ControlActionRequest, ControlActionResponse } from '../control/types';

beforeAll(() => {
  if (typeof document !== 'undefined' && !document.elementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => null,
    });
  }
});

describe('executeElementAction handler — whole-request pass-through', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let handlers: ReturnType<typeof createHandlers>;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    handlers = createHandlers(registry as unknown as RegistryLike, executor as never);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function addButton(id: string, text = 'Save'): HTMLButtonElement {
    const el = document.createElement('button');
    el.textContent = text;
    container.appendChild(el);
    registry.registerElement(id, el, { type: 'button' });
    return el;
  }

  /** Same-shape remount: same id, same rendered text, a later mount. */
  function remount(id: string, text = 'Save'): HTMLButtonElement {
    const previous = registry.getElement(id)!.registeredAt;
    registry.unregisterElement(id);
    const el = addButton(id, text);
    registry.getElement(id)!.registeredAt = previous + 10_000;
    return el;
  }

  it('carries fromSnapshotId through the handler and REFUSES the stale action', async () => {
    // The end-to-end shape of the defect: before the fix this returned
    // `success: true` and clicked, because the handler never forwarded the id.
    const el = addButton('btn');
    let clicks = 0;
    el.addEventListener('click', () => {
      clicks++;
    });
    const snapshot = registry.createSnapshot();
    remount('btn').addEventListener('click', () => {
      clicks++;
    });

    const response = await handlers.executeElementAction('btn', {
      action: 'click',
      fromSnapshotId: snapshot.snapshotId,
    });

    const data = response.data as ControlActionResponse;
    expect(data.success).toBe(false);
    expect(data.error).toMatch(/superseded/i);
    expect(data.snapshotFreshness?.verdict).toBe('superseded');
    expect(data.snapshotFreshness?.supersededBy).toBe('remount');
    // Refused BEFORE it ran — the whole point of a precondition.
    expect(clicks).toBe(0);
  });

  it('carries fromSnapshotId through when the snapshot IS current', async () => {
    addButton('btn');
    const snapshot = registry.createSnapshot();

    const response = await handlers.executeElementAction('btn', {
      action: 'click',
      fromSnapshotId: snapshot.snapshotId,
    });

    const data = response.data as ControlActionResponse;
    expect(data.success).toBe(true);
    // Reaching the executor is what produces a verdict at all. A dropped field
    // yields `undefined` here, which is precisely the silence being fixed.
    expect(data.snapshotFreshness?.verdict).toBe('fresh');
  });

  it('carries includeResolutionAlternates through the handler', async () => {
    addButton('btn');

    const bare = await handlers.executeElementAction('btn', { action: 'click' });
    expect((bare.data as ControlActionResponse).elementResolution?.alternates).toBeUndefined();

    const withAlternates = await handlers.executeElementAction('btn', {
      action: 'click',
      includeResolutionAlternates: true,
    });
    const resolution = (withAlternates.data as ControlActionResponse).elementResolution;
    expect(resolution).toBeDefined();
    expect(Array.isArray(resolution!.alternates)).toBe(true);
  });

  it('forwards the request object itself, not a copy of a hand-written field list', async () => {
    // The structural assertion. A field list passes the three tests above only
    // as long as someone remembers to extend it; this one fails the moment the
    // handler starts rebuilding the request, including for a field that does
    // not exist yet.
    addButton('btn');
    const spy = vi.spyOn(executor, 'executeAction');

    const request = {
      action: 'click',
      params: { detail: 1 },
      requestId: 'req-1',
      verifyEffect: false,
      fromSnapshotId: 'ubs2_1_1_0123456789abcdef_0123456789abcdef',
      includeResolutionAlternates: true,
      // Not (yet) a member of ControlActionRequest — stands in for the NEXT
      // field someone adds. A rebuild drops it; a pass-through does not.
      someFutureOption: 'must-survive',
    } as unknown as ControlActionRequest;

    await handlers.executeElementAction('btn', request);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe('btn');
    expect(spy.mock.calls[0]![1]).toBe(request);
  });

  it('still forwards a bare request unchanged (no shape regression)', async () => {
    addButton('btn');
    const spy = vi.spyOn(executor, 'executeAction');

    await handlers.executeElementAction('btn', { action: 'click' });

    expect(spy.mock.calls[0]![1]).toEqual({ action: 'click' });
  });
});
