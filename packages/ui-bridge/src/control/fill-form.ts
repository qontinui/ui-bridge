/**
 * Form Fill Utility
 *
 * Standalone function to fill multiple form fields atomically.
 * Works directly with the DOM, dispatching proper events so that
 * frameworks (React, Vue, Angular) detect the changes.
 */

import type { FillResult, FillFieldResult } from '../core/types';
import { findElementByIdentifier } from '../core/element-identifier';
import { applyValueMutation } from './value-mutation';

/**
 * Options for fillFormFields
 */
export interface FillFormFieldsOptions {
  /** Whether to trigger validation after filling (default: true) */
  triggerValidation?: boolean;
  /** Whether to clear existing values first (default: true) */
  clearFirst?: boolean;
}

/**
 * Fill multiple form fields atomically.
 *
 * For each field entry, finds the element by ID (HTML id, data-testid, or
 * CSS selector) and sets the value based on element type:
 * - `<input type="checkbox/radio">`: sets `.checked` for boolean values
 * - `<select>`: sets `.value` or selected options for string[] values
 * - `<select multiple>`: sets multiple selected options for string[] values
 * - `<input>/<textarea>`: sets `.value` for string values
 *
 * Dispatches proper events (focus, input, change, blur) so that framework
 * state management (React, Vue, Angular) detects the changes.
 *
 * @param fields - Map of element ID (or CSS selector) to value
 * @param options - Optional configuration for validation and clearing
 * @returns Result summary with per-field status
 */
export function fillFormFields(
  fields: Record<string, string | boolean | string[]>,
  options?: FillFormFieldsOptions
): FillResult {
  const results: Record<string, FillFieldResult> = {};
  let filledCount = 0;
  let errorCount = 0;

  const triggerValidation = options?.triggerValidation !== false;
  const clearFirst = options?.clearFirst !== false;

  for (const [fieldId, value] of Object.entries(fields)) {
    try {
      // Resolve element: try findElementByIdentifier (handles id, data-testid, etc.)
      // then fall back to querySelector
      let element: HTMLElement | null = findElementByIdentifier(fieldId);
      if (!element && typeof document !== 'undefined') {
        try {
          element = document.querySelector<HTMLElement>(fieldId);
        } catch {
          // Invalid selector — ignore
        }
      }

      if (!element) {
        results[fieldId] = { success: false, error: `Element not found: ${fieldId}` };
        errorCount++;
        continue;
      }

      // Fill based on element type and value type
      fillSingleField(element, value, clearFirst);

      // Trigger validation if requested
      let validationError: string | undefined;
      if (triggerValidation && 'reportValidity' in element) {
        const isValid = (element as HTMLInputElement).reportValidity();
        if (!isValid) {
          validationError = (element as HTMLInputElement).validationMessage || 'Validation failed';
        }
      }

      results[fieldId] = { success: true, validationError };
      filledCount++;
    } catch (err) {
      results[fieldId] = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
      errorCount++;
    }
  }

  return {
    success: errorCount === 0,
    filledCount,
    errorCount,
    fields: results,
  };
}

/**
 * Fill a single form field with the given value, dispatching proper events.
 *
 * Handles checkboxes, radios, selects (single and multi), inputs, and textareas.
 * Dispatches proper focus/input/change/blur events so framework state management
 * (React, Vue, Angular) detects the changes.
 */
export function fillSingleField(
  element: HTMLElement,
  value: string | boolean | string[],
  // fill always replaces the full value, so the clear-first flag is a no-op for
  // the input/textarea branch and unused by the checkbox/radio/select branches.
  // Kept in the signature for call-site stability; prefixed `_` to satisfy lint.
  _clearFirst: boolean
): void {
  // Handle checkboxes and radios with boolean values
  if (
    element instanceof HTMLInputElement &&
    (element.type === 'checkbox' || element.type === 'radio')
  ) {
    const checked = typeof value === 'boolean' ? value : value === 'true';
    if (element.checked !== checked) {
      element.focus();
      element.checked = checked;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.blur();
    }
    return;
  }

  // Handle select elements
  if (element instanceof HTMLSelectElement) {
    element.focus();

    if (element.multiple && Array.isArray(value)) {
      // Multi-select: set selected state on matching options
      for (const option of element.options) {
        option.selected = value.includes(option.value);
      }
    } else {
      // Single select
      const strValue = Array.isArray(value) ? value[0] : String(value);
      element.value = strValue;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();
    return;
  }

  // Handle input and textarea elements with string values.
  // fill's contract sets the full value (it does not append), so this is always
  // a replace — route through the shared helper. `blur: true` preserves fill's
  // focus → input → change → blur lifecycle.
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    applyValueMutation(element, { value: String(value), mode: 'replace', blur: true });
    return;
  }

  throw new Error(`Unsupported element type for fill: ${element.tagName.toLowerCase()}`);
}
