/**
 * DOM Fallback Discovery
 *
 * When the SDK's component-level registry returns zero elements, this module
 * provides a querySelectorAll-based fallback that finds interactive elements
 * directly from the DOM. This ensures discovery always returns something useful
 * regardless of how the app integrates the SDK.
 */

/** Selectors for standard interactive DOM elements. */
const INTERACTIVE_SELECTORS = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="textbox"]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  '[onclick]',
  '[data-ui-element]',
  '[data-testid]',
];

const COMBINED_SELECTOR = INTERACTIVE_SELECTORS.join(', ');

/** Infer element type from a raw DOM element. */
function inferType(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  if (role) return role;
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'input') {
    const inputType = (el as HTMLInputElement).type?.toLowerCase() ?? 'text';
    if (inputType === 'checkbox') return 'checkbox';
    if (inputType === 'radio') return 'radio';
    if (inputType === 'submit' || inputType === 'button' || inputType === 'reset') return 'button';
    return 'input';
  }
  if (el.hasAttribute('contenteditable')) return 'textbox';
  return 'interactive';
}

/** Infer supported actions from element type. */
function inferActions(type: string): string[] {
  switch (type) {
    case 'button':
      return ['click'];
    case 'link':
      return ['click'];
    case 'input':
    case 'textbox':
    case 'textarea':
      return ['click', 'type', 'clear', 'focus'];
    case 'checkbox':
    case 'radio':
    case 'switch':
      return ['click', 'toggle'];
    case 'select':
    case 'combobox':
    case 'listbox':
      return ['click', 'select'];
    case 'tab':
    case 'menuitem':
    case 'option':
      return ['click'];
    case 'slider':
    case 'spinbutton':
      return ['click', 'setValue'];
    default:
      return ['click'];
  }
}

/** Get the accessible label for an element. */
function getLabel(el: HTMLElement): string {
  // aria-label takes precedence
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent?.trim() ?? '';
  }

  // Associated <label> for form inputs
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    if (el.id) {
      const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent?.trim() ?? '';
    }
  }

  // title attribute
  const title = el.getAttribute('title');
  if (title) return title;

  // placeholder for inputs
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.placeholder) return el.placeholder;
  }

  // Direct text content (capped for perf)
  const text = el.textContent?.trim() ?? '';
  return text.length > 200 ? text.slice(0, 200) + '…' : text;
}

/** Check if element is visible (not hidden/zero-size). */
function isVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Generate a stable ID for an element. */
function generateId(el: HTMLElement, index: number): string {
  // Prefer data-testid
  const testId = el.getAttribute('data-testid');
  if (testId) return `dom-${testId}`;

  // Try id attribute
  if (el.id) return `dom-${el.id}`;

  // Semantic fallback: tag + type + text snippet
  const tag = el.tagName.toLowerCase();
  const type = inferType(el);
  const text = getLabel(el).slice(0, 30).replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  if (text) return `dom-${tag}-${text}`;

  return `dom-${type}-${index}`;
}

export interface DOMFallbackElement {
  id: string;
  type: string;
  label: string;
  actions: string[];
  visible: boolean;
  tagName: string;
  state: {
    textContent: string;
    value?: string;
    checked?: boolean;
    disabled?: boolean;
    visible: boolean;
    enabled: boolean;
    focused: boolean;
    rect: {
      x: number;
      y: number;
      width: number;
      height: number;
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
  };
  identifiers: {
    testId?: string;
    ariaLabel?: string;
    htmlId?: string;
  };
  _domFallback: true;
}

/**
 * Scan the DOM for interactive elements as a fallback when the SDK registry is empty.
 * Returns structured element data compatible with the standard discovery response format.
 */
export function scanDOMForInteractiveElements(root?: HTMLElement): DOMFallbackElement[] {
  const container = root ?? document.body;
  if (!container) return [];

  const nodeList = container.querySelectorAll<HTMLElement>(COMBINED_SELECTOR);
  const elements: DOMFallbackElement[] = [];
  const seenIds = new Set<string>();

  nodeList.forEach((el, index) => {
    let id = generateId(el, index);
    // Disambiguate collisions
    if (seenIds.has(id)) {
      let suffix = 2;
      while (seenIds.has(`${id}-${suffix}`)) suffix++;
      id = `${id}-${suffix}`;
    }
    seenIds.add(id);

    const type = inferType(el);
    const rect = el.getBoundingClientRect();

    elements.push({
      id,
      type,
      label: getLabel(el),
      actions: inferActions(type),
      visible: isVisible(el),
      tagName: el.tagName.toLowerCase(),
      state: {
        textContent: (el.textContent?.trim() ?? '').slice(0, 500),
        value: 'value' in el ? (el as HTMLInputElement).value : undefined,
        checked: 'checked' in el ? (el as HTMLInputElement).checked : undefined,
        disabled: 'disabled' in el ? (el as HTMLInputElement).disabled : undefined,
        visible: isVisible(el),
        enabled: !('disabled' in el && (el as HTMLInputElement).disabled),
        focused: document.activeElement === el,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          left: Math.round(rect.left),
        },
      },
      identifiers: {
        testId: el.getAttribute('data-testid') ?? undefined,
        ariaLabel: el.getAttribute('aria-label') ?? undefined,
        htmlId: el.id || undefined,
      },
      _domFallback: true,
    });
  });

  return elements;
}

/**
 * Count interactive DOM elements without building full element objects.
 * Used by the diagnostics endpoint.
 */
export function countDOMInteractiveElements(root?: HTMLElement): number {
  const container = root ?? document.body;
  if (!container) return 0;
  return container.querySelectorAll<HTMLElement>(COMBINED_SELECTOR).length;
}

/**
 * Find a DOM element by visible text content and optional tag/selector filter.
 */
export function findElementsByText(
  text: string,
  options?: { tag?: string; exact?: boolean; root?: HTMLElement }
): HTMLElement[] {
  const container = options?.root ?? document.body;
  if (!container) return [];

  const selector = options?.tag ?? '*';
  const candidates = container.querySelectorAll<HTMLElement>(selector);
  const results: HTMLElement[] = [];
  const searchText = text.toLowerCase();

  candidates.forEach((el) => {
    // Use direct text, not deeply nested text for non-leaf nodes
    const elText = el.textContent?.trim().toLowerCase() ?? '';
    if (options?.exact ? elText === searchText : elText.includes(searchText)) {
      results.push(el);
    }
  });

  return results;
}

/**
 * Find a DOM element by CSS selector.
 */
export function findElementBySelector(
  selector: string,
  index?: number,
  root?: HTMLElement
): HTMLElement | null {
  const container = root ?? document.body;
  if (!container) return null;

  if (index !== undefined && index > 0) {
    const all = container.querySelectorAll<HTMLElement>(selector);
    return all[index] ?? null;
  }

  return container.querySelector<HTMLElement>(selector);
}

/**
 * Find a form element by its associated label text.
 */
export function findElementByLabel(
  labelText: string,
  root?: HTMLElement
): HTMLElement | null {
  const container = root ?? document.body;
  if (!container) return null;

  const labels = container.querySelectorAll<HTMLLabelElement>('label');
  const searchText = labelText.toLowerCase();

  for (const label of labels) {
    const text = label.textContent?.trim().toLowerCase() ?? '';
    if (text.includes(searchText)) {
      // label[for]
      if (label.htmlFor) {
        const target = document.getElementById(label.htmlFor);
        if (target) return target as HTMLElement;
      }
      // Nested input
      const nested = label.querySelector<HTMLElement>('input, select, textarea');
      if (nested) return nested;
    }
  }

  // Fallback: aria-label match (escape to prevent CSS selector injection)
  const escaped = CSS.escape(labelText);
  const ariaMatch = container.querySelector<HTMLElement>(
    `[aria-label*="${escaped}" i]`
  );
  if (ariaMatch) return ariaMatch;

  // Fallback: placeholder match
  const placeholderMatch = container.querySelector<HTMLElement>(
    `input[placeholder*="${escaped}" i], textarea[placeholder*="${escaped}" i]`
  );
  return placeholderMatch;
}
