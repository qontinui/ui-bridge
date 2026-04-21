/**
 * Native Registry tests — bbox/visible parity with the web SDK.
 *
 * The web `useUIElement` hook tracks `bbox` + `visible` via ResizeObserver
 * and feeds them into the registry so the runner can dispatch clicks by
 * DOM coords for SDK-registered elements — skipping VLM grounding.
 *
 * The React Native mirror wires the same `bbox` / `visible` from the
 * `onLayout` handler. These tests exercise the registry half of that
 * wiring (the hook itself uses `measureInWindow` which isn't trivial to
 * test in jsdom). The hook integration is covered by the web SDK tests
 * since the shape is contract-identical.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type React from 'react';
import { NativeUIBridgeRegistry, resetGlobalRegistry } from './registry';
import type { NativeElementRef } from './types';

function makeRef(): React.RefObject<NativeElementRef> {
  return { current: null } as React.RefObject<NativeElementRef>;
}

describe('NativeUIBridgeRegistry bbox/visible parity', () => {
  let registry: NativeUIBridgeRegistry;

  beforeEach(() => {
    registry = new NativeUIBridgeRegistry();
  });

  afterEach(() => {
    resetGlobalRegistry();
  });

  it('starts with no bbox and no visibility until updated', () => {
    const registered = registry.registerElement('btn-1', makeRef(), {
      type: 'button',
      label: 'Submit',
    });

    expect(registered.bbox).toBeUndefined();
    expect(registered.visible).toBeUndefined();
  });

  it('updateElementBbox populates bbox and visible', () => {
    registry.registerElement('btn-1', makeRef(), { type: 'button' });

    const ok = registry.updateElementBbox('btn-1', { x: 10, y: 20, width: 100, height: 30 }, true);

    expect(ok).toBe(true);
    const entry = registry.getElement('btn-1')!;
    expect(entry.bbox).toEqual({ x: 10, y: 20, width: 100, height: 30 });
    expect(entry.visible).toBe(true);
  });

  it('zero-dimension layout → visible: false', () => {
    registry.registerElement('btn-1', makeRef(), { type: 'button' });

    registry.updateElementBbox('btn-1', { x: 0, y: 0, width: 0, height: 0 }, false);

    const entry = registry.getElement('btn-1')!;
    expect(entry.bbox).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(entry.visible).toBe(false);
  });

  it('subsequent layout update replaces the stored bbox', () => {
    registry.registerElement('btn-1', makeRef(), { type: 'button' });

    registry.updateElementBbox('btn-1', { x: 1, y: 2, width: 3, height: 4 }, true);
    registry.updateElementBbox('btn-1', { x: 50, y: 60, width: 70, height: 80 }, true);

    const entry = registry.getElement('btn-1')!;
    expect(entry.bbox).toEqual({ x: 50, y: 60, width: 70, height: 80 });
    expect(entry.visible).toBe(true);
  });

  it('updateElementBbox returns false for unknown id', () => {
    expect(registry.updateElementBbox('nope', { x: 0, y: 0, width: 1, height: 1 }, true)).toBe(
      false
    );
  });

  it('clears bbox/visible when called with undefined', () => {
    registry.registerElement('btn-1', makeRef(), { type: 'button' });
    registry.updateElementBbox('btn-1', { x: 1, y: 2, width: 3, height: 4 }, true);

    registry.updateElementBbox('btn-1', undefined, undefined);

    const entry = registry.getElement('btn-1')!;
    expect(entry.bbox).toBeUndefined();
    expect(entry.visible).toBeUndefined();
  });

  it('updateElementBbox does not emit element:stateChanged (onLayout churn safety)', () => {
    registry.registerElement('btn-1', makeRef(), { type: 'button' });

    let stateChangedCount = 0;
    registry.on('element:stateChanged', () => {
      stateChangedCount += 1;
    });

    registry.updateElementBbox('btn-1', { x: 0, y: 0, width: 10, height: 10 }, true);
    registry.updateElementBbox('btn-1', { x: 1, y: 1, width: 10, height: 10 }, true);
    registry.updateElementBbox('btn-1', { x: 2, y: 2, width: 10, height: 10 }, true);

    expect(stateChangedCount).toBe(0);
  });

  it('serializes bbox/visible into the snapshot output', () => {
    registry.registerElement('btn-1', makeRef(), { type: 'button', label: 'Go' });
    registry.updateElementBbox('btn-1', { x: 5, y: 6, width: 7, height: 8 }, true);

    const snapshot = registry.createSnapshot();
    const serialized = snapshot.elements.find((e) => e.id === 'btn-1');

    expect(serialized).toBeDefined();
    expect(serialized!.bbox).toEqual({ x: 5, y: 6, width: 7, height: 8 });
    expect(serialized!.visible).toBe(true);
  });

  it('snapshot omits bbox for elements that have not received an onLayout yet', () => {
    registry.registerElement('btn-1', makeRef(), { type: 'button' });

    const snapshot = registry.createSnapshot();
    const serialized = snapshot.elements.find((e) => e.id === 'btn-1');

    expect(serialized).toBeDefined();
    expect(serialized!.bbox).toBeUndefined();
    expect(serialized!.visible).toBeUndefined();
  });
});
