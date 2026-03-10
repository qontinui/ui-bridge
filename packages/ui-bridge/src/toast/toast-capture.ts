/**
 * Toast/Notification Capture
 *
 * Captures transient toast notifications by observing DOM mutations and
 * matching against known toast library selectors. Tracks appearance and
 * dismissal, infers severity level, and maintains a ring buffer of recent
 * toasts for snapshot integration.
 */

import type {
  CapturedToast,
  ToastCaptureConfig,
  ToastEventData,
  ToastLevel,
  ToastSnapshot,
  SnapshotToastContext,
} from './types';

// ============================================================================
// Built-in selectors for common toast/notification libraries
// ============================================================================

const BUILT_IN_SELECTORS: string[] = [
  // ARIA roles
  '[role="alert"]',
  '[role="status"]',
  // ARIA live regions
  '[aria-live="polite"]',
  '[aria-live="assertive"]',
  // Sonner
  '[data-sonner-toast]',
  // Radix (children of viewport)
  '[data-radix-toast-viewport] > *',
  // React-Toastify
  '.Toastify__toast',
  // Ant Design
  '.ant-message-notice',
  '.ant-notification-notice',
  // MUI
  '.MuiSnackbar-root .MuiAlert-root',
  '.MuiSnackbar-root',
  // Chakra UI
  '.chakra-toast',
  '.chakra-alert',
  // Bootstrap (exclude inside modals/dialogs)
  '.toast:not(dialog .toast):not([role="dialog"] .toast)',
  // Generic data attributes
  '[data-toast]',
  '[data-notification]',
];

// ============================================================================
// Level inference helpers
// ============================================================================

/** Map of CSS class substrings to toast level */
const CLASS_LEVEL_MAP: Array<[RegExp, ToastLevel]> = [
  [/\bsuccess\b/i, 'success'],
  [/\berror\b/i, 'error'],
  [/\bdestructive\b/i, 'error'],
  [/\bdanger\b/i, 'error'],
  [/\bwarning\b/i, 'warning'],
  [/\bwarn\b/i, 'warning'],
  [/\binfo\b/i, 'info'],
  [/\bloading\b/i, 'loading'],
];

/** Infer level from a data attribute value */
function levelFromDataAttr(value: string | null): ToastLevel | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v === 'success') return 'success';
  if (v === 'error' || v === 'destructive' || v === 'danger') return 'error';
  if (v === 'warning' || v === 'warn') return 'warning';
  if (v === 'info' || v === 'default') return 'info';
  if (v === 'loading') return 'loading';
  return null;
}

/** Infer level from CSS classes on the element and its children */
function levelFromClasses(el: Element): ToastLevel | null {
  const className = el.className;
  if (typeof className !== 'string') return null;

  // MUI-specific classes
  if (className.includes('MuiAlert-standardSuccess')) return 'success';
  if (className.includes('MuiAlert-standardError')) return 'error';
  if (className.includes('MuiAlert-standardWarning')) return 'warning';
  if (className.includes('MuiAlert-standardInfo')) return 'info';
  if (className.includes('MuiAlert-filledSuccess')) return 'success';
  if (className.includes('MuiAlert-filledError')) return 'error';
  if (className.includes('MuiAlert-filledWarning')) return 'warning';
  if (className.includes('MuiAlert-filledInfo')) return 'info';

  // Ant Design-specific classes
  if (
    className.includes('ant-message-success') ||
    className.includes('ant-notification-notice-success')
  )
    return 'success';
  if (
    className.includes('ant-message-error') ||
    className.includes('ant-notification-notice-error')
  )
    return 'error';
  if (
    className.includes('ant-message-warning') ||
    className.includes('ant-notification-notice-warning')
  )
    return 'warning';
  if (className.includes('ant-message-info') || className.includes('ant-notification-notice-info'))
    return 'info';
  if (className.includes('ant-message-loading')) return 'loading';

  // Generic class patterns
  for (const [pattern, level] of CLASS_LEVEL_MAP) {
    if (pattern.test(className)) return level;
  }

  return null;
}

/** Infer level from ARIA role if no other hint is available */
function levelFromRole(el: Element): ToastLevel | null {
  const role = el.getAttribute('role');
  if (role === 'alert') return 'error';
  if (role === 'status') return 'info';
  return null;
}

/** Detect the toast level for an element */
function inferLevel(el: Element): ToastLevel {
  // 1. Explicit data attributes
  const fromType = levelFromDataAttr(el.getAttribute('data-type'));
  if (fromType) return fromType;

  const fromLevel = levelFromDataAttr(el.getAttribute('data-level'));
  if (fromLevel) return fromLevel;

  // 2. CSS classes on element itself
  const fromClass = levelFromClasses(el);
  if (fromClass) return fromClass;

  // 3. CSS classes on child elements (e.g. MuiAlert inside MuiSnackbar)
  const children = el.querySelectorAll('*');
  for (let i = 0; i < children.length; i++) {
    const childLevel = levelFromClasses(children[i]);
    if (childLevel) return childLevel;
  }

  // 4. ARIA role fallback
  const fromRole = levelFromRole(el);
  if (fromRole) return fromRole;

  return 'unknown';
}

// ============================================================================
// Source detection
// ============================================================================

function detectSource(el: Element): string | undefined {
  if (el.hasAttribute('data-sonner-toast')) return 'sonner';
  if (el.closest('[data-radix-toast-viewport]')) return 'radix';

  const className = typeof el.className === 'string' ? el.className : '';
  if (className.includes('Toastify')) return 'react-toastify';
  if (className.includes('ant-message') || className.includes('ant-notification'))
    return 'ant-design';
  if (className.includes('MuiSnackbar') || className.includes('MuiAlert')) return 'mui';
  if (className.includes('chakra-toast') || className.includes('chakra-alert')) return 'chakra';
  if (className.includes('toast') && !className.includes('Toastify')) return 'bootstrap';

  return undefined;
}

// ============================================================================
// Action button detection
// ============================================================================

interface ActionInfo {
  hasAction: boolean;
  actionText?: string;
}

function detectAction(el: Element): ActionInfo {
  // Look for buttons inside the toast (exclude close/dismiss buttons)
  const buttons = el.querySelectorAll('button, [role="button"], a[href]');
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    const text = (btn.textContent || '').trim();
    // Skip close/dismiss buttons
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    if (
      ariaLabel === 'close' ||
      ariaLabel === 'dismiss' ||
      text === '\u00d7' || // &times;
      text.toLowerCase() === 'close' ||
      text.toLowerCase() === 'dismiss' ||
      text === '' ||
      text === 'x' ||
      text === 'X'
    ) {
      continue;
    }
    return { hasAction: true, actionText: text.substring(0, 100) };
  }
  return { hasAction: false };
}

// ============================================================================
// Text extraction
// ============================================================================

function extractMessage(el: Element): string {
  // Clone the element to strip action buttons for clean text
  const clone = el.cloneNode(true) as Element;

  // Remove close buttons and action buttons from clone
  const buttons = clone.querySelectorAll('button, [role="button"]');
  buttons.forEach((btn) => {
    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
    const text = (btn.textContent || '').trim().toLowerCase();
    if (
      ariaLabel === 'close' ||
      ariaLabel === 'dismiss' ||
      text === '\u00d7' ||
      text === 'close' ||
      text === 'dismiss' ||
      text === 'x' ||
      text === ''
    ) {
      btn.remove();
    }
  });

  const text = (clone.textContent || '').trim();
  // Collapse whitespace
  const collapsed = text.replace(/\s+/g, ' ');
  return collapsed.substring(0, 500);
}

// ============================================================================
// Visibility check
// ============================================================================

function isElementVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const htmlEl = el as HTMLElement;
  if (htmlEl.style) {
    if (htmlEl.style.display === 'none') return false;
    if (htmlEl.style.visibility === 'hidden') return false;
    const opacity = parseFloat(htmlEl.style.opacity);
    if (!isNaN(opacity) && opacity < 0.1) return false;
  }
  // Check computed style if available
  if (typeof getComputedStyle === 'function') {
    try {
      const computed = getComputedStyle(el);
      if (computed.display === 'none') return false;
      if (computed.visibility === 'hidden') return false;
      const computedOpacity = parseFloat(computed.opacity);
      if (!isNaN(computedOpacity) && computedOpacity < 0.1) return false;
    } catch {
      // getComputedStyle may throw in some environments
    }
  }
  return true;
}

// ============================================================================
// ToastCapture
// ============================================================================

export class ToastCapture {
  private config: Required<
    Pick<ToastCaptureConfig, 'maxRecent' | 'recentRetention' | 'pollInterval'>
  > & { customSelectors: string[] };

  private observer: MutationObserver | null = null;
  private pollTimerId: ReturnType<typeof setInterval> | null = null;
  private capturedElements = typeof WeakSet !== 'undefined' ? new WeakSet<Element>() : null;
  private activeToasts: Map<string, { toast: CapturedToast; element: Element }> = new Map();
  private recentToasts: CapturedToast[] = [];
  private totalCaptured = 0;
  private idCounter = 0;
  private installed = false;
  private onToastEvent: ((data: ToastEventData) => void) | undefined;
  private scanScheduled = false;
  private allSelectors: string[];

  constructor(config?: ToastCaptureConfig) {
    this.config = {
      maxRecent: config?.maxRecent ?? 20,
      customSelectors: config?.customSelectors ?? [],
      recentRetention: config?.recentRetention ?? 60000,
      pollInterval: config?.pollInterval ?? 500,
    };
    this.allSelectors = [...BUILT_IN_SELECTORS, ...this.config.customSelectors];
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  install(onToastEvent?: (data: ToastEventData) => void): void {
    if (typeof document === 'undefined') return;
    if (this.installed) return;
    this.installed = true;
    this.onToastEvent = onToastEvent;

    // Set up MutationObserver
    this.observer = new MutationObserver(() => {
      this.scheduleScan();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Set up polling for dismissal detection
    this.pollTimerId = setInterval(() => {
      this.checkDismissals();
    }, this.config.pollInterval);

    // Initial scan for any toasts already present
    this.scanForToasts();
  }

  uninstall(): void {
    if (!this.installed) return;
    this.installed = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.pollTimerId !== null) {
      clearInterval(this.pollTimerId);
      this.pollTimerId = null;
    }

    this.onToastEvent = undefined;
    this.scanScheduled = false;
    // Intentionally do NOT clear captured data — let it be readable after uninstall
  }

  getSnapshot(): ToastSnapshot {
    this.pruneRecent();
    return {
      active: this.getActiveList(),
      recent: [...this.recentToasts],
      totalCaptured: this.totalCaptured,
    };
  }

  getSnapshotToastContext(): SnapshotToastContext {
    const snapshot = this.getSnapshot();
    return {
      active: snapshot.active,
      recent: snapshot.recent,
      totalCaptured: snapshot.totalCaptured,
    };
  }

  getActive(): CapturedToast[] {
    return this.getActiveList();
  }

  getRecent(count?: number): CapturedToast[] {
    this.pruneRecent();
    if (count !== undefined && count >= 0) {
      return this.recentToasts.slice(0, count);
    }
    return [...this.recentToasts];
  }

  // ==========================================================================
  // Private: Scanning
  // ==========================================================================

  private scheduleScan(): void {
    if (this.scanScheduled) return;
    this.scanScheduled = true;

    // Debounce with a microtask-level delay to batch rapid DOM mutations.
    // Using setTimeout(0) instead of requestAnimationFrame for better
    // compatibility with test environments (fake timers + JSDOM).
    setTimeout(() => {
      this.scanScheduled = false;
      this.scanForToasts();
    }, 0);
  }

  private scanForToasts(): void {
    if (typeof document === 'undefined') return;

    const selectorString = this.allSelectors.join(', ');
    let elements: NodeListOf<Element>;
    try {
      elements = document.querySelectorAll(selectorString);
    } catch {
      // Invalid selector — fall back to trying each individually
      elements = this.querySelectorsFallback();
    }

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (this.capturedElements?.has(el)) continue;
      if (!isElementVisible(el)) continue;

      // Skip elements with no meaningful text
      const message = extractMessage(el);
      if (!message) continue;

      this.captureToast(el, message);
    }
  }

  private querySelectorsFallback(): NodeListOf<Element> {
    const results: Element[] = [];
    for (const selector of this.allSelectors) {
      try {
        const found = document.querySelectorAll(selector);
        for (let i = 0; i < found.length; i++) {
          results.push(found[i]);
        }
      } catch {
        // Skip invalid individual selectors
      }
    }
    // Return an array-like that matches NodeListOf<Element> usage
    return results as unknown as NodeListOf<Element>;
  }

  private captureToast(el: Element, message: string): void {
    this.capturedElements?.add(el);

    const now = Date.now();
    const id = el.id || el.getAttribute('data-testid') || `toast-${++this.idCounter}`;
    const level = inferLevel(el);
    const source = detectSource(el);
    const action = detectAction(el);

    const toast: CapturedToast = {
      id,
      message,
      level,
      appearedAt: now,
      visible: true,
      durationMs: 0,
      source,
      hasAction: action.hasAction,
      actionText: action.actionText,
    };

    this.activeToasts.set(id, { toast, element: el });
    this.totalCaptured++;

    this.onToastEvent?.({ toast: { ...toast }, action: 'appeared' });
  }

  // ==========================================================================
  // Private: Dismissal detection
  // ==========================================================================

  private checkDismissals(): void {
    const now = Date.now();
    const toDismiss: string[] = [];

    for (const [id, entry] of this.activeToasts) {
      if (!isElementVisible(entry.element)) {
        toDismiss.push(id);
      } else {
        // Update durationMs for still-visible toasts
        entry.toast.durationMs = now - entry.toast.appearedAt;
      }
    }

    for (const id of toDismiss) {
      this.dismissToast(id, now);
    }

    // Prune old recent toasts
    this.pruneRecent();
  }

  private dismissToast(id: string, now: number): void {
    const entry = this.activeToasts.get(id);
    if (!entry) return;

    const toast = entry.toast;
    toast.visible = false;
    toast.dismissedAt = now;
    toast.durationMs = now - toast.appearedAt;

    this.activeToasts.delete(id);
    this.recentToasts.unshift({ ...toast });

    // Trim recent buffer
    if (this.recentToasts.length > this.config.maxRecent) {
      this.recentToasts = this.recentToasts.slice(0, this.config.maxRecent);
    }

    this.onToastEvent?.({ toast: { ...toast }, action: 'dismissed' });
  }

  private pruneRecent(): void {
    const cutoff = Date.now() - this.config.recentRetention;
    this.recentToasts = this.recentToasts.filter(
      (t) => t.dismissedAt !== undefined && t.dismissedAt >= cutoff
    );
  }

  // ==========================================================================
  // Private: Helpers
  // ==========================================================================

  private getActiveList(): CapturedToast[] {
    const now = Date.now();
    const result: CapturedToast[] = [];
    for (const entry of this.activeToasts.values()) {
      result.push({
        ...entry.toast,
        durationMs: now - entry.toast.appearedAt,
      });
    }
    return result;
  }
}
