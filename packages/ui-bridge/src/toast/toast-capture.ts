/**
 * Toast/Notification Capture
 *
 * Captures transient toast notifications by observing DOM mutations and
 * matching against known toast library selectors. Tracks appearance and
 * dismissal, infers severity level, and maintains a ring buffer of recent
 * toasts for snapshot integration.
 *
 * A captured element's text is LIVE state, not a copy taken at capture. A
 * live region (`role="status"`) announces by changing its text in place, so
 * each entry is one ANNOUNCEMENT: `reconcile` re-reads every tracked element
 * on the poll AND at every public read, and
 *  - a changed text dismisses the old entry into `recent` and captures the new
 *    text as a new entry (a `dismissed` then an `appeared` event);
 *  - an emptied or hidden element is dismissed and "parked" — kept on a short
 *    list and re-read, so a later different text is captured again;
 *  - the max-age guard applies per announcement, and parks the element too.
 * Reading at snapshot time means a backgrounded tab, whose interval timer the
 * browser throttles, never serves text the page stopped showing.
 *
 * A visible element that matches a selector but has no text yet is parked
 * with `''` by the scan, like an emptied one: it is re-read only when it
 * mutates, and its first text is captured as an announcement. A match the
 * scan first sees HIDDEN is parked with `''` too, like an active element that
 * is hidden: its visibility is re-checked on each poll, each read and each
 * scan its selector still matches, so a reveal by style alone (a fade-in, a
 * display or visibility toggle, an ancestor shown by `display`, opacity or
 * `visibility`) — which no `childList` record announces — is captured, and it
 * is cloned only once it is shown. Visibility is decided along the flat-tree
 * ancestry: an ancestor with `display: none`, or an effective opacity (the
 * product of the element's and every ancestor's) below 0.1, hides the element;
 * each ancestor's style is read at most once per pass, and a match's own once
 * per visibility check (the scan's verdict seeds the tracking it starts).
 *
 * Re-reading is gated on mutation: every tracked (active or parked) element
 * has its own MutationObserver (an active entry that survives uninstall has
 * none until the next install's first reconcile re-tracks it; an untracked
 * element always counts as dirty, so it is re-read then), and
 * `extractMessage` (a deep clone) runs for it only when its subtree
 * mutated — the observer's callback marks it dirty, and a synchronous
 * `takeRecords()` drain catches a change made in the same
 * tick as the read — or when one of the two inputs outside its subtree, its
 * visibility or an ancestor redaction boundary, flipped. The ancestor
 * redaction check itself is never gated.
 *
 * Churn is bounded per element, beside the max-age guard: at most
 * `maxAnnouncementsPerWindow` captures of one element within
 * `announcementWindowMs`. The capture that would exceed it is withheld and the
 * element is parked SUPPRESSED, its changes absorbed with no event. It is
 * released once its observed text has been unchanged for
 * `announcementWindowMs`; its settled text, if not empty, is then captured
 * once (the trailing announcement) — even when it equals an earlier
 * announcement, whose entry was dismissed when suppression began and so is no
 * longer in `active`.
 *
 * "One element" survives re-keying: a NEW node on the same `id` /
 * `data-testid` that REPLACES a node gone in the same mutation batch (the
 * old node was connected at the end of the previous scan) continues that
 * node's budget while it is warm — decided at the new node's first sighting
 * by the scan, before it has any text (a capture inside the window, or still
 * absorbing changes), so a React `key={count}` ticker that replaces its node
 * on every tick is held to the same bound and suppression — even beside a
 * static sibling on the same id. A node that left in an EARLIER batch (a
 * distinct toast reusing the id), a node already present when its sibling
 * leaves, a connected sibling, a cold budget, and an element with neither
 * attribute all start fresh (`announcement-budget.ts`).
 *
 * No withheld text is left in `active`. The element itself has no entry when
 * the budget withholds it (the active reconcile dismisses before asking; a
 * parked or newly scanned element has none). A withheld re-keyed node's
 * disconnected predecessor may still hold its entry, under the same id; it is
 * dismissed by the next reconcile (it is no longer visible), and while
 * installed every public read runs a reconcile first, so no such read serves
 * it. After `uninstall` reads do not reconcile (`reconcileForRead`), so an
 * entry left by the last pass before it stays readable as it was.
 */

import type {
  CapturedToast,
  ToastCaptureConfig,
  ToastEventData,
  ToastLevel,
  ToastSnapshot,
  SnapshotToastContext,
} from './types';
import { classString } from '../core/class-name';
import { readAriaLabelAttr } from '../core/a11y';
import {
  BRIDGE_REDACT_ATTR,
  isContentRedacted,
  REDACTED_VALUE,
  textExcludingBoundaries,
  truncateKeepingSentinel,
} from '../core/redaction';
import { composedAncestry } from '../core/composed-tree';
import { AnnouncementBudgets } from './announcement-budget';

// ============================================================================
// Built-in selectors for common toast/notification libraries
// ============================================================================

// NOTE: bare `[aria-live="polite"]` / `[aria-live="assertive"]` are intentionally
// NOT in this list. They are too greedy — they match persistent status-bar text
// (e.g. "13 terminals open", "Analyzing: idle"), form-validation banners, and
// many other legit non-toast surfaces. Once captured, the walker tracks them
// indefinitely and surfaces `durationMs` in the hours+ range. Library-specific
// selectors below cover real toast libraries; apps with custom toast surfaces
// can register their own selectors via `customSelectors`.
const BUILT_IN_SELECTORS: string[] = [
  // ARIA roles
  '[role="alert"]',
  '[role="status"]',
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
// Max-age guard
// ============================================================================

/**
 * Defense-in-depth ceiling on how long ONE announcement (one text of a
 * captured element) can stay in the active set before being auto-dismissed.
 * Real toast notifications are transient (seconds). An unchanged text tracked
 * for longer than this is almost certainly a persistent UI surface that was
 * mis-classified (status bar, banner, form-validation region, sticky modal
 * toast, etc.). Auto-dismissing prevents `durationMs` from drifting into
 * hours/days in `/control/snapshot`. The element is parked, not forgotten: if
 * its text later changes, the new text is captured as a new announcement.
 *
 * Covers two failure modes:
 *  1. A user app uses a library with greedy selectors (e.g. bare aria-live).
 *  2. A future SDK addition reintroduces a greedy selector into BUILT_IN_SELECTORS.
 */
const MAX_TOAST_AGE_MS = 60_000;

/** Default per-element announcement budget (captures per window). */
const MAX_ANNOUNCEMENTS_PER_WINDOW = 4;
/** Default budget window, and the quiet period that releases suppression. */
const ANNOUNCEMENT_WINDOW_MS = 10_000;

/**
 * `maxAnnouncementsPerWindow` as used: a whole number of at least 1 (0 or a
 * negative value would suppress every element before its first announcement);
 * absent or not finite, the default.
 */
function budgetSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return MAX_ANNOUNCEMENTS_PER_WINDOW;
  return Math.max(1, Math.floor(value));
}

/**
 * `announcementWindowMs` as used: absent, not finite, or below 1 ms (which
 * would keep no capture in the window and so disable the budget), the default.
 */
function budgetWindowMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) return ANNOUNCEMENT_WINDOW_MS;
  return value;
}

/**
 * Options of each tracked element's own MutationObserver. `attributeFilter`
 * names every attribute `extractMessage` reads inside the subtree: `role` and
 * `aria-label` (which buttons are stripped), `data-bridge-redact` (a boundary
 * reads as the sentinel), and `hidden` / `style` (a non-rendered descendant's
 * text is excluded). The element's own visibility is checked on every pass
 * anyway, so `class` and any other attribute changes nothing a re-read sees.
 */
const TRACKED_OBSERVER_OPTIONS: MutationObserverInit = {
  characterData: true,
  childList: true,
  attributes: true,
  attributeFilter: ['role', 'aria-label', BRIDGE_REDACT_ATTR, 'hidden', 'style'],
  subtree: true,
};

/** A tracked element's observer and its last outside-subtree verdicts. */
interface TrackedElement {
  observer: MutationObserver;
  visible: boolean;
  redacted: boolean;
}

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
  const className = classString(el);
  if (!className) return null;

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

  const className = classString(el);
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
    const ariaLabel = (readAriaLabelAttr(btn) || '').toLowerCase();
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
    // §4.6: the emitted action text excludes any boundary in (or around) the
    // button; the raw `text` above is only compared, never emitted.
    const shown = (textExcludingBoundaries(btn) || '').trim();
    return { hasAction: true, actionText: truncateKeepingSentinel(shown, 100) };
  }
  return { hasAction: false };
}

// ============================================================================
// Text extraction
// ============================================================================

function extractMessage(el: Element): string {
  // §4.6: a toast inside a redaction boundary reports only the sentinel.
  if (isContentRedacted(el as HTMLElement)) return REDACTED_VALUE;
  // Clone the element to strip action buttons for clean text
  const clone = el.cloneNode(true) as Element;

  // Remove close buttons and action buttons from clone
  const buttons = clone.querySelectorAll('button, [role="button"]');
  buttons.forEach((btn) => {
    const ariaLabel = (readAriaLabelAttr(btn) || '').toLowerCase();
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

  // A boundary inside the toast reads as the sentinel.
  const text = (textExcludingBoundaries(clone) || '').trim();
  // Collapse whitespace
  const collapsed = text.replace(/\s+/g, ' ');
  return truncateKeepingSentinel(collapsed, 500);
}

// ============================================================================
// Visibility check
// ============================================================================

/**
 * The element's stable identity across node replacement: its `id`, else its
 * `data-testid`, else `''` (none). The reported toast id and the announcement
 * budget's key both come from here, so they cannot drift apart.
 */
function stableKey(el: Element): string {
  return el.id || el.getAttribute('data-testid') || '';
}

/**
 * A per-pass cache for `isElementVisible`'s ancestor walk: each node maps to
 * its effective opacity — its own opacity times every flat-tree ancestor's —
 * or `0` when it or a node above it hides its subtree (`display: none`, or an
 * unslotted light child of an open shadow host). Sound only while no style can
 * change, which is why `runPass` creates one per pass and drops it after.
 */
type VisibilityMemo = Map<Element, number>;

/** An opacity value as a factor in [0, 1]; unparseable (jsdom's `""`) is 1. */
function opacityFactor(value: string): number {
  const opacity = parseFloat(value);
  if (isNaN(opacity)) return 1;
  return Math.min(1, Math.max(0, opacity));
}

/**
 * `node`'s own contribution to its subtree's effective opacity: `0` when it
 * hides the subtree, else its opacity factor. A `display: contents` node has
 * no box, so it adds no factor. A `getComputedStyle` that throws treats the
 * node as not hiding.
 */
function subtreeFactor(node: Element): number {
  // An open shadow host renders only the light children its slots take.
  if (node.parentElement?.shadowRoot && !node.assignedSlot) return 0;
  try {
    const computed = getComputedStyle(node);
    if (computed.display === 'none') return 0;
    if (computed.display === 'contents') return 1;
    return opacityFactor(computed.opacity);
  } catch {
    return 1;
  }
}

/**
 * The effective opacity `chain[1]` hands down to `chain[0]`: the product of
 * every ancestor's factor (`chain` is `composedAncestry(el)`, innermost
 * first). It stops at the nearest ancestor already in `memo` and records
 * every ancestor it computes, so each ancestor's style is read once per
 * pass.
 */
function ancestorOpacity(chain: Element[], memo?: VisibilityMemo | null): number {
  let top = 1;
  let inherited = 1;
  for (; top < chain.length; top++) {
    const known = memo?.get(chain[top]);
    if (known !== undefined) {
      inherited = known;
      break;
    }
  }
  for (let i = top - 1; i >= 1; i--) {
    if (inherited !== 0) inherited *= subtreeFactor(chain[i]);
    memo?.set(chain[i], inherited);
  }
  return inherited;
}

/**
 * Whether `el` is on screen as far as style can tell: its own inline and
 * computed `display` / `visibility` / `opacity`, then its flat-tree ancestry
 * (`composedAncestry`: a slotted node's parent is its slot, a shadow root is
 * crossed to its host). An ancestor with `display: none` hides it, and so
 * does an effective opacity — the product of its own and every ancestor's —
 * below 0.1. `visibility` is not walked: it inherits, so the own computed
 * value already carries an ancestor's. The ancestor walk runs only for an
 * element that is itself visible; `memo` (one per pass) bounds it to one
 * style read per distinct ancestor.
 *
 * Still read as visible, because style alone does not say: an unslotted light
 * child of a host whose shadow root is CLOSED (`shadowRoot` is `null`, so the
 * slot rule cannot see it), the body of a closed `<details>`, and a slot's
 * fallback content while the slot has assigned nodes.
 */
function isElementVisible(el: Element, memo?: VisibilityMemo | null): boolean {
  if (!el.isConnected) return false;
  const htmlEl = el as HTMLElement;
  // An own opacity below 0.1 hides `el` unless it is `display: contents`
  // (no box, so its opacity paints nothing), which only the computed style
  // can tell; so an inline one is decided there when computed style exists.
  let inlineFaded = false;
  if (htmlEl.style) {
    if (htmlEl.style.display === 'none') return false;
    if (htmlEl.style.visibility === 'hidden') return false;
    const opacity = parseFloat(htmlEl.style.opacity);
    inlineFaded = !isNaN(opacity) && opacity < 0.1;
  }
  // Check computed style if available
  if (typeof getComputedStyle !== 'function') return !inlineFaded;
  let ownFactor = 1;
  try {
    const computed = getComputedStyle(el);
    if (computed.display === 'none') return false;
    if (computed.visibility === 'hidden') return false;
    if (computed.display !== 'contents') {
      if (inlineFaded) return false;
      const computedOpacity = parseFloat(computed.opacity);
      if (!isNaN(computedOpacity) && computedOpacity < 0.1) return false;
      ownFactor = opacityFactor(computed.opacity);
    }
  } catch {
    // getComputedStyle may throw in some environments
    if (inlineFaded) return false;
  }
  if (el.parentElement?.shadowRoot && !el.assignedSlot) {
    memo?.set(el, 0);
    return false;
  }
  const effective = ownFactor * ancestorOpacity(composedAncestry(el), memo);
  // Recorded for a nested match whose ancestor `el` is. A visible verdict
  // means `el` passed its own `visibility` check too, which this value does
  // not carry — and need not, since `visibility` inherits through style.
  memo?.set(el, effective);
  return effective >= 0.1;
}

// ============================================================================
// ToastCapture
// ============================================================================

export class ToastCapture {
  private config: Required<
    Pick<
      ToastCaptureConfig,
      | 'maxRecent'
      | 'recentRetention'
      | 'pollInterval'
      | 'maxToastAgeMs'
      | 'maxAnnouncementsPerWindow'
      | 'announcementWindowMs'
    >
  > & { customSelectors: string[] };

  private observer: MutationObserver | null = null;
  private pollTimerId: ReturnType<typeof setInterval> | null = null;
  /**
   * Elements dismissed while still connected, with the message they were
   * dismissed with: `''` for emptied text or a hidden element (so becoming
   * visible with any text is a new announcement), the unchanged text for one
   * past max-age, the absorbed (withheld) text for a suppressed one. A
   * visible element the scan finds with no text, or one first seen hidden by
   * the scan, is parked with `''` too.
   * `reconcile` checks them on every poll and every read — a style check, and
   * an extractMessage clone only when the element mutated (see `takeDirty`) —
   * captures one again when its text changes (subject to the announcement
   * budget), releases a suppressed one after its quiet period, and drops it
   * once it disconnects. The scan hands a parked element to the same step.
   * `uninstall` clears it, since nothing prunes it afterwards, so after a
   * re-install the initial scan announces every persistent region again,
   * unchanged text included.
   */
  private parked: Map<Element, string> = new Map();
  /**
   * Every tracked (active or parked) element's own MutationObserver plus its
   * last visibility and ancestor-redaction verdicts. An entry is added when the
   * element becomes tracked and removed by `untrack` when it ends up neither
   * active nor parked, or at `uninstall`.
   */
  private tracked: Map<Element, TrackedElement> = new Map();
  /** Tracked elements whose observer callback ran, or whose verdicts flipped. */
  private dirty: Set<Element> = new Set();
  /**
   * Announcement budgets, by node first; a re-keyed node (same `id` /
   * `data-testid`, replacing a node gone in the same scan batch) continues a
   * warm budget. See `announcement-budget.ts`.
   */
  private budgets: AnnouncementBudgets;
  /**
   * True while a scan or reconcile pass runs (`runPass`). Listeners are
   * called only after a pass ends, so a read made from a listener reconciles
   * normally and sees the completed state of the pass that raised the event.
   */
  private reconciling = false;
  /** Events raised during the running pass, delivered when it ends. */
  private pendingEvents: ToastEventData[] | null = null;
  /**
   * `isElementVisible`'s ancestor cache for the running pass (`runPass`),
   * `null` between passes. No listener runs during a pass — events are
   * delivered after it — so no style can change under it.
   */
  private visibilityMemo: VisibilityMemo | null = null;
  private activeToasts: Map<string, { toast: CapturedToast; element: Element }> = new Map();
  private recentToasts: CapturedToast[] = [];
  private totalCaptured = 0;
  private idCounter = 0;
  private installed = false;
  private onToastEvent: ((data: ToastEventData) => void) | undefined;
  private scanScheduled = false;
  private scanTimerId: ReturnType<typeof setTimeout> | null = null;
  private allSelectors: string[];

  constructor(config?: ToastCaptureConfig) {
    this.config = {
      maxRecent: config?.maxRecent ?? 20,
      customSelectors: config?.customSelectors ?? [],
      recentRetention: config?.recentRetention ?? 60000,
      pollInterval: config?.pollInterval ?? 500,
      maxToastAgeMs: config?.maxToastAgeMs ?? MAX_TOAST_AGE_MS,
      maxAnnouncementsPerWindow: budgetSize(config?.maxAnnouncementsPerWindow),
      announcementWindowMs: budgetWindowMs(config?.announcementWindowMs),
    };
    this.allSelectors = [...BUILT_IN_SELECTORS, ...this.config.customSelectors];
    this.budgets = new AnnouncementBudgets(this.config.announcementWindowMs);
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

    // A scan debounced before uninstall must not run after it: it would
    // capture, and attach per-element observers that nothing disconnects.
    // `scanForToasts` also returns when not installed; clearing the timeout is
    // what keeps a stale scan from running under a NEXT install, as a second
    // scan beside that install's own initial one.
    if (this.scanTimerId !== null) {
      clearTimeout(this.scanTimerId);
      this.scanTimerId = null;
    }

    this.onToastEvent = undefined;
    this.scanScheduled = false;
    // Parked elements are tracking state, not captured data: with no poll left
    // to prune disconnected ones, holding them would retain detached subtrees.
    // Every per-element observer goes with them, and so does the budget state,
    // so a re-install starts every element with a fresh budget.
    for (const el of [...this.tracked.keys()]) this.untrack(el);
    this.parked.clear();
    this.budgets.clear();
    // Intentionally do NOT clear captured data — let it be readable after uninstall
  }

  getSnapshot(): ToastSnapshot {
    this.reconcileForRead();
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
    this.reconcileForRead();
    return this.getActiveList();
  }

  getRecent(count?: number): CapturedToast[] {
    this.reconcileForRead();
    if (count !== undefined && count >= 0) {
      return this.recentToasts.slice(0, count);
    }
    return [...this.recentToasts];
  }

  /**
   * Reads reconcile only while installed. After `uninstall` the captured data
   * stays readable as it was left: a read must not capture, dismiss or park
   * with no observer running.
   */
  private reconcileForRead(): void {
    if (this.installed) this.reconcile(Date.now());
    else this.pruneRecent();
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
    this.scanTimerId = setTimeout(() => {
      this.scanTimerId = null;
      this.scanScheduled = false;
      this.scanForToasts();
    }, 0);
  }

  private scanForToasts(): void {
    if (typeof document === 'undefined') return;
    // Belt-and-braces: uninstall clears the pending scan timeout (pinned by
    // R10), so no queued scan reaches here after teardown. This guard only
    // covers a caller that bypasses scheduleScan; no test pins it alone.
    if (!this.installed) return;

    const selectorString = this.allSelectors.join(', ');
    let elements: NodeListOf<Element>;
    try {
      elements = document.querySelectorAll(selectorString);
    } catch {
      // Invalid selector — fall back to trying each individually
      elements = this.querySelectorsFallback();
    }

    // The scan runs as a pass like `reconcile`, so no capture can run nested
    // inside another one (which could overwrite an entry under a shared id).
    // One scan is one budget generation (see `announcement-budget.ts`): a node
    // that vanished in this same batch can be replaced by a new one.
    this.runPass(() => {
      this.budgets.beginScan();
      this.scanElements(elements, Date.now());
      this.budgets.endScan();
    });
  }

  private scanElements(elements: NodeListOf<Element>, now: number): void {
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      // A text change on an active element belongs to `reconcile`, which
      // dismisses the old announcement before capturing the new one.
      if (this.activeIdOf(el) !== undefined) continue;

      // A parked element belongs to the parked-reconcile step, which owns its
      // re-read gate and its suppression, so a childList mutation can neither
      // clone an unchanged element nor bypass the announcement budget.
      const parkedMessage = this.parked.get(el);
      if (parkedMessage !== undefined) {
        this.reconcileParked(el, parkedMessage, now);
        continue;
      }

      // The scan's sighting decides the node's budget now, before it has
      // text: a re-keyed node that mounts empty or hidden inherits as the
      // replacement it is, and a node already present keeps its own when a
      // sibling on its id leaves.
      this.budgets.sight(el, stableKey(el), now);

      // A hidden match is parked with '' (tracked by its own observer) and not
      // read: a reveal by style alone — own opacity / display / visibility, or
      // an ancestor's display, opacity or visibility — produces no childList
      // record, so no scan would ever revisit it; the parked step re-checks
      // its visibility on every poll and read and captures it once shown. Its
      // budget was decided by the sighting above, so a re-keyed node mounted
      // hidden keeps the budget it inherited.
      if (!isElementVisible(el, this.visibilityMemo)) {
        this.park(el, '', false);
        continue;
      }

      // A visible element with no text yet is parked with '' (tracked by its
      // own observer), so later scans re-read it only when it mutates, and an
      // in-place fill — a characterData change the document observer never
      // sees — reaches the poll's parked step. The cost moves from a clone
      // per scan to the parked step's visibility and redaction check: each
      // poll and each public read visits every connected element parked empty
      // (e.g. a permanently empty role="alert" form placeholder), and each scan
      // the ones its selector still matches; one that is hidden — first seen
      // hidden by the scan, or hidden since — pays only the visibility half,
      // and is cloned only once it is shown (and only if it mutated or its
      // visibility flipped).
      const message = extractMessage(el);
      if (!message) {
        this.park(el, '', true);
        continue;
      }

      if (this.admitCapture(el, message, now)) this.captureToast(el, message, now);
    }
  }

  /** The id of `el`'s entry in `active`, or `undefined` when it has none. */
  private activeIdOf(el: Element): string | undefined {
    for (const [id, entry] of this.activeToasts) {
      if (entry.element === el) return id;
    }
    return undefined;
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

  /**
   * The single owner of the "element becomes active" transition: it unparks
   * the element before inserting, and the scan re-checks the live active set
   * per element, so a scan capture and a reconcile capture of the same element
   * cannot both happen.
   *
   * `id` names the ELEMENT (its `id` or `data-testid`, which agents query by),
   * not the announcement: `recent` can hold several entries with one id.
   * Elements with neither get a fresh `toast-<n>` per announcement.
   *
   * Every caller asks `admitCapture` first, so the announcement budget has one
   * owner. The element's own observer is attached here if it has none, seeded
   * visible: every caller has just found `el` visible in the same pass (the
   * scan's `isElementVisible`, a reconcile's `trackedVisible`), so a second
   * `getComputedStyle` would only repeat that verdict.
   */
  private captureToast(el: Element, message: string, now: number): void {
    this.parked.delete(el);
    this.track(el, true);

    const id = this.resolveId(el, now);
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

    this.emit({ toast: { ...toast }, action: 'appeared' });
  }

  // ==========================================================================
  // Private: Dismissal detection
  // ==========================================================================

  private checkDismissals(): void {
    this.reconcile(Date.now());
  }

  /**
   * Re-derive every tracked element's state from the DOM. Run by the poll and
   * by every public read, so a read never depends on a (possibly throttled)
   * timer having fired.
   */
  private reconcile(now: number): void {
    this.runPass(() => {
      for (const [id, entry] of [...this.activeToasts]) {
        // An earlier step may already have dismissed or replaced this entry.
        if (this.activeToasts.get(id) !== entry) continue;
        this.reconcileActive(id, entry, now);
      }

      for (const el of [...this.parked.keys()]) {
        // An earlier step may already have captured or dropped this element.
        const parkedMessage = this.parked.get(el);
        if (parkedMessage === undefined) continue;
        this.reconcileParked(el, parkedMessage, now);
      }

      this.pruneRecent();
      this.budgets.prune(now);
    });
  }

  /**
   * The parked-reconcile step, run by `reconcile` and by the scan. A hidden or
   * emptied element is parked with `''`, so any text it shows next is a new
   * announcement; a changed text is captured, subject to the budget. A
   * suppressed element absorbs every change into `parked` and is released by
   * time — checked on every pass, even when the re-read gate says clean.
   */
  private reconcileParked(el: Element, parkedMessage: string, now: number): void {
    if (!el.isConnected) {
      this.untrack(el);
      return;
    }
    const message = this.trackedVisible(el) ? this.readTracked(el, parkedMessage) : '';

    const budget = this.budgets.get(el);
    if (budget?.suppressed) {
      if (message !== parkedMessage) {
        this.parked.set(el, message);
        budget.lastChangedAt = now;
      }
      if (now - budget.lastChangedAt < this.config.announcementWindowMs) return;
      // Quiet for a whole window: release, and announce the settled text (the
      // trailing announcement). Its last entry was dismissed when suppression
      // began, so even a text equal to an earlier announcement is not shown in
      // `active` until it is captured again.
      budget.suppressed = false;
      if (message && this.admitCapture(el, message, now)) {
        this.captureToast(el, message, now);
      }
      return;
    }

    if (!message) {
      // Same rule as an active element that is hidden or whose text is
      // emptied: the same text coming back is a new announcement.
      if (parkedMessage !== '') this.parked.set(el, '');
      return;
    }
    if (message !== parkedMessage && this.admitCapture(el, message, now)) {
      this.captureToast(el, message, now);
    }
  }

  /**
   * The announcement budget's one owner, asked before every `captureToast`.
   * `el`'s budget is the one the scan decided at its first sighting — its
   * own, or for a re-keyed node the warm budget of the node it replaced in
   * the same scan batch (`AnnouncementBudgets.sight`). Under
   * `maxAnnouncementsPerWindow` captures within `announcementWindowMs` it
   * records `now` and admits the capture. Otherwise — or while the budget is
   * already suppressed — it withholds it: `el` is suppressed and parked with
   * the withheld text. Callers pass an element with no entry in `active` (the
   * active reconcile dismisses the old entry before asking; the scan skips
   * active elements; a parked element has none), so no withheld word of `el`
   * is left in `active`; a gone predecessor's entry is the next reconcile's
   * (see the header comment).
   */
  private admitCapture(el: Element, message: string, now: number): boolean {
    const budget = this.budgets.getOrCreate(el, stableKey(el), now);
    if (!budget.suppressed) {
      const windowMs = this.config.announcementWindowMs;
      budget.captures = budget.captures.filter((t) => now - t < windowMs);
      if (budget.captures.length < this.config.maxAnnouncementsPerWindow) {
        budget.captures.push(now);
        return true;
      }
      budget.suppressed = true;
    }
    budget.lastChangedAt = now;
    // Seeded visible, like `captureToast`: every caller holds a visible verdict
    // for `el` from this pass.
    this.park(el, message, true);
    return false;
  }

  /**
   * Run one scan or reconcile pass. Passes do not nest: a pass started while
   * one is running returns at once. Events are queued during the pass and
   * delivered only after it ends, so every state transition (dismiss, then
   * park or recapture) completes before any listener runs. A listener that
   * reads therefore sees consistent state, and one that throws cannot leave an
   * element neither active nor parked. Every queued event is delivered even if
   * a listener throws; the first error is rethrown afterwards.
   */
  private runPass(pass: () => void): void {
    if (this.reconciling) return;
    this.reconciling = true;
    const queued: ToastEventData[] = [];
    this.pendingEvents = queued;
    // Created after the reentrancy guard, so a nested call cannot replace or
    // drop the running pass's memo.
    this.visibilityMemo = new Map();
    try {
      pass();
    } finally {
      this.visibilityMemo = null;
      this.pendingEvents = null;
      this.reconciling = false;
    }
    let firstError: unknown;
    let failed = false;
    for (const event of queued) {
      try {
        this.onToastEvent?.(event);
      } catch (err) {
        if (!failed) {
          failed = true;
          firstError = err;
        }
      }
    }
    if (failed) throw firstError;
  }

  private emit(event: ToastEventData): void {
    if (this.pendingEvents) this.pendingEvents.push(event);
    else this.onToastEvent?.(event);
  }

  private reconcileActive(
    id: string,
    entry: { toast: CapturedToast; element: Element },
    now: number
  ): void {
    const el = entry.element;
    if (!this.trackedVisible(el)) {
      this.dismissToast(id, now);
      // Parked with '' — the same rule as emptied text: becoming visible again
      // with any text is a new announcement. A disconnected element leaves
      // tracking altogether.
      if (el.isConnected) this.park(el, '');
      else this.untrack(el);
      return;
    }

    const message = this.readTracked(el, entry.toast.message);
    if (!message) {
      this.dismissToast(id, now);
      this.park(el, '');
      return;
    }
    if (message !== entry.toast.message) {
      // A changed text is a new announcement: the old one goes to `recent`.
      // Over the budget, `admitCapture` parks the element suppressed instead.
      this.dismissToast(id, now);
      if (this.admitCapture(el, message, now)) this.captureToast(el, message, now);
      return;
    }

    // Update durationMs for a still-visible, unchanged announcement
    const age = now - entry.toast.appearedAt;
    entry.toast.durationMs = age;
    // Max-age guard: an unchanged text tracked longer than maxToastAgeMs is
    // almost certainly a persistent UI surface that was mis-classified.
    // Auto-dismiss to keep durationMs bounded and to stop it from polluting
    // `/control/snapshot.toasts.active` indefinitely; park the element so a
    // later text change is still announced.
    if (age > this.config.maxToastAgeMs) {
      this.dismissToast(id, now);
      this.park(el, message);
    }
  }

  /**
   * Park `el` with `message` and track it. `visible` is a verdict the caller
   * has just computed; passing it spares `track` a second `isElementVisible`
   * (a `getComputedStyle`) on a first sighting.
   */
  private park(el: Element, message: string, visible?: boolean): void {
    this.parked.set(el, message);
    this.track(el, visible);
  }

  // ==========================================================================
  // Private: Re-read gate (one MutationObserver per tracked element)
  // ==========================================================================

  /**
   * Start tracking `el` (attach its own observer) if it is not tracked yet.
   * `visible` seeds the visibility verdict when the caller has just computed
   * it; otherwise it is computed here.
   */
  private track(el: Element, visible?: boolean): void {
    if (this.tracked.has(el)) return;
    const observer = new MutationObserver(() => {
      this.dirty.add(el);
    });
    observer.observe(el, TRACKED_OBSERVER_OPTIONS);
    this.tracked.set(el, {
      observer,
      visible: visible ?? isElementVisible(el, this.visibilityMemo),
      redacted: isContentRedacted(el as HTMLElement),
    });
  }

  /**
   * Stop tracking `el`: disconnect its observer and forget its dirty mark and
   * verdicts. Called wherever an element ends up neither active nor parked,
   * and for every element at `uninstall`.
   */
  private untrack(el: Element): void {
    const entry = this.tracked.get(el);
    if (entry) {
      entry.observer.disconnect();
      this.tracked.delete(el);
    }
    this.dirty.delete(el);
    this.parked.delete(el);
  }

  /**
   * `true` when `el` must be re-read: its observer holds undelivered records
   * (drained synchronously, so a change made in this tick counts), its
   * callback already marked it, or it is not tracked at all. Both terms are
   * needed: records are handed to the callback at the next microtask
   * checkpoint, after which `takeRecords()` returns none.
   */
  private takeDirty(el: Element): boolean {
    const entry = this.tracked.get(el);
    if (!entry) return true;
    const hadRecords = entry.observer.takeRecords().length > 0;
    const marked = this.dirty.delete(el);
    return hadRecords || marked;
  }

  /**
   * `isElementVisible`, ungated, recording a flip of a tracked element's
   * verdict as dirty: an ancestor's style change (its `display`, opacity or
   * `visibility`) produces no record in the element's own observer, yet it
   * changes what a re-read would see.
   */
  private trackedVisible(el: Element): boolean {
    const visible = isElementVisible(el, this.visibilityMemo);
    const entry = this.tracked.get(el);
    if (entry && entry.visible !== visible) {
      entry.visible = visible;
      this.dirty.add(el);
    }
    return visible;
  }

  /**
   * A tracked element's current message. The ancestor redaction check runs on
   * every call (it is outside the subtree, so no record announces it, and a
   * flip of it counts as dirty); the `extractMessage` clone runs only when the
   * element is dirty. Clean, it is `stored`, the message last read.
   */
  private readTracked(el: Element, stored: string): string {
    const redacted = isContentRedacted(el as HTMLElement);
    const entry = this.tracked.get(el);
    if (entry && entry.redacted !== redacted) {
      entry.redacted = redacted;
      this.dirty.add(el);
    }
    const dirty = this.takeDirty(el);
    if (!entry) this.track(el);
    if (redacted) return REDACTED_VALUE;
    return dirty ? extractMessage(el) : stored;
  }

  /**
   * One id per element in `active`. If the element's own id is held by a
   * DIFFERENT element (a React remount the scan saw before the poll saw the old
   * node go), the old entry is dismissed when it is no longer visible;
   * otherwise both are visible and the new entry gets `${id}#<n>`.
   */
  private resolveId(el: Element, now: number): string {
    const base = stableKey(el) || `toast-${++this.idCounter}`;
    const holder = this.activeToasts.get(base);
    if (!holder || holder.element === el) return base;

    if (!this.trackedVisible(holder.element)) {
      this.dismissToast(base, now);
      if (holder.element.isConnected) this.park(holder.element, '');
      else this.untrack(holder.element);
      return base;
    }

    let n = 2;
    while (this.activeToasts.has(`${base}#${n}`)) n++;
    return `${base}#${n}`;
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

    this.emit({ toast: { ...toast }, action: 'dismissed' });
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
