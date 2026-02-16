/**
 * Action Executor Tests — Drag-and-Drop
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UIBridgeRegistry } from '../core/registry';
import { DefaultActionExecutor } from './action-executor';

describe('DefaultActionExecutor - drag', () => {
  let registry: UIBridgeRegistry;
  let executor: DefaultActionExecutor;
  let container: HTMLDivElement;

  beforeEach(() => {
    registry = new UIBridgeRegistry();
    executor = new DefaultActionExecutor(registry);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function createPositionedElement(id: string, x: number, y: number, size = 50): HTMLDivElement {
    const el = document.createElement('div');
    el.setAttribute('data-ui-id', id);
    el.style.position = 'absolute';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    container.appendChild(el);
    return el;
  }

  it('should dispatch mousedown, mousemove, mouseup sequence for drag to target position', async () => {
    const source = createPositionedElement('source', 10, 10);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    const events: string[] = [];
    source.addEventListener('mousedown', () => events.push('mousedown'));

    // Listen on document for mousemove/mouseup since they may hit different elements
    document.addEventListener('mousemove', () => events.push('mousemove'));
    document.addEventListener('mouseup', () => events.push('mouseup'));

    const result = await executor.executeAction('source', {
      action: 'drag',
      params: {
        targetPosition: { x: 200, y: 200 },
        steps: 3,
        holdDelay: 0,
        releaseDelay: 0,
      },
    });

    expect(result.success).toBe(true);
    // Should have mousedown, then 3 mousemoves, then mouseup
    expect(events[0]).toBe('mousedown');
    expect(events.filter((e) => e === 'mousemove').length).toBe(3);
    expect(events[events.length - 1]).toBe('mouseup');
  });

  // DragEvent is not available in jsdom, so we test HTML5 mode only when the
  // constructor exists (real browser). In jsdom we verify the flag is accepted
  // without crashing when DragEvent is unavailable.
  it('should accept html5 option and dispatch mouse events regardless', async () => {
    const source = createPositionedElement('source', 10, 10);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    const events: string[] = [];
    source.addEventListener('mousedown', () => events.push('mousedown'));
    document.addEventListener('mousemove', () => events.push('mousemove'));
    document.addEventListener('mouseup', () => events.push('mouseup'));

    // HTML5 drag events may or may not fire depending on environment
    if (typeof DragEvent !== 'undefined') {
      source.addEventListener('dragstart', () => events.push('dragstart'));
      document.addEventListener('drop', () => events.push('drop'));
    }

    const result = await executor.executeAction('source', {
      action: 'drag',
      params: {
        targetPosition: { x: 200, y: 200 },
        steps: 2,
        holdDelay: 0,
        releaseDelay: 0,
        html5: true,
      },
    });

    expect(result.success).toBe(true);
    // Mouse events always fire
    expect(events).toContain('mousedown');
    expect(events).toContain('mousemove');
    expect(events).toContain('mouseup');
  });

  it('should resolve target element by registry ID', async () => {
    const source = createPositionedElement('source', 10, 10);
    const target = createPositionedElement('target', 200, 200);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });
    registry.registerElement('target', target, { type: 'button', label: 'Target' });

    const result = await executor.executeAction('source', {
      action: 'drag',
      params: {
        target: { elementId: 'target' },
        steps: 2,
        holdDelay: 0,
        releaseDelay: 0,
      },
    });

    expect(result.success).toBe(true);
  });

  it('should resolve target element by CSS selector', async () => {
    const source = createPositionedElement('source', 10, 10);
    const target = createPositionedElement('target', 200, 200);
    target.classList.add('drop-zone');
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    const result = await executor.executeAction('source', {
      action: 'drag',
      params: {
        target: { selector: '.drop-zone' },
        steps: 2,
        holdDelay: 0,
        releaseDelay: 0,
      },
    });

    expect(result.success).toBe(true);
  });

  it('should fail when no target is provided', async () => {
    const source = createPositionedElement('source', 10, 10);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    const result = await executor.executeAction('source', {
      action: 'drag',
      params: {
        steps: 2,
        holdDelay: 0,
        releaseDelay: 0,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('target');
  });

  it('should fail when target element is not found', async () => {
    const source = createPositionedElement('source', 10, 10);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    const result = await executor.executeAction('source', {
      action: 'drag',
      params: {
        target: { elementId: 'nonexistent' },
        steps: 2,
        holdDelay: 0,
        releaseDelay: 0,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should use default steps and delays when not specified', async () => {
    const source = createPositionedElement('source', 10, 10);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    let moveCount = 0;
    document.addEventListener('mousemove', () => moveCount++);

    const result = await executor.executeAction('source', {
      action: 'drag',
      params: {
        targetPosition: { x: 200, y: 200 },
        // No steps/holdDelay/releaseDelay — use defaults (10 steps, 100ms hold, 50ms release)
      },
    });

    expect(result.success).toBe(true);
    // Default is 10 steps
    expect(moveCount).toBe(10);
  });

  it('should pass correct coordinates in mouse events', async () => {
    const source = createPositionedElement('source', 0, 0, 100);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    const mousedownCoords: { x: number; y: number }[] = [];
    source.addEventListener('mousedown', (e: MouseEvent) => {
      mousedownCoords.push({ x: e.clientX, y: e.clientY });
    });

    const mouseupCoords: { x: number; y: number }[] = [];
    document.addEventListener('mouseup', (e: MouseEvent) => {
      mouseupCoords.push({ x: e.clientX, y: e.clientY });
    });

    await executor.executeAction('source', {
      action: 'drag',
      params: {
        targetPosition: { x: 300, y: 400 },
        steps: 1,
        holdDelay: 0,
        releaseDelay: 0,
      },
    });

    // In jsdom, getBoundingClientRect returns all zeros, so source center is (0,0)
    // In a real browser this would be the actual element center
    expect(mousedownCoords[0].x).toBe(0);
    expect(mousedownCoords[0].y).toBe(0);
    // Target position should be exactly what we specified
    expect(mouseupCoords[0].x).toBe(300);
    expect(mouseupCoords[0].y).toBe(400);
  });

  it('should respect sourceOffset parameter', async () => {
    const source = createPositionedElement('source', 0, 0, 100);
    registry.registerElement('source', source, { type: 'button', label: 'Source' });

    const mousedownCoords: { x: number; y: number }[] = [];
    source.addEventListener('mousedown', (e: MouseEvent) => {
      mousedownCoords.push({ x: e.clientX, y: e.clientY });
    });

    await executor.executeAction('source', {
      action: 'drag',
      params: {
        targetPosition: { x: 200, y: 200 },
        sourceOffset: { x: 10, y: 20 },
        steps: 1,
        holdDelay: 0,
        releaseDelay: 0,
      },
    });

    // In jsdom, rect.left=0 + sourceOffset.x=10 = 10
    expect(mousedownCoords[0].x).toBe(10);
    expect(mousedownCoords[0].y).toBe(20);
  });
});
