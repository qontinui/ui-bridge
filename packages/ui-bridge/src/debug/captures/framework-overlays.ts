/**
 * Framework Error Overlay Capture Sub-module
 *
 * Detects framework error overlays from Next.js, Vite, and React error
 * boundaries using DOM observation. Emits events when overlays appear or
 * disappear, and exposes current overlay state for snapshot enrichment.
 *
 * Detected overlays:
 * - Next.js: `nextjs-portal` / `nextjs__container_errors_*` elements
 * - Vite: `vite-error-overlay` custom element
 * - React Error Boundary: elements with `data-react-error-boundary` attribute
 *   (or common fallback patterns like role="alert" with error-like content)
 */

import type { AnyCapturedEvent } from '../browser-capture-types';

type Emit = (event: AnyCapturedEvent) => void;

// ---------------------------------------------------------------------------
// Overlay descriptor (returned from getActiveOverlays)
// ---------------------------------------------------------------------------

export interface DetectedErrorOverlay {
  /** Which framework produced this overlay */
  framework: 'nextjs' | 'vite' | 'react-error-boundary';
  /** Whether the overlay is currently visible */
  visible: boolean;
  /** Title or heading extracted from the overlay */
  title?: string;
  /** Error message extracted from the overlay */
  message?: string;
  /** Source file reference, if available */
  file?: string;
}

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

function detectNextjsOverlay(): DetectedErrorOverlay | null {
  // Next.js error overlay lives in a portal element
  // Next.js 13+: <div id="__next-build-error"> or <nextjs-portal> with shadow DOM
  // The error dialog contains data-nextjs-dialog or data-nextjs-toast elements
  const portal = document.querySelector('nextjs-portal');
  if (portal?.shadowRoot) {
    const dialog = portal.shadowRoot.querySelector('[data-nextjs-dialog]');
    if (dialog) {
      const title =
        portal.shadowRoot
          .querySelector('[data-nextjs-dialog-header] h1, [data-nextjs-dialog-header] h2')
          ?.textContent?.trim() || portal.shadowRoot.querySelector('h1, h2')?.textContent?.trim();
      const body =
        portal.shadowRoot.querySelector('[data-nextjs-dialog-body]')?.textContent?.trim() ||
        portal.shadowRoot.querySelector('p')?.textContent?.trim();
      // Try to find file reference
      const fileRef = portal.shadowRoot
        .querySelector('[data-nextjs-codeframe] div')
        ?.textContent?.trim();

      return {
        framework: 'nextjs',
        visible: true,
        title: title || 'Next.js Error',
        message: truncate(body, 500),
        file: fileRef,
      };
    }
    // Check for toast (less severe indicator)
    const toast = portal.shadowRoot.querySelector('[data-nextjs-toast]');
    if (toast) {
      return {
        framework: 'nextjs',
        visible: true,
        title: 'Next.js Error Toast',
        message: truncate(toast.textContent?.trim(), 300),
      };
    }
  }

  // Fallback: Next.js build error overlay (older versions / app directory)
  const buildError = document.getElementById('__next-build-error');
  if (buildError) {
    return {
      framework: 'nextjs',
      visible: true,
      title: 'Next.js Build Error',
      message: truncate(buildError.textContent?.trim(), 500),
    };
  }

  // Fallback: data attribute selectors for error containers
  const errorLabel = document.querySelector('[id*="nextjs__container_errors"]');
  if (errorLabel) {
    return {
      framework: 'nextjs',
      visible: true,
      title: 'Next.js Error',
      message: truncate(errorLabel.closest('div')?.textContent?.trim(), 500),
    };
  }

  return null;
}

function detectViteOverlay(): DetectedErrorOverlay | null {
  // Vite renders a custom element <vite-error-overlay> with shadow DOM
  const overlay = document.querySelector('vite-error-overlay') as HTMLElement | null;
  if (!overlay) return null;

  // Check visibility — Vite may keep the element but hide it
  const style = window.getComputedStyle(overlay);
  if (style.display === 'none' || style.visibility === 'hidden') return null;

  // Extract error details from shadow DOM
  const shadow: ShadowRoot | null = overlay.shadowRoot;
  let message: string | undefined;
  let title: string | undefined;
  let file: string | undefined;

  if (shadow) {
    title =
      shadow.querySelector('.message-body')?.textContent?.trim() ||
      shadow.querySelector('h1, h2, .message')?.textContent?.trim();
    message = shadow.querySelector('.stack, pre')?.textContent?.trim();
    file = shadow.querySelector('.file, .tip code')?.textContent?.trim();
  } else {
    // No shadow DOM — try direct children
    title = overlay.querySelector('h1, h2, .message')?.textContent?.trim();
    message = overlay.querySelector('pre, .stack')?.textContent?.trim();
  }

  return {
    framework: 'vite',
    visible: true,
    title: title || 'Vite Error',
    message: truncate(message, 500),
    file,
  };
}

function detectReactErrorBoundary(): DetectedErrorOverlay | null {
  // Check for explicit data attribute (recommended for SDK users)
  const explicit = document.querySelector('[data-react-error-boundary]') as HTMLElement | null;
  if (explicit) {
    const style = window.getComputedStyle(explicit);
    if (style.display !== 'none' && style.visibility !== 'hidden') {
      return {
        framework: 'react-error-boundary',
        visible: true,
        title: 'React Error Boundary',
        message: truncate(explicit.textContent?.trim(), 500),
      };
    }
  }

  // Heuristic: Look for common React error boundary fallback patterns
  // Many libraries use role="alert" with error-like content
  const alerts = document.querySelectorAll('[role="alert"]');
  for (const alert of alerts) {
    const text = alert.textContent?.trim() || '';
    // Check if this looks like an error boundary fallback (not a regular toast/notification)
    // Error boundaries typically contain phrases like "Something went wrong" or "error"
    // and are larger elements (not small toasts)
    const rect = (alert as HTMLElement).getBoundingClientRect();
    const isLargeEnough = rect.width > 200 && rect.height > 100;
    const hasErrorText =
      /something went wrong|error occurred|unexpected error|application error/i.test(text);
    if (isLargeEnough && hasErrorText) {
      return {
        framework: 'react-error-boundary',
        visible: true,
        title: 'React Error Boundary',
        message: truncate(text, 500),
      };
    }
  }

  return null;
}

function truncate(s: string | undefined | null, max: number): string | undefined {
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max) + '...' : s;
}

// ---------------------------------------------------------------------------
// Public: get current overlay state (for snapshot enrichment)
// ---------------------------------------------------------------------------

/**
 * Detect currently visible framework error overlays.
 * Returns an array of detected overlays (empty if none visible).
 */
export function getActiveOverlays(): DetectedErrorOverlay[] {
  if (typeof document === 'undefined') return [];

  const overlays: DetectedErrorOverlay[] = [];
  const nextjs = detectNextjsOverlay();
  if (nextjs) overlays.push(nextjs);
  const vite = detectViteOverlay();
  if (vite) overlays.push(vite);
  const react = detectReactErrorBoundary();
  if (react) overlays.push(react);
  return overlays;
}

// ---------------------------------------------------------------------------
// Public: install MutationObserver-based capture
// ---------------------------------------------------------------------------

export function installFrameworkOverlayCapture(emit: Emit): () => void {
  if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {};
  }

  // Track which overlays we've already reported as visible to avoid duplicates
  const reported = new Set<string>();

  function check() {
    let overlays: DetectedErrorOverlay[];
    try {
      overlays = getActiveOverlays();
    } catch {
      return;
    }
    const currentKeys = new Set<string>();

    for (const overlay of overlays) {
      const key = overlay.framework;
      currentKeys.add(key);

      if (!reported.has(key)) {
        reported.add(key);
        emit({
          type: 'console',
          level: 'error',
          timestamp: Date.now(),
          url: typeof window !== 'undefined' ? window.location.href : '',
          message: `[${overlay.framework} error overlay] ${overlay.title || 'Error'}${overlay.message ? ': ' + overlay.message.slice(0, 200) : ''}`,
          stack: overlay.file ? `at ${overlay.file}` : undefined,
        });
      }
    }

    // Clear reported state for overlays that are no longer visible
    for (const key of reported) {
      if (!currentKeys.has(key)) {
        reported.delete(key);
      }
    }
  }

  // Initial check
  check();

  // Watch for DOM changes that might indicate overlay appearance/removal
  const observer = new MutationObserver(() => {
    // Debounce: requestAnimationFrame to batch rapid DOM mutations
    requestAnimationFrame(check);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  return () => {
    observer.disconnect();
    reported.clear();
  };
}
