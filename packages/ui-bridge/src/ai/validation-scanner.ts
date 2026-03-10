/**
 * Validation Error Heuristic Scanner
 *
 * Detects validation errors near form fields using multiple strategies:
 * 1. HTML5 Constraint Validation API
 * 2. ARIA attributes (aria-invalid, aria-errormessage, aria-describedby)
 * 3. Adjacent sibling elements with error CSS classes
 * 4. CSS class heuristics on the input itself
 *
 * Each strategy returns a confidence score. The highest-confidence match wins.
 */

export interface DetectedValidationError {
  /** Associated form field element ID or DOM selector */
  fieldId: string;
  /** The error message text (may be empty if only class-based detection) */
  message: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Which strategy detected this error */
  source: 'html5' | 'aria' | 'adjacent-element' | 'css-class';
}

/** CSS classes commonly used on error message containers */
const ERROR_CONTAINER_SELECTORS = [
  '.error',
  '.field-error',
  '.form-error',
  '.invalid-feedback',
  '.help-block.error',
  '.error-message',
  '.validation-error',
  '.form-text.text-danger',
  '[role="alert"]',
  // Material UI
  '.MuiFormHelperText-root.Mui-error',
  // Ant Design
  '.ant-form-item-explain-error',
  // Chakra UI
  '.chakra-form__error-message',
  // Tailwind UI common patterns
  '.text-red-500',
  '.text-red-600',
  '.text-destructive',
];

/** CSS classes that indicate an input is in error state */
const INPUT_ERROR_CLASSES = [
  'is-invalid',
  'has-error',
  'error',
  'invalid',
  'field-error',
  'border-red-500',
  'border-destructive',
  'Mui-error',
  'ant-input-status-error',
];

/**
 * Scan registered elements for validation errors using DOM heuristics.
 *
 * @param elements - Array of objects with `id` and `element` (DOM reference)
 * @returns Detected validation errors, one per field maximum
 */
export function scanValidationErrors(
  elements: Array<{ id: string; element: HTMLElement }>
): DetectedValidationError[] {
  const errors: DetectedValidationError[] = [];
  const seen = new Set<string>();

  for (const { id, element } of elements) {
    // Only scan form control elements
    if (
      !(element instanceof HTMLInputElement) &&
      !(element instanceof HTMLTextAreaElement) &&
      !(element instanceof HTMLSelectElement)
    ) {
      continue;
    }

    const result = detectFieldError(id, element);
    if (result && !seen.has(id)) {
      errors.push(result);
      seen.add(id);
    }
  }

  return errors;
}

/**
 * Detect a validation error for a single form control element.
 * Tries strategies in order of confidence, returns the first match.
 */
function detectFieldError(
  fieldId: string,
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
): DetectedValidationError | null {
  // Strategy 1: HTML5 Constraint Validation API (highest confidence)
  if ('validity' in element && !element.validity.valid) {
    return {
      fieldId,
      message: element.validationMessage || 'Invalid value',
      confidence: 1.0,
      source: 'html5',
    };
  }

  // Strategy 2: ARIA invalid attribute
  if (element.getAttribute('aria-invalid') === 'true') {
    // Try to find the error message via aria-errormessage or aria-describedby
    const errorMessage = getAriaErrorMessage(element);
    return {
      fieldId,
      message: errorMessage || '',
      confidence: 0.95,
      source: 'aria',
    };
  }

  // Strategy 3: Adjacent/sibling error elements
  const adjacentError = findAdjacentError(element);
  if (adjacentError) {
    return {
      fieldId,
      message: adjacentError,
      confidence: 0.8,
      source: 'adjacent-element',
    };
  }

  // Strategy 4: CSS class on the input itself
  if (hasErrorClass(element)) {
    return {
      fieldId,
      message: '',
      confidence: 0.6,
      source: 'css-class',
    };
  }

  return null;
}

/**
 * Get error message from ARIA attributes
 */
function getAriaErrorMessage(element: HTMLElement): string | null {
  // aria-errormessage points to the element containing the error text
  const errorMsgId = element.getAttribute('aria-errormessage');
  if (errorMsgId) {
    const errorEl = document.getElementById(errorMsgId);
    if (errorEl?.textContent?.trim()) {
      return errorEl.textContent.trim();
    }
  }

  // aria-describedby may also reference error text
  const describedById = element.getAttribute('aria-describedby');
  if (describedById) {
    // Can be space-separated list of IDs
    const ids = describedById.split(/\s+/);
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el?.textContent?.trim()) {
        // Check if it looks like an error (not just a description)
        const text = el.textContent.trim();
        if (
          el.getAttribute('role') === 'alert' ||
          hasErrorClass(el) ||
          text.length < 200 // Short text near an aria-invalid input is likely an error
        ) {
          return text;
        }
      }
    }
  }

  return null;
}

/**
 * Find error message in adjacent DOM elements
 */
function findAdjacentError(element: HTMLElement): string | null {
  // Look in the form-field container
  const container =
    element.closest(
      '.form-group, .form-field, .field, .form-item, ' +
        '[class*="field"], [class*="form-group"], [class*="FormControl"], ' +
        '.MuiFormControl-root, .ant-form-item, .chakra-form-control'
    ) || element.parentElement;

  if (!container) return null;

  // Check each error selector within the container
  for (const selector of ERROR_CONTAINER_SELECTORS) {
    try {
      const errorEl = container.querySelector(selector);
      if (errorEl && errorEl !== element) {
        const text = errorEl.textContent?.trim();
        if (text) return text;
      }
    } catch {
      // Invalid selector, skip
    }
  }

  // Also check the immediate next sibling
  const next = element.nextElementSibling;
  if (next && hasErrorClass(next as HTMLElement)) {
    const text = next.textContent?.trim();
    if (text) return text;
  }

  return null;
}

/**
 * Check if an element has error-indicating CSS classes
 */
function hasErrorClass(element: HTMLElement): boolean {
  for (const cls of INPUT_ERROR_CLASSES) {
    if (element.classList.contains(cls)) return true;
  }
  // Also check data attributes
  if (
    element.getAttribute('data-invalid') === 'true' ||
    element.getAttribute('data-error') !== null
  ) {
    return true;
  }
  return false;
}
