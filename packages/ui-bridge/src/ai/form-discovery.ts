/**
 * Form Discovery
 *
 * Shared form discovery logic used by both the `/control/forms` endpoint
 * and `createSemanticSnapshot({ includeForms: true })`.
 *
 * Discovers all forms on the page (both explicit `<form>` elements and
 * implicit forms from orphaned inputs), analyses field state, validation
 * errors, dirty tracking, and constraints.
 */

import type { ElementState } from '../core/types';
import type { FormState, FormFieldState, FormsResponse } from './types';
import { scanValidationErrors } from './validation-scanner';

/**
 * A registered element with DOM access — the minimal shape both the
 * server handler and snapshot manager can provide.
 */
export interface FormDiscoveryElement {
  id: string;
  element: HTMLElement;
  type: string;
  label?: string;
  getState: () => ElementState;
}

/**
 * Discover all forms on the page and return a `FormsResponse`.
 *
 * This is the single source of truth for form discovery — the
 * `/control/forms` handler and the semantic snapshot both delegate here.
 */
export function discoverForms(elements: FormDiscoveryElement[]): FormsResponse {
  // Scan for validation errors using DOM heuristics
  const validationErrors = scanValidationErrors(
    elements.map((el) => ({ id: el.id, element: el.element }))
  );
  const errorsByField = new Map(validationErrors.map((e) => [e.fieldId, e]));

  // Build form-centric view
  const formElements = elements.filter((el) => el.type === 'form');
  const inputTypes = new Set(['input', 'textarea', 'select', 'checkbox', 'radio']);
  const allInputs = elements.filter((el) => inputTypes.has(el.type));

  const forms: FormState[] = [];

  if (formElements.length > 0) {
    // Analyze each <form> element
    for (const formEl of formElements) {
      const formDom = formEl.element;
      // Find inputs inside this form
      const formInputs = allInputs.filter((input) => formDom.contains(input.element));
      const fields = buildFormFields(formInputs, errorsByField);

      // Find submit button
      const submitButton = elements.find(
        (el) =>
          el.type === 'button' &&
          formDom.contains(el.element) &&
          (el.element.getAttribute('type') === 'submit' ||
            el.element.textContent?.toLowerCase().match(/submit|save|send|continue|sign in|log in/))
      );

      forms.push({
        id: formEl.id,
        name: formEl.label || formDom.getAttribute('name') || undefined,
        purpose: inferFormPurpose(formInputs),
        fields,
        isValid: fields.every((f) => f.valid),
        submitButton: submitButton?.id,
        isDirty: fields.some((f) => f.isDirty),
      });
    }
  }

  // Check for implicit form (inputs not inside any <form>)
  const inputsInForms = new Set(
    formElements.flatMap((f) =>
      allInputs.filter((i) => f.element.contains(i.element)).map((i) => i.id)
    )
  );
  const orphanInputs = allInputs.filter((i) => !inputsInForms.has(i.id));

  if (orphanInputs.length > 0) {
    const fields = buildFormFields(orphanInputs, errorsByField);
    const submitButton = elements.find(
      (el) =>
        el.type === 'button' &&
        !formElements.some((f) => f.element.contains(el.element)) &&
        el.element.textContent?.toLowerCase().match(/submit|save|send|continue|sign in|log in/)
    );

    forms.push({
      id: 'implicit-form',
      purpose: inferFormPurpose(orphanInputs),
      fields,
      isValid: fields.every((f) => f.valid),
      submitButton: submitButton?.id,
      isDirty: fields.some((f) => f.isDirty),
    });
  }

  // Generate summary
  const totalFields = forms.reduce((sum, f) => sum + f.fields.length, 0);
  const totalErrors = forms.reduce((sum, f) => sum + f.fields.filter((ff) => !ff.valid).length, 0);
  const filledFields = forms.reduce(
    (sum, f) => sum + f.fields.filter((ff) => ff.value !== '' || ff.checked).length,
    0
  );
  const summaryParts = [`${forms.length} form(s), ${totalFields} field(s)`];
  if (filledFields > 0) summaryParts.push(`${filledFields} filled`);
  if (totalErrors > 0) summaryParts.push(`${totalErrors} error(s)`);

  return {
    forms,
    summary: summaryParts.join(', '),
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers (moved from handlers.ts)
// ---------------------------------------------------------------------------

/**
 * Get label text for a form element by checking associated `<label>` elements.
 */
function getLabelText(element: HTMLElement): string | undefined {
  if (typeof document === 'undefined') return undefined;

  // Check for <label for="id">
  const id = element.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }

  // Check for wrapping <label>
  const parentLabel = element.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    const inputs = clone.querySelectorAll('input, textarea, select');
    inputs.forEach((inp) => inp.remove());
    const text = clone.textContent?.trim();
    if (text) return text;
  }

  return undefined;
}

/**
 * Build `FormFieldState[]` from registered input elements.
 */
function buildFormFields(
  inputs: FormDiscoveryElement[],
  errorsByField: Map<string, import('./validation-scanner').DetectedValidationError>
): FormFieldState[] {
  return inputs.map((input) => {
    const state = input.getState();
    const el = input.element;
    const detectedError = errorsByField.get(input.id);

    // Determine validity: HTML5 validation > heuristic scanner
    let valid = true;
    let errorMsg: string | undefined;
    let errorSource: FormFieldState['errorSource'];

    if (state.validationState && !state.validationState.valid) {
      valid = false;
      errorMsg = state.validationState.validationMessage;
      errorSource = 'html5';
    } else if (detectedError) {
      valid = false;
      errorMsg = detectedError.message || undefined;
      errorSource = detectedError.source;
    }

    // Determine dirty state
    const defaultValue = el.getAttribute('value') ?? '';
    const isDirty = state.value !== undefined && state.value !== defaultValue;

    return {
      id: input.id,
      label:
        el.getAttribute('aria-label') ||
        input.label ||
        getLabelText(el) ||
        el.getAttribute('placeholder') ||
        input.id,
      type: el instanceof HTMLInputElement ? el.type : input.type,
      value: state.value ?? '',
      valid,
      error: errorMsg,
      errorSource,
      required: state.required ?? false,
      touched: state.focused || (state.value?.length ?? 0) > 0,
      placeholder: el.getAttribute('placeholder') || undefined,
      isDirty,
      checked: state.checked,
      selectedOptions: state.selectedOptions,
      constraints: state.constraints,
    };
  });
}

/**
 * Infer form purpose from field labels.
 */
function inferFormPurpose(fields: FormDiscoveryElement[]): string {
  const labels = fields
    .map((f) =>
      (
        f.element.getAttribute('aria-label') ||
        f.label ||
        f.element.getAttribute('name') ||
        ''
      ).toLowerCase()
    )
    .join(' ');

  if (labels.includes('email') && labels.includes('password')) {
    if (labels.includes('confirm') || labels.includes('name') || labels.includes('register')) {
      return 'Registration';
    }
    return 'Login';
  }
  if (labels.includes('search')) return 'Search';
  if (labels.includes('address') || labels.includes('city')) return 'Address';
  if (labels.includes('card') || labels.includes('payment')) return 'Payment';
  if (labels.includes('contact') || labels.includes('message')) return 'Contact';
  return 'Form';
}
