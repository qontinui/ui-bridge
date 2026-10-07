/**
 * Drag sequence — shared by `DefaultActionExecutor` and the React command
 * handler, so both action paths honour one contract (the same arrangement as
 * `combobox-select.ts`).
 */

import type { DragAction } from './types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Safe wrapper around document.elementFromPoint that returns null if unavailable.
 * (elementFromPoint is not implemented in some test environments like jsdom.)
 */
function elementFromPointSafe(x: number, y: number): HTMLElement | null {
  if (typeof document.elementFromPoint === 'function') {
    return document.elementFromPoint(x, y) as HTMLElement | null;
  }
  return null;
}

/**
 * Create a mouse event at absolute client coordinates
 */
function createMouseEventAt(
  type: string,
  clientX: number,
  clientY: number,
  buttons = 0
): MouseEvent {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons,
    clientX,
    clientY,
  });
}

/**
 * Primary-button pointer event at absolute client coordinates — the drag
 * counterpart of {@link createPointerEvent}. Drag handlers written against
 * Pointer Events (`onPointerDown` / `onPointerMove`, dnd-kit, most modern
 * React drag code) never see a mouse-only sequence, so a drag must emit both,
 * pointer first, as a real browser does. Returns null where `PointerEvent`
 * is unavailable (older jsdom); the mouse half still runs there.
 */
function createPointerEventAt(
  type: string,
  clientX: number,
  clientY: number,
  buttons: number
): Event | null {
  if (typeof PointerEvent !== 'function') return null;
  // No `view: window` — see the jsdom note in createPointerEvent.
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons,
    clientX,
    clientY,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  });
}

/** Dispatch a drag-sequence pointer event (when supported), then its mouse twin. */
function dispatchDragPair(
  target: EventTarget,
  pointerType: 'pointerdown' | 'pointermove' | 'pointerup',
  mouseType: 'mousedown' | 'mousemove' | 'mouseup',
  clientX: number,
  clientY: number,
  buttons: number
): void {
  const pointer = createPointerEventAt(pointerType, clientX, clientY, buttons);
  if (pointer) target.dispatchEvent(pointer);
  target.dispatchEvent(createMouseEventAt(mouseType, clientX, clientY, buttons));
}

/**
 * Perform a drag operation by dispatching a sequence of pointer + mouse events.
 *
 * Follows the same composite pattern as the qontinui core library:
 * down on source → wait → move × N along path → up on target, where each step
 * is a pointer event followed by its mouse twin (as a real browser fires them).
 *
 * This is the ONE drag implementation: the HTTP action executor and the React
 * command handler (`executeElementAction`) both call it, so a drag request
 * behaves the same whichever path serves it.
 *
 * Optionally dispatches HTML5 drag events (dragstart/dragover/drop/dragend)
 * for apps that use the HTML5 Drag and Drop API instead of mouse events.
 */
export async function performDragSequence(
  sourceElement: HTMLElement,
  options: DragAction | undefined,
  resolveTarget: (target: NonNullable<DragAction['target']>) => HTMLElement | null
): Promise<{ warning?: string }> {
  // Check if element appears to be draggable
  const computedStyle = window.getComputedStyle(sourceElement);
  const isDraggable =
    sourceElement.draggable ||
    sourceElement.getAttribute('aria-grabbed') !== null ||
    sourceElement.getAttribute('role') === 'slider' ||
    computedStyle.cursor === 'grab' ||
    computedStyle.cursor === 'move' ||
    computedStyle.cursor === 'grabbing';

  const sourceRect = sourceElement.getBoundingClientRect();
  const sourceX = sourceRect.left + (options?.sourceOffset?.x ?? sourceRect.width / 2);
  const sourceY = sourceRect.top + (options?.sourceOffset?.y ?? sourceRect.height / 2);

  // Resolve target position
  let targetX: number;
  let targetY: number;

  if (options?.targetPosition) {
    targetX = options.targetPosition.x;
    targetY = options.targetPosition.y;
  } else if (options?.target) {
    const targetElement = resolveTarget(options.target);
    if (!targetElement) {
      throw new Error(`Drag target element not found: ${JSON.stringify(options.target)}`);
    }
    const targetRect = targetElement.getBoundingClientRect();
    targetX = targetRect.left + (options?.targetOffset?.x ?? targetRect.width / 2);
    targetY = targetRect.top + (options?.targetOffset?.y ?? targetRect.height / 2);
  } else {
    throw new Error('Drag requires either target or targetPosition');
  }

  const steps = options?.steps ?? 10;
  const holdDelay = options?.holdDelay ?? 100;
  const releaseDelay = options?.releaseDelay ?? 50;
  const stepDelay = options?.stepDelay ?? 0;

  // 1. Dispatch pointerdown + mousedown on source (primary button held)
  dispatchDragPair(sourceElement, 'pointerdown', 'mousedown', sourceX, sourceY, 1);

  // 2. Optionally dispatch dragstart (HTML5 mode, requires DragEvent support)
  const canHTML5 = options?.html5 && typeof DragEvent !== 'undefined';
  if (canHTML5) {
    sourceElement.dispatchEvent(
      new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        clientX: sourceX,
        clientY: sourceY,
      })
    );
  }

  // 3. Wait hold delay (matches qontinui core's delay_between_mouse_down_and_move)
  if (holdDelay > 0) {
    await sleep(holdDelay);
  }

  // 4. Dispatch intermediate mousemove events along the path
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const currentX = sourceX + (targetX - sourceX) * progress;
    const currentY = sourceY + (targetY - sourceY) * progress;

    // Find the element under the cursor (falls back to source if unavailable)
    const dispatchTarget = elementFromPointSafe(currentX, currentY) || sourceElement;

    dispatchDragPair(dispatchTarget, 'pointermove', 'mousemove', currentX, currentY, 1);

    if (canHTML5) {
      dispatchTarget.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: currentX,
          clientY: currentY,
        })
      );
    }

    // Let the page re-render between steps, so a widget that follows the
    // pointer is still under it when the next move is hit-tested.
    if (stepDelay > 0 && i < steps) {
      await sleep(stepDelay);
    }
  }

  // 5. Dispatch mouseup on the element under the final position
  const dropTarget = elementFromPointSafe(targetX, targetY) || sourceElement;

  dispatchDragPair(dropTarget, 'pointerup', 'mouseup', targetX, targetY, 0);

  // 6. Optionally dispatch drop + dragend (HTML5 mode)
  if (canHTML5) {
    dropTarget.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: targetX,
        clientY: targetY,
      })
    );
    sourceElement.dispatchEvent(
      new DragEvent('dragend', {
        bubbles: true,
        cancelable: true,
        clientX: targetX,
        clientY: targetY,
      })
    );
  }

  // 7. Wait release delay (matches qontinui core's delay_after_drag)
  if (releaseDelay > 0) {
    await sleep(releaseDelay);
  }

  return {
    warning: isDraggable
      ? undefined
      : 'Element does not appear to be draggable (no draggable attribute, aria-grabbed, or grab/move cursor). Drag events were dispatched but may have no effect.',
  };
}
