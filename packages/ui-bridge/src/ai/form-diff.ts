/**
 * Form Diff Tracking
 *
 * Utilities for snapshotting form state and computing diffs between snapshots.
 * Useful for AI verification: snapshot before an action, snapshot after, diff to
 * see what the action changed.
 */

import type { FormState, FormFieldState } from './types';
import {
  verdictOf,
  scrubContentRequired,
  scrubValueRequired,
  scrubContentByVerdict,
} from '../core/redaction';
import { readAriaLabelAttr, readPlaceholderAttr } from '../core/a11y';

// ============================================================================
// Types
// ============================================================================

/**
 * A point-in-time capture of all form state on the page.
 */
export interface FormSnapshot {
  /** All forms detected at snapshot time */
  forms: FormState[];
  /** Timestamp when the snapshot was captured */
  timestamp: number;
}

/**
 * Describes how a single form field changed between two snapshots.
 */
export interface FormFieldDiff {
  /** The field ID */
  fieldId: string;
  /** The field label (human-readable name) */
  fieldName?: string;
  /** The field input type (e.g. "text", "checkbox", "select") */
  fieldType: string;
  /** Property-level changes */
  changes: {
    value?: { before: string; after: string };
    checked?: { before: boolean; after: boolean };
    selectedOptions?: { before: string[]; after: string[] };
    validationError?: { before: string | undefined; after: string | undefined };
    isDirty?: { before: boolean; after: boolean };
    isValid?: { before: boolean; after: boolean };
  };
}

/**
 * The result of comparing two form snapshots.
 */
export interface FormDiff {
  /** Fields that changed between snapshots */
  changedFields: FormFieldDiff[];
  /** Field IDs added (present in after but not before) */
  addedFields: string[];
  /** Field IDs removed (present in before but not after) */
  removedFields: string[];
  /** Form IDs added between snapshots */
  formsAdded: string[];
  /** Form IDs removed between snapshots */
  formsRemoved: string[];
  /** Human-readable summary */
  summary: string;
  /** Time between snapshots in milliseconds */
  timeDeltaMs: number;
  /** Whether any changes were detected */
  hasChanges: boolean;
}

// ============================================================================
// Snapshot Capture
// ============================================================================

/**
 * Capture current form state as a snapshot.
 *
 * Queries all form elements and input/textarea/select elements from the DOM
 * and builds FormState objects. Designed to run in a browser environment.
 */
export function captureFormSnapshot(): FormSnapshot {
  if (typeof document === 'undefined') {
    return { forms: [], timestamp: Date.now() };
  }

  const forms: FormState[] = [];

  // Collect all form elements
  const formElements = document.querySelectorAll('form');
  const allInputs = document.querySelectorAll<HTMLElement>('input, textarea, select');

  // Track which inputs belong to a form
  const inputsInForms = new Set<HTMLElement>();

  // Process explicit <form> elements
  formElements.forEach((formEl) => {
    const formInputs: HTMLElement[] = [];
    allInputs.forEach((input) => {
      if (formEl.contains(input)) {
        formInputs.push(input);
        inputsInForms.add(input);
      }
    });

    const fields = buildFieldStates(formInputs);
    const submitButton = formEl.querySelector<HTMLElement>(
      'button[type="submit"], input[type="submit"]'
    );

    forms.push({
      id: formEl.id || `form-${forms.length}`,
      name: formEl.getAttribute('name') || undefined,
      purpose: inferPurposeFromFields(fields),
      fields,
      isValid: fields.every((f) => f.valid),
      submitButton: submitButton?.id || undefined,
      isDirty: fields.some((f) => f.isDirty),
    });
  });

  // Process orphan inputs (not inside any <form>)
  const orphanInputs: HTMLElement[] = [];
  allInputs.forEach((input) => {
    if (!inputsInForms.has(input)) {
      orphanInputs.push(input);
    }
  });

  if (orphanInputs.length > 0) {
    const fields = buildFieldStates(orphanInputs);
    forms.push({
      id: 'implicit-form',
      purpose: inferPurposeFromFields(fields),
      fields,
      isValid: fields.every((f) => f.valid),
      isDirty: fields.some((f) => f.isDirty),
    });
  }

  return {
    forms,
    timestamp: Date.now(),
  };
}

// ============================================================================
// Diff Computation
// ============================================================================

/**
 * Compare two form snapshots and return the differences.
 *
 * Matches forms by ID and fields by field ID. Detects value changes,
 * validation state changes, dirty state changes, and added/removed
 * forms and fields.
 */
export function diffFormSnapshots(before: FormSnapshot, after: FormSnapshot): FormDiff {
  const beforeFormIds = new Set(before.forms.map((f) => f.id));
  const afterFormIds = new Set(after.forms.map((f) => f.id));

  const formsAdded = after.forms.filter((f) => !beforeFormIds.has(f.id)).map((f) => f.id);

  const formsRemoved = before.forms.filter((f) => !afterFormIds.has(f.id)).map((f) => f.id);

  // Build field maps across all forms
  const beforeFields = buildFieldMap(before.forms);
  const afterFields = buildFieldMap(after.forms);

  const beforeFieldIds = new Set(beforeFields.keys());
  const afterFieldIds = new Set(afterFields.keys());

  const addedFields: string[] = [];
  afterFieldIds.forEach((id) => {
    if (!beforeFieldIds.has(id)) {
      addedFields.push(id);
    }
  });

  const removedFields: string[] = [];
  beforeFieldIds.forEach((id) => {
    if (!afterFieldIds.has(id)) {
      removedFields.push(id);
    }
  });

  // Compare fields that exist in both snapshots
  const changedFields: FormFieldDiff[] = [];
  beforeFieldIds.forEach((id) => {
    if (!afterFieldIds.has(id)) return;

    const beforeField = beforeFields.get(id)!;
    const afterField = afterFields.get(id)!;
    const diff = diffFields(beforeField, afterField);
    if (diff) {
      changedFields.push(diff);
    }
  });

  const timeDeltaMs = after.timestamp - before.timestamp;
  const hasChanges =
    changedFields.length > 0 ||
    addedFields.length > 0 ||
    removedFields.length > 0 ||
    formsAdded.length > 0 ||
    formsRemoved.length > 0;

  const summary = summarizeFormDiff({
    changedFields,
    addedFields,
    removedFields,
    formsAdded,
    formsRemoved,
    summary: '',
    timeDeltaMs,
    hasChanges,
  });

  return {
    changedFields,
    addedFields,
    removedFields,
    formsAdded,
    formsRemoved,
    summary,
    timeDeltaMs,
    hasChanges,
  };
}

// ============================================================================
// Summary Generation
// ============================================================================

/**
 * Generate a human-readable summary of form changes.
 */
export function summarizeFormDiff(diff: FormDiff): string {
  if (!diff.hasChanges) {
    return 'No changes detected';
  }

  const parts: string[] = [];

  // Form-level changes
  if (diff.formsAdded.length > 0) {
    parts.push(`Forms added: ${diff.formsAdded.join(', ')}`);
  }
  if (diff.formsRemoved.length > 0) {
    parts.push(`Forms removed: ${diff.formsRemoved.join(', ')}`);
  }

  // Field-level changes
  for (const field of diff.changedFields) {
    const fieldLabel = field.fieldName || field.fieldId;
    const changeParts: string[] = [];

    if (field.changes.value) {
      const before = field.changes.value.before || '(empty)';
      const after = field.changes.value.after || '(empty)';
      changeParts.push(`value: "${before}" -> "${after}"`);
    }
    if (field.changes.checked) {
      changeParts.push(
        `checked: ${field.changes.checked.before} -> ${field.changes.checked.after}`
      );
    }
    if (field.changes.selectedOptions) {
      const before = field.changes.selectedOptions.before.join(', ') || '(none)';
      const after = field.changes.selectedOptions.after.join(', ') || '(none)';
      changeParts.push(`selected: [${before}] -> [${after}]`);
    }
    if (field.changes.validationError) {
      const before = field.changes.validationError.before || '(none)';
      const after = field.changes.validationError.after || '(none)';
      changeParts.push(`error: "${before}" -> "${after}"`);
    }
    if (field.changes.isValid) {
      changeParts.push(`valid: ${field.changes.isValid.before} -> ${field.changes.isValid.after}`);
    }
    if (field.changes.isDirty) {
      changeParts.push(`dirty: ${field.changes.isDirty.before} -> ${field.changes.isDirty.after}`);
    }

    if (changeParts.length > 0) {
      parts.push(`${fieldLabel}: ${changeParts.join(', ')}`);
    }
  }

  // Added/removed fields
  if (diff.addedFields.length > 0) {
    parts.push(`Fields added: ${diff.addedFields.join(', ')}`);
  }
  if (diff.removedFields.length > 0) {
    parts.push(`Fields removed: ${diff.removedFields.join(', ')}`);
  }

  return parts.join('; ');
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Build a flat map of fieldId -> FormFieldState across all forms.
 */
function buildFieldMap(forms: FormState[]): Map<string, FormFieldState> {
  const map = new Map<string, FormFieldState>();
  for (const form of forms) {
    for (const field of form.fields) {
      map.set(field.id, field);
    }
  }
  return map;
}

/**
 * Compare two field states and return a diff if they differ, or null if identical.
 */
function diffFields(before: FormFieldState, after: FormFieldState): FormFieldDiff | null {
  const changes: FormFieldDiff['changes'] = {};

  // Value change
  if (before.value !== after.value) {
    changes.value = { before: before.value, after: after.value };
  }

  // Checked state change
  if (
    before.checked !== after.checked &&
    (before.checked !== undefined || after.checked !== undefined)
  ) {
    changes.checked = {
      before: before.checked ?? false,
      after: after.checked ?? false,
    };
  }

  // Selected options change
  if (!arraysEqual(before.selectedOptions, after.selectedOptions)) {
    changes.selectedOptions = {
      before: before.selectedOptions ?? [],
      after: after.selectedOptions ?? [],
    };
  }

  // Validation error change
  if (before.error !== after.error) {
    changes.validationError = {
      before: before.error,
      after: after.error,
    };
  }

  // isDirty change
  if (before.isDirty !== after.isDirty) {
    changes.isDirty = {
      before: before.isDirty ?? false,
      after: after.isDirty ?? false,
    };
  }

  // Validity change
  if (before.valid !== after.valid) {
    changes.isValid = {
      before: before.valid,
      after: after.valid,
    };
  }

  // Check if any changes were detected
  if (Object.keys(changes).length === 0) {
    return null;
  }

  return {
    fieldId: after.id,
    fieldName: after.label || before.label,
    fieldType: after.type,
    changes,
  };
}

/**
 * Compare two optional string arrays for equality.
 */
function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Build FormFieldState[] from raw DOM elements.
 */
function buildFieldStates(inputs: HTMLElement[]): FormFieldState[] {
  return inputs.map((el) => {
    const isInput = el instanceof HTMLInputElement;
    const isTextarea = el instanceof HTMLTextAreaElement;
    const isSelect = el instanceof HTMLSelectElement;

    let value = '';
    let checked: boolean | undefined;
    let selectedOptions: string[] | undefined;
    let inputType = 'text';

    if (isInput) {
      inputType = el.type || 'text';
      if (inputType === 'checkbox' || inputType === 'radio') {
        checked = el.checked;
        value = el.value;
      } else {
        value = el.value;
      }
    } else if (isTextarea) {
      inputType = 'textarea';
      value = el.value;
    } else if (isSelect) {
      inputType = 'select';
      value = el.value;
      selectedOptions = Array.from(el.selectedOptions).map((o) => o.value);
    }

    // Determine validity from HTML5 validation
    const validity = (el as HTMLInputElement).validity;
    const valid = validity ? validity.valid : true;
    const validationMessage = (el as HTMLInputElement).validationMessage || undefined;

    // Label resolution
    const label =
      readAriaLabelAttr(el) ||
      getLabelTextForElement(el) ||
      readPlaceholderAttr(el) ||
      el.id ||
      el.getAttribute('name') ||
      '';

    // Dirty state
    const defaultValue = el.getAttribute('value') ?? '';
    const isDirty = value !== defaultValue;

    // §4.6: this producer reads raw `el.value` + DOM label/placeholder. VALUE
    // axis for value/selectedOptions; CONTENT axis for label/placeholder/error.
    const verdict = verdictOf(el);
    return {
      id: el.id || el.getAttribute('name') || `field-${Math.random().toString(36).slice(2, 8)}`,
      label: scrubContentRequired(label, verdict),
      type: inputType,
      value: scrubValueRequired(value, verdict),
      valid,
      error: scrubContentByVerdict(validationMessage, verdict),
      required: el.hasAttribute('required'),
      touched: (value?.length ?? 0) > 0,
      placeholder: scrubContentByVerdict(readPlaceholderAttr(el) || undefined, verdict),
      isDirty,
      checked,
      selectedOptions: selectedOptions?.map((o) => scrubValueRequired(o, verdict)),
    };
  });
}

/**
 * Get label text for a form element by checking associated <label> elements.
 */
function getLabelTextForElement(element: HTMLElement): string | undefined {
  if (typeof document === 'undefined') return undefined;

  const id = element.id;
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }

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
 * Infer form purpose from field labels.
 */
function inferPurposeFromFields(fields: FormFieldState[]): string {
  const labels = fields.map((f) => f.label.toLowerCase()).join(' ');

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
