/**
 * DragDropDetector Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DragDropDetector } from '../drag-drop-detector';

// Helper to create a minimal DOM element for testing
function createElement(
  tag: string,
  attrs: Record<string, string> = {},
  classes: string[] = []
): HTMLElement {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
  for (const cls of classes) {
    el.classList.add(cls);
  }
  return el;
}

describe('DragDropDetector', () => {
  let detector: DragDropDetector;

  beforeEach(() => {
    detector = new DragDropDetector();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // -------------------------------------------------------------------------
  // Declared drag sources
  // -------------------------------------------------------------------------

  describe('declared drag sources', () => {
    it('should store a drag source via declareDragSource()', () => {
      detector.declareDragSource('step-3', { dataType: 'workflow-step' });

      const sources = detector.getDragSources();
      expect(sources).toHaveLength(1);
      expect(sources[0]).toEqual({
        id: 'step-3',
        dataType: 'workflow-step',
        origin: 'declared',
        nativeDraggable: false,
        hasGrabCursor: false,
      });
    });

    it('should store a drag source with metadata', () => {
      detector.declareDragSource('item-1', {
        dataType: 'list-item',
        metadata: { index: 0 },
      });

      const sources = detector.getDragSources();
      expect(sources[0].metadata).toEqual({ index: 0 });
    });

    it('should overwrite duplicate declarations', () => {
      detector.declareDragSource('a', { dataType: 'type1' });
      detector.declareDragSource('a', { dataType: 'type2' });

      const sources = detector.getDragSources();
      expect(sources).toHaveLength(1);
      expect(sources[0].dataType).toBe('type2');
    });

    it('should remove via undeclareDragSource()', () => {
      detector.declareDragSource('a');
      detector.undeclareDragSource('a');

      expect(detector.getDragSources()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Declared drop zones
  // -------------------------------------------------------------------------

  describe('declared drop zones', () => {
    it('should store a drop zone via declareDropZone()', () => {
      detector.declareDropZone('step-list', {
        accepts: ['workflow-step'],
        effect: 'reorder',
      });

      const zones = detector.getDropZones();
      expect(zones).toHaveLength(1);
      expect(zones[0]).toEqual({
        id: 'step-list',
        accepts: ['workflow-step'],
        effect: 'reorder',
        origin: 'declared',
        isSortable: false,
      });
    });

    it('should remove via undeclareDropZone()', () => {
      detector.declareDropZone('zone-a');
      detector.undeclareDropZone('zone-a');

      expect(detector.getDropZones()).toHaveLength(0);
    });

    it('should remove all via undeclareAll()', () => {
      detector.declareDragSource('x');
      detector.declareDropZone('x');
      detector.undeclareAll('x');

      expect(detector.getDragSources()).toHaveLength(0);
      expect(detector.getDropZones()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // ARIA auto-detection
  // -------------------------------------------------------------------------

  describe('ARIA auto-detection', () => {
    it('should detect aria-grabbed="true" as a drag source', () => {
      const el = createElement('div', { 'aria-grabbed': 'true' });
      document.body.appendChild(el);

      const result = detector.scanARIA([{ id: 'draggable-1', element: el }]);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].id).toBe('draggable-1');
      expect(result.sources[0].origin).toBe('aria');
    });

    it('should detect aria-grabbed="false" as a drag source (still draggable, just not grabbed)', () => {
      const el = createElement('div', { 'aria-grabbed': 'false' });
      document.body.appendChild(el);

      const result = detector.scanARIA([{ id: 'draggable-2', element: el }]);
      expect(result.sources).toHaveLength(1);
    });

    it('should detect aria-dropeffect as a drop zone', () => {
      const el = createElement('div', { 'aria-dropeffect': 'move' });
      document.body.appendChild(el);

      const result = detector.scanARIA([{ id: 'zone-1', element: el }]);
      expect(result.zones).toHaveLength(1);
      expect(result.zones[0].id).toBe('zone-1');
      expect(result.zones[0].effect).toBe('move');
      expect(result.zones[0].ariaDropEffect).toBe('move');
    });

    it('should ignore aria-dropeffect="none"', () => {
      const el = createElement('div', { 'aria-dropeffect': 'none' });
      document.body.appendChild(el);

      const result = detector.scanARIA([{ id: 'zone-2', element: el }]);
      expect(result.zones).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // DOM auto-detection
  // -------------------------------------------------------------------------

  describe('DOM auto-detection', () => {
    it('should detect draggable="true" as a drag source', () => {
      const el = createElement('div', { draggable: 'true' });
      document.body.appendChild(el);

      const result = detector.scanDOM([{ id: 'native-drag', element: el }]);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].nativeDraggable).toBe(true);
    });

    it('should detect cursor-grab CSS class as a drag source', () => {
      const el = createElement('button', {}, ['cursor-grab']);
      document.body.appendChild(el);

      const result = detector.scanDOM([{ id: 'grab-btn', element: el }]);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].hasGrabCursor).toBe(true);
    });

    it('should detect cursor-move CSS class as a drag source', () => {
      const el = createElement('div', {}, ['cursor-move']);
      document.body.appendChild(el);

      const result = detector.scanDOM([{ id: 'move-el', element: el }]);
      expect(result.sources).toHaveLength(1);
    });

    it('should detect container with 2+ draggable children as a sortable drop zone', () => {
      const container = createElement('ul', { role: 'list' });
      const child1 = createElement('li', { draggable: 'true' });
      const child2 = createElement('li', { draggable: 'true' });
      container.appendChild(child1);
      container.appendChild(child2);
      document.body.appendChild(container);

      const result = detector.scanDOM([
        { id: 'list', element: container },
        { id: 'item-1', element: child1 },
        { id: 'item-2', element: child2 },
      ]);

      expect(result.sources).toHaveLength(2);
      expect(result.zones).toHaveLength(1);
      expect(result.zones[0].id).toBe('list');
      expect(result.zones[0].isSortable).toBe(true);
      expect(result.zones[0].containedDragSources).toContain('item-1');
      expect(result.zones[0].containedDragSources).toContain('item-2');
      expect(result.zones[0].effect).toBe('reorder');
    });

    it('should not create a zone for a container with only 1 draggable child', () => {
      const container = createElement('div');
      const child = createElement('div', { draggable: 'true' });
      container.appendChild(child);
      document.body.appendChild(container);

      const result = detector.scanDOM([
        { id: 'container', element: container },
        { id: 'only-child', element: child },
      ]);

      expect(result.zones).toHaveLength(0);
    });

    it('should not mark a draggable element as a drop zone', () => {
      const parent = createElement('div');
      const draggable1 = createElement('div', {}, ['cursor-grab']);
      const draggable2 = createElement('div', {}, ['cursor-grab']);
      parent.appendChild(draggable1);
      parent.appendChild(draggable2);
      document.body.appendChild(parent);

      const result = detector.scanDOM([
        { id: 'parent', element: parent },
        { id: 'drag-a', element: draggable1 },
        { id: 'drag-b', element: draggable2 },
      ]);

      // Parent should be zone, draggable items should not
      const zoneIds = result.zones.map((z) => z.id);
      expect(zoneIds).toContain('parent');
      expect(zoneIds).not.toContain('drag-a');
      expect(zoneIds).not.toContain('drag-b');
    });
  });

  // -------------------------------------------------------------------------
  // Deduplication and priority
  // -------------------------------------------------------------------------

  describe('deduplication', () => {
    it('should prioritize declared over auto-detected', () => {
      // Declare a source
      detector.declareDragSource('item', { dataType: 'custom-type' });

      // Auto-detect same element
      const el = createElement('div', { 'aria-grabbed': 'true' });
      document.body.appendChild(el);

      const sources = detector.getDragSources([{ id: 'item', element: el }]);
      expect(sources).toHaveLength(1);
      expect(sources[0].origin).toBe('declared');
      expect(sources[0].dataType).toBe('custom-type');
    });

    it('should merge nativeDraggable from auto-detected into declared', () => {
      detector.declareDragSource('item');

      const el = createElement('div', { draggable: 'true' });
      document.body.appendChild(el);

      const sources = detector.getDragSources([{ id: 'item', element: el }]);
      expect(sources).toHaveLength(1);
      expect(sources[0].origin).toBe('declared');
      expect(sources[0].nativeDraggable).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Cache (refreshAutoDetected)
  // -------------------------------------------------------------------------

  describe('refreshAutoDetected', () => {
    it('should cache auto-detected results', () => {
      const el = createElement('div', { draggable: 'true' });
      document.body.appendChild(el);

      detector.refreshAutoDetected([{ id: 'cached-item', element: el }]);

      // Now calling without elements should use cache
      const sources = detector.getDragSources();
      expect(sources).toHaveLength(1);
      expect(sources[0].id).toBe('cached-item');
    });

    it('should clear cache via clearAutoDetected()', () => {
      const el = createElement('div', { draggable: 'true' });
      document.body.appendChild(el);

      detector.refreshAutoDetected([{ id: 'item', element: el }]);
      detector.clearAutoDetected();

      expect(detector.getDragSources()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Snapshot context
  // -------------------------------------------------------------------------

  describe('getSnapshotDragDropContext', () => {
    it('should return structured snapshot with counts and origin breakdown', () => {
      detector.declareDragSource('src-1', { dataType: 'step' });
      detector.declareDropZone('zone-1', { accepts: ['step'], effect: 'reorder' });

      const el = createElement('div', { 'aria-grabbed': 'true' });
      document.body.appendChild(el);

      const ctx = detector.getSnapshotDragDropContext([{ id: 'src-2', element: el }]);

      expect(ctx.count.dragSources).toBe(2);
      expect(ctx.count.dropZones).toBe(1);
      expect(ctx.byOrigin.declared).toBe(2); // 1 source + 1 zone
      expect(ctx.byOrigin.aria).toBe(1);
      expect(ctx.dragSources).toHaveLength(2);
      expect(ctx.dropZones).toHaveLength(1);
    });

    it('should return empty context when nothing is detected', () => {
      const ctx = detector.getSnapshotDragDropContext();
      expect(ctx.count.dragSources).toBe(0);
      expect(ctx.count.dropZones).toBe(0);
      expect(ctx.dragSources).toHaveLength(0);
      expect(ctx.dropZones).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Query helpers
  // -------------------------------------------------------------------------

  describe('query helpers', () => {
    it('getDropZonesForType should filter by accepted type', () => {
      detector.declareDropZone('z1', { accepts: ['step'] });
      detector.declareDropZone('z2', { accepts: ['file'] });
      detector.declareDropZone('z3'); // no accepts = accepts anything

      const stepZones = detector.getDropZonesForType('step');
      const ids = stepZones.map((z) => z.id);
      expect(ids).toContain('z1');
      expect(ids).not.toContain('z2');
      expect(ids).toContain('z3'); // wildcard
    });

    it('getDragSourcesInZone should return contained sources', () => {
      const container = createElement('div');
      const child1 = createElement('div', { draggable: 'true' });
      const child2 = createElement('div', { draggable: 'true' });
      container.appendChild(child1);
      container.appendChild(child2);
      document.body.appendChild(container);

      const elements = [
        { id: 'list', element: container as Element },
        { id: 'item-a', element: child1 as Element },
        { id: 'item-b', element: child2 as Element },
      ];

      detector.refreshAutoDetected(elements);

      const sourcesInZone = detector.getDragSourcesInZone('list');
      const ids = sourcesInZone.map((s) => s.id);
      expect(ids).toContain('item-a');
      expect(ids).toContain('item-b');
    });
  });

  // -------------------------------------------------------------------------
  // Label extraction
  // -------------------------------------------------------------------------

  describe('label extraction', () => {
    it('should extract aria-label', () => {
      const el = createElement('div', {
        'aria-label': 'Step 3',
        'aria-grabbed': 'true',
      });
      document.body.appendChild(el);

      const result = detector.scanARIA([{ id: 'step', element: el }]);
      expect(result.sources[0].label).toBe('Step 3');
    });

    it('should extract data-testid when no aria-label', () => {
      const el = createElement('div', {
        'data-testid': 'sortable-item',
        draggable: 'true',
      });
      document.body.appendChild(el);

      const result = detector.scanDOM([{ id: 'item', element: el }]);
      expect(result.sources[0].label).toBe('sortable-item');
    });

    it('should extract short text content', () => {
      const el = createElement('div', { draggable: 'true' });
      el.textContent = 'Task 1';
      document.body.appendChild(el);

      const result = detector.scanDOM([{ id: 'item', element: el }]);
      expect(result.sources[0].label).toBe('Task 1');
    });

    it('should skip long text content', () => {
      const el = createElement('div', { draggable: 'true' });
      el.textContent = 'A'.repeat(100);
      document.body.appendChild(el);

      const result = detector.scanDOM([{ id: 'item', element: el }]);
      expect(result.sources[0].label).toBeUndefined();
    });
  });
});
