/**
 * Undo/Redo Detector
 *
 * Stateless on-demand DOM scanner for undo/redo availability.
 * Detects undo/redo buttons, menu items, and toolbar elements using:
 * - ARIA attributes (aria-label, aria-keyshortcuts)
 * - Title attributes
 * - Text content matching
 * - Common UI framework patterns
 * - document.execCommand probe (for contentEditable contexts)
 *
 * Follows the same stateless pattern as ModalDetector.
 */

import type { UndoElementInfo, UndoDetectorConfig } from './types';

// ---------------------------------------------------------------------------
// Selectors for common undo/redo patterns
// ---------------------------------------------------------------------------

/** CSS selectors for undo buttons/elements */
const UNDO_SELECTORS = [
  // ARIA labels
  'button[aria-label*="undo" i]',
  '[role="menuitem"][aria-label*="undo" i]',
  '[role="button"][aria-label*="undo" i]',
  // Title attributes
  'button[title*="undo" i]',
  '[role="menuitem"][title*="undo" i]',
  // Data attributes
  '[data-action="undo"]',
  '[data-command="undo"]',
  '[data-testid*="undo" i]',
  // ARIA keyshortcuts
  '[aria-keyshortcuts*="Control+z" i]',
  '[aria-keyshortcuts*="Meta+z" i]',
];

/** CSS selectors for redo buttons/elements */
const REDO_SELECTORS = [
  // ARIA labels
  'button[aria-label*="redo" i]',
  '[role="menuitem"][aria-label*="redo" i]',
  '[role="button"][aria-label*="redo" i]',
  // Title attributes
  'button[title*="redo" i]',
  '[role="menuitem"][title*="redo" i]',
  // Data attributes
  '[data-action="redo"]',
  '[data-command="redo"]',
  '[data-testid*="redo" i]',
  // ARIA keyshortcuts
  '[aria-keyshortcuts*="Control+Shift+z" i]',
  '[aria-keyshortcuts*="Control+y" i]',
  '[aria-keyshortcuts*="Meta+Shift+z" i]',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check whether we're in a browser with a DOM */
function hasDom(): boolean {
  return typeof document !== 'undefined';
}

/**
 * Build a CSS selector that can target the given element.
 */
function buildSelector(el: Element): string {
  if (el.id) {
    return `#${CSS.escape(el.id)}`;
  }

  const testId = el.getAttribute('data-testid');
  if (testId) {
    return `[data-testid="${CSS.escape(testId)}"]`;
  }

  const role = el.getAttribute('role');
  const tag = el.tagName.toLowerCase();

  if (role) {
    const siblings = Array.from(document.querySelectorAll(`${tag}[role="${role}"]`));
    if (siblings.length === 1) {
      return `${tag}[role="${CSS.escape(role)}"]`;
    }
    const index = siblings.indexOf(el);
    return `${tag}[role="${CSS.escape(role)}"]:nth-of-type(${index + 1})`;
  }

  const parent = el.parentElement;
  if (parent) {
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    if (sameTag.length === 1) {
      return tag;
    }
    const idx = sameTag.indexOf(el);
    return `${tag}:nth-of-type(${idx + 1})`;
  }

  return tag;
}

/**
 * Check if an element is disabled.
 */
function isDisabled(el: Element): boolean {
  if ((el as HTMLButtonElement).disabled) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  const classes = el.className;
  if (typeof classes === 'string' && classes.toLowerCase().includes('disabled')) return true;
  return false;
}

/**
 * Extract label text from an element.
 */
function extractLabel(el: Element): string | undefined {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  const title = el.getAttribute('title');
  if (title) return title.trim();

  const text = el.textContent?.trim();
  if (text && text.length < 100) return text;

  return undefined;
}

/**
 * Parse a description from an undo/redo label.
 * e.g., "Undo Typing" → "Typing", "Redo Delete" → "Delete"
 */
function parseDescription(label: string | undefined, type: 'undo' | 'redo'): string | undefined {
  if (!label) return undefined;

  const pattern = type === 'undo' ? /\bundo\s+(.+)/i : /\bredo\s+(.+)/i;

  const match = label.match(pattern);
  if (match?.[1]) {
    return match[1].trim();
  }

  return undefined;
}

/**
 * Find the best matching element from a set of selectors.
 * Returns the first enabled element, or the first element if all are disabled.
 */
function findBestElement(selectors: string[], type: 'undo' | 'redo'): UndoElementInfo | undefined {
  if (!hasDom()) return undefined;

  const seen = new Set<Element>();
  const elements: Element[] = [];

  for (const selector of selectors) {
    try {
      const matches = Array.from(document.querySelectorAll(selector));
      for (const el of matches) {
        if (!seen.has(el)) {
          seen.add(el);
          elements.push(el);
        }
      }
    } catch {
      // Invalid selector — skip
    }
  }

  // Also scan for text content matches in buttons
  try {
    const buttons = document.querySelectorAll('button, [role="button"], [role="menuitem"]');
    for (const btn of Array.from(buttons)) {
      if (seen.has(btn)) continue;
      const text = btn.textContent?.trim().toLowerCase() ?? '';
      if (type === 'undo' && (text === 'undo' || text.startsWith('undo '))) {
        seen.add(btn);
        elements.push(btn);
      } else if (type === 'redo' && (text === 'redo' || text.startsWith('redo '))) {
        seen.add(btn);
        elements.push(btn);
      }
    }
  } catch {
    // DOM access failed
  }

  if (elements.length === 0) return undefined;

  // Prefer enabled elements
  const enabled = elements.find((el) => !isDisabled(el));
  const best = enabled ?? elements[0];

  const label = extractLabel(best);
  return {
    selector: buildSelector(best),
    enabled: !isDisabled(best),
    label,
    parsedDescription: parseDescription(label, type),
  };
}

/**
 * Probe document.execCommand for undo/redo availability.
 * Works for contentEditable and basic form input contexts.
 *
 * Note: execCommand is deprecated but still widely supported.
 */
function probeExecCommand(): { undoAvailable: boolean; redoAvailable: boolean } {
  if (!hasDom()) return { undoAvailable: false, redoAvailable: false };

  try {
    return {
      undoAvailable: document.queryCommandEnabled('undo'),
      redoAvailable: document.queryCommandEnabled('redo'),
    };
  } catch {
    return { undoAvailable: false, redoAvailable: false };
  }
}

// ---------------------------------------------------------------------------
// Detection result (internal)
// ---------------------------------------------------------------------------

export interface UndoDetectionResult {
  /** Detected undo element info */
  undoElement?: UndoElementInfo;
  /** Detected redo element info */
  redoElement?: UndoElementInfo;
  /** Whether undo is available via execCommand */
  execCommandUndo: boolean;
  /** Whether redo is available via execCommand */
  execCommandRedo: boolean;
  /** Timestamp */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// UndoDetector
// ---------------------------------------------------------------------------

export class UndoDetector {
  private readonly config: Required<Pick<UndoDetectorConfig, 'useExecCommand'>> & {
    customUndoSelectors: string[];
    customRedoSelectors: string[];
  };

  constructor(config: UndoDetectorConfig = {}) {
    this.config = {
      customUndoSelectors: config.customUndoSelectors ?? [],
      customRedoSelectors: config.customRedoSelectors ?? [],
      useExecCommand: config.useExecCommand ?? true,
    };
  }

  /**
   * Scan the DOM for undo/redo availability.
   */
  detect(): UndoDetectionResult {
    const now = Date.now();

    if (!hasDom()) {
      return {
        undoElement: undefined,
        redoElement: undefined,
        execCommandUndo: false,
        execCommandRedo: false,
        timestamp: now,
      };
    }

    const allUndoSelectors = [...UNDO_SELECTORS, ...this.config.customUndoSelectors];
    const allRedoSelectors = [...REDO_SELECTORS, ...this.config.customRedoSelectors];

    const undoElement = findBestElement(allUndoSelectors, 'undo');
    const redoElement = findBestElement(allRedoSelectors, 'redo');

    let execCommandUndo = false;
    let execCommandRedo = false;
    if (this.config.useExecCommand) {
      const probe = probeExecCommand();
      execCommandUndo = probe.undoAvailable;
      execCommandRedo = probe.redoAvailable;
    }

    return {
      undoElement,
      redoElement,
      execCommandUndo,
      execCommandRedo,
      timestamp: now,
    };
  }
}
