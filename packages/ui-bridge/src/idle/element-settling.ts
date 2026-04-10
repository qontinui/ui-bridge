/**
 * Element Stability Wait
 *
 * Watches a single HTMLElement for visual and DOM stability. Resolves when
 * no MutationObserver mutations AND no bounding-box changes have occurred
 * for `quietMs` milliseconds, or resolves with `stable: false` on timeout.
 */

export interface ElementSettlingOptions {
  /** Milliseconds of quiet (no mutations, no bbox changes) before resolving. Default 500. */
  quietMs?: number;
  /** Overall timeout in milliseconds. Default 5000. */
  timeout?: number;
  /** Observe attribute changes on the element. Default true. */
  observeAttributes?: boolean;
  /** Observe subtree mutations. Default false (avoids false timeouts from child mutations). */
  observeSubtree?: boolean;
}

export interface ElementSettlingResult {
  stable: boolean;
  elapsed: number;
}

/**
 * Wait until an element is visually and structurally stable.
 *
 * "Stable" means: no DOM mutations on the element (per MutationObserver)
 * AND no bounding-box changes (per requestAnimationFrame polling) for at
 * least `quietMs` consecutive milliseconds.
 *
 * Resolves with `{ stable: true, elapsed }` on success or
 * `{ stable: false, elapsed }` on timeout — never rejects.
 */
export function waitForElementStable(
  element: HTMLElement,
  options?: ElementSettlingOptions,
): Promise<ElementSettlingResult> {
  const quietMs = options?.quietMs ?? 500;
  const timeout = options?.timeout ?? 5000;
  const observeAttributes = options?.observeAttributes ?? true;
  const observeSubtree = options?.observeSubtree ?? false;

  return new Promise<ElementSettlingResult>((resolve) => {
    const startTime = Date.now();
    let lastActivityAt = Date.now();
    let rafId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let quietCheckId: ReturnType<typeof setTimeout> | null = null;
    let prevRect: DOMRect | null = null;
    let cleaned = false;

    // ---- Cleanup ----
    function cleanup(): void {
      if (cleaned) return;
      cleaned = true;
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (quietCheckId !== null) clearTimeout(quietCheckId);
    }

    // ---- Activity bump ----
    function recordActivity(): void {
      lastActivityAt = Date.now();
      scheduleQuietCheck();
    }

    // ---- Quiet-period check ----
    function scheduleQuietCheck(): void {
      if (quietCheckId !== null) clearTimeout(quietCheckId);
      quietCheckId = setTimeout(() => {
        const elapsed = Date.now() - lastActivityAt;
        if (elapsed >= quietMs) {
          cleanup();
          resolve({ stable: true, elapsed: Date.now() - startTime });
        } else {
          // Not quite there yet — reschedule for the remainder.
          scheduleQuietCheck();
        }
      }, quietMs - (Date.now() - lastActivityAt) + 1);
    }

    // ---- MutationObserver ----
    const observer = new MutationObserver((mutations) => {
      // Any meaningful mutation resets the quiet clock.
      let meaningful = false;
      for (const m of mutations) {
        if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
          meaningful = true;
          break;
        }
        if (m.type === 'attributes' || m.type === 'characterData') {
          meaningful = true;
          break;
        }
      }
      if (meaningful) recordActivity();
    });

    observer.observe(element, {
      childList: true,
      attributes: observeAttributes,
      characterData: true,
      subtree: observeSubtree,
    });

    // ---- RAF bounding-box polling ----
    function pollBBox(): void {
      if (cleaned) return;
      const rect = element.getBoundingClientRect();
      if (prevRect !== null && !rectsEqual(prevRect, rect)) {
        recordActivity();
      }
      prevRect = rect;
      rafId = requestAnimationFrame(pollBBox);
    }

    rafId = requestAnimationFrame(pollBBox);

    // ---- Timeout ----
    timeoutId = setTimeout(() => {
      cleanup();
      resolve({ stable: false, elapsed: Date.now() - startTime });
    }, timeout);

    // Kick off the first quiet-period check.
    scheduleQuietCheck();
  });
}

/** Compare two DOMRects with a small epsilon for floating-point jitter. */
function rectsEqual(a: DOMRect, b: DOMRect, epsilon = 0.5): boolean {
  return (
    Math.abs(a.x - b.x) < epsilon &&
    Math.abs(a.y - b.y) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon
  );
}
