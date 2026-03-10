/**
 * Form State Awareness Integration Tests
 *
 * End-to-end tests for the form-related features working together:
 * - Form snapshot capture and diff
 * - Fill form fields with event dispatching
 * - Validation scanner with HTML5 / ARIA / CSS heuristics
 * - Form mutation detector (idle signal)
 * - Framework adapter registry
 * - Semantic snapshot with includeForms option
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { captureFormSnapshot, diffFormSnapshots } from '../form-diff';
import { fillFormFields } from '../../control/fill-form';
import { scanValidationErrors } from '../validation-scanner';
import { discoverForms, type FormDiscoveryElement } from '../form-discovery';
import { FormMutationDetector } from '../../idle/form-mutation';
import { createAdapterRegistry } from '../../adapters/registry';
import type { FormFrameworkAdapter } from '../../adapters/types';
import type { FormsResponse } from '../types';
import { createSnapshotManager } from '../semantic-snapshot';
import type { ControlSnapshot } from '../../control/types';
import type { ElementState } from '../../core/types';

// ============================================================================
// Helpers
// ============================================================================

/** Track elements appended to body for cleanup */
let appendedElements: HTMLElement[] = [];

function appendToBody(el: HTMLElement): HTMLElement {
  document.body.appendChild(el);
  appendedElements.push(el);
  return el;
}

/**
 * Build a complete form in the DOM with labelled fields.
 * Returns a map of field ID -> HTMLElement for later reference.
 */
function buildForm(
  formId: string,
  fields: Array<{
    id: string;
    tag: 'input' | 'textarea' | 'select';
    type?: string;
    label?: string;
    required?: boolean;
    options?: string[]; // for select elements
    value?: string;
    checked?: boolean;
  }>
): { form: HTMLFormElement; fieldElements: Record<string, HTMLElement> } {
  const form = document.createElement('form');
  form.id = formId;

  const fieldElements: Record<string, HTMLElement> = {};

  for (const field of fields) {
    // Create label
    if (field.label) {
      const label = document.createElement('label');
      label.setAttribute('for', field.id);
      label.textContent = field.label;
      form.appendChild(label);
    }

    let el: HTMLElement;
    if (field.tag === 'select') {
      const select = document.createElement('select');
      select.id = field.id;
      select.name = field.id;
      if (field.required) select.required = true;
      if (field.options) {
        for (const opt of field.options) {
          const option = document.createElement('option');
          option.value = opt;
          option.textContent = opt;
          select.appendChild(option);
        }
      }
      if (field.value) select.value = field.value;
      el = select;
    } else if (field.tag === 'textarea') {
      const textarea = document.createElement('textarea');
      textarea.id = field.id;
      textarea.name = field.id;
      if (field.required) textarea.required = true;
      if (field.value) textarea.value = field.value;
      el = textarea;
    } else {
      const input = document.createElement('input');
      input.id = field.id;
      input.name = field.id;
      input.type = field.type || 'text';
      if (field.required) input.required = true;
      if (field.value !== undefined) input.value = field.value;
      if (field.checked !== undefined) input.checked = field.checked;
      el = input;
    }

    form.appendChild(el);
    fieldElements[field.id] = el;
  }

  appendToBody(form);
  return { form, fieldElements };
}

/**
 * Create a mock FormDiscoveryElement from a DOM element.
 */
function toDiscoveryElement(
  id: string,
  element: HTMLElement,
  type: string,
  label?: string
): FormDiscoveryElement {
  return {
    id,
    element,
    type,
    label,
    getState: (): ElementState => {
      const isInput = element instanceof HTMLInputElement;
      const isTextarea = element instanceof HTMLTextAreaElement;
      const isSelect = element instanceof HTMLSelectElement;

      let value: string | undefined;
      let checked: boolean | undefined;
      let selectedOptions: string[] | undefined;

      if (isInput) {
        value = element.value;
        if (element.type === 'checkbox' || element.type === 'radio') {
          checked = element.checked;
        }
      } else if (isTextarea) {
        value = element.value;
      } else if (isSelect) {
        value = element.value;
        selectedOptions = Array.from(element.selectedOptions).map((o) => o.value);
      }

      const validity = (element as HTMLInputElement).validity;
      const validState = validity ? validity.valid : true;
      const validationMessage = (element as HTMLInputElement).validationMessage || undefined;

      return {
        visible: true,
        enabled: !((element as HTMLInputElement).disabled ?? false),
        focused: document.activeElement === element,
        rect: { x: 0, y: 0, width: 100, height: 30, top: 0, right: 100, bottom: 30, left: 0 },
        value,
        checked,
        selectedOptions,
        required: element.hasAttribute('required'),
        validationState: {
          valid: validState,
          validationMessage: validationMessage || '',
        },
      };
    },
  };
}

afterEach(() => {
  for (const el of appendedElements) {
    el.remove();
  }
  appendedElements = [];
});

// ============================================================================
// 1. Fill -> Snapshot -> Diff flow
// ============================================================================

describe('Fill -> Snapshot -> Diff flow', () => {
  it('should capture value changes in text, email, checkbox, and select fields', () => {
    const { fieldElements } = buildForm('profile-form', [
      { id: 'username', tag: 'input', type: 'text', label: 'Username' },
      { id: 'email', tag: 'input', type: 'email', label: 'Email' },
      { id: 'newsletter', tag: 'input', type: 'checkbox', label: 'Subscribe', checked: false },
      {
        id: 'role',
        tag: 'select',
        label: 'Role',
        options: ['user', 'admin', 'editor'],
        value: 'user',
      },
    ]);

    // Take baseline snapshot
    const before = captureFormSnapshot();
    expect(before.forms.length).toBeGreaterThanOrEqual(1);

    // Fill fields
    const result = fillFormFields(
      {
        username: 'john_doe',
        email: 'john@example.com',
        newsletter: true,
        role: 'admin',
      },
      { triggerValidation: false }
    );

    expect(result.success).toBe(true);
    expect(result.filledCount).toBe(4);
    expect(result.errorCount).toBe(0);

    // Verify DOM values were actually set
    expect((fieldElements.username as HTMLInputElement).value).toBe('john_doe');
    expect((fieldElements.email as HTMLInputElement).value).toBe('john@example.com');
    expect((fieldElements.newsletter as HTMLInputElement).checked).toBe(true);
    expect((fieldElements.role as HTMLSelectElement).value).toBe('admin');

    // Take after snapshot
    const after = captureFormSnapshot();

    // Diff
    const diff = diffFormSnapshots(before, after);

    expect(diff.hasChanges).toBe(true);
    expect(diff.changedFields.length).toBeGreaterThanOrEqual(3); // username, email, role at minimum

    // Verify specific field changes
    const usernameChange = diff.changedFields.find((f) => f.fieldId === 'username');
    expect(usernameChange).toBeDefined();
    expect(usernameChange!.changes.value).toEqual({ before: '', after: 'john_doe' });

    const emailChange = diff.changedFields.find((f) => f.fieldId === 'email');
    expect(emailChange).toBeDefined();
    expect(emailChange!.changes.value).toEqual({ before: '', after: 'john@example.com' });

    const checkboxChange = diff.changedFields.find((f) => f.fieldId === 'newsletter');
    expect(checkboxChange).toBeDefined();
    expect(checkboxChange!.changes.checked).toEqual({ before: false, after: true });

    const selectChange = diff.changedFields.find((f) => f.fieldId === 'role');
    expect(selectChange).toBeDefined();
    expect(selectChange!.changes.value).toEqual({ before: 'user', after: 'admin' });
  });

  it('should report no changes when nothing was modified', () => {
    buildForm('empty-form', [{ id: 'field1', tag: 'input', type: 'text', label: 'Field' }]);

    const before = captureFormSnapshot();
    const after = captureFormSnapshot();
    const diff = diffFormSnapshots(before, after);

    expect(diff.hasChanges).toBe(false);
    expect(diff.changedFields).toHaveLength(0);
  });
});

// ============================================================================
// 2. Fill with validation
// ============================================================================

describe('Fill with validation', () => {
  it('should report validation error for invalid email, then succeed for valid email', () => {
    buildForm('login-form', [
      { id: 'user-email', tag: 'input', type: 'email', label: 'Email', required: true },
    ]);

    // Fill with invalid email - triggerValidation on
    const badResult = fillFormFields({ 'user-email': 'not-an-email' }, { triggerValidation: true });
    expect(badResult.filledCount).toBe(1);
    // The field was filled successfully (DOM value set), but it may have a validationError
    expect(badResult.fields['user-email'].success).toBe(true);
    // HTML5 email validation should flag "not-an-email" as invalid
    expect(badResult.fields['user-email'].validationError).toBeDefined();

    // Fill with valid email
    const goodResult = fillFormFields(
      { 'user-email': 'test@example.com' },
      { triggerValidation: true }
    );
    expect(goodResult.fields['user-email'].success).toBe(true);
    expect(goodResult.fields['user-email'].validationError).toBeUndefined();
  });

  it('should report validation error for empty required field', () => {
    buildForm('required-form', [
      { id: 'required-name', tag: 'input', type: 'text', label: 'Name', required: true },
    ]);

    // Fill with empty string (required should fail)
    const result = fillFormFields({ 'required-name': '' }, { triggerValidation: true });
    expect(result.fields['required-name'].success).toBe(true);
    expect(result.fields['required-name'].validationError).toBeDefined();
  });

  it('should report element not found error for nonexistent field', () => {
    buildForm('tiny-form', [{ id: 'exists', tag: 'input', type: 'text', label: 'Exists' }]);

    const result = fillFormFields({ nonexistent: 'value' });
    expect(result.success).toBe(false);
    expect(result.errorCount).toBe(1);
    expect(result.fields.nonexistent.success).toBe(false);
    expect(result.fields.nonexistent.error).toContain('not found');
  });
});

// ============================================================================
// 3. Form discovery + validation scanner
// ============================================================================

describe('Form discovery + validation scanner', () => {
  it('should detect HTML5 and ARIA validation errors but not clean fields', () => {
    // Create a form with three inputs:
    //   1. required empty (HTML5 will flag)
    //   2. aria-invalid="true" with error message
    //   3. valid clean input

    const form = document.createElement('form');
    form.id = 'validation-form';

    // Field 1: required, empty -> HTML5 validation fails
    const input1 = document.createElement('input');
    input1.id = 'req-field';
    input1.type = 'text';
    input1.required = true;
    input1.value = ''; // empty -> valueMissing
    form.appendChild(input1);

    // Field 2: aria-invalid with error message
    const input2 = document.createElement('input');
    input2.id = 'aria-field';
    input2.type = 'text';
    input2.setAttribute('aria-invalid', 'true');
    input2.setAttribute('aria-errormessage', 'aria-field-error');
    form.appendChild(input2);

    const errorSpan = document.createElement('span');
    errorSpan.id = 'aria-field-error';
    errorSpan.textContent = 'This field has an error';
    form.appendChild(errorSpan);

    // Field 3: clean valid input
    const input3 = document.createElement('input');
    input3.id = 'clean-field';
    input3.type = 'text';
    input3.value = 'valid value';
    form.appendChild(input3);

    appendToBody(form);

    // Use scanValidationErrors directly
    const errors = scanValidationErrors([
      { id: 'req-field', element: input1 },
      { id: 'aria-field', element: input2 },
      { id: 'clean-field', element: input3 },
    ]);

    // Should have errors for field 1 and field 2, not field 3
    expect(errors.length).toBe(2);

    const reqError = errors.find((e) => e.fieldId === 'req-field');
    expect(reqError).toBeDefined();
    expect(reqError!.source).toBe('html5');
    expect(reqError!.confidence).toBe(1.0);

    const ariaError = errors.find((e) => e.fieldId === 'aria-field');
    expect(ariaError).toBeDefined();
    expect(ariaError!.source).toBe('aria');
    expect(ariaError!.message).toBe('This field has an error');

    const cleanError = errors.find((e) => e.fieldId === 'clean-field');
    expect(cleanError).toBeUndefined();
  });

  it('should discover forms with field states via discoverForms', () => {
    const form = document.createElement('form');
    form.id = 'disc-form';

    const input1 = document.createElement('input');
    input1.id = 'disc-name';
    input1.type = 'text';
    input1.value = 'Alice';
    input1.setAttribute('aria-label', 'Name');
    form.appendChild(input1);

    const input2 = document.createElement('input');
    input2.id = 'disc-email';
    input2.type = 'email';
    input2.setAttribute('aria-label', 'Email');
    input2.required = true;
    // Leave empty to trigger required validation
    form.appendChild(input2);

    appendToBody(form);

    const elements: FormDiscoveryElement[] = [
      toDiscoveryElement('disc-form', form, 'form'),
      toDiscoveryElement('disc-name', input1, 'input', 'Name'),
      toDiscoveryElement('disc-email', input2, 'input', 'Email'),
    ];

    const response = discoverForms(elements);

    expect(response.forms.length).toBeGreaterThanOrEqual(1);
    const discoveredForm = response.forms.find((f) => f.id === 'disc-form');
    expect(discoveredForm).toBeDefined();
    expect(discoveredForm!.fields.length).toBe(2);

    // Name field should be valid
    const nameField = discoveredForm!.fields.find((f) => f.id === 'disc-name');
    expect(nameField).toBeDefined();
    expect(nameField!.value).toBe('Alice');
    expect(nameField!.valid).toBe(true);

    // Email field should be invalid (required + empty)
    const emailField = discoveredForm!.fields.find((f) => f.id === 'disc-email');
    expect(emailField).toBeDefined();
    expect(emailField!.valid).toBe(false);
    expect(emailField!.required).toBe(true);
  });
});

// ============================================================================
// 4. Form mutation detector + fill interaction
// ============================================================================

describe('FormMutationDetector + fill interaction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should transition from idle -> mutating -> idle after fill and settle', () => {
    buildForm('mutation-form', [{ id: 'mut-field', tag: 'input', type: 'text', label: 'Test' }]);

    const detector = new FormMutationDetector({ settleMs: 500 });
    detector.install();

    // Initially idle
    expect(detector.isIdle()).toBe(true);
    expect(detector.getStatus().settled).toBe(true);

    // Track transitions
    const transitions: boolean[] = [];
    detector.onTransition((idle) => {
      transitions.push(idle);
    });

    // Fill the field (dispatches input/change events which the detector picks up)
    fillFormFields({ 'mut-field': 'hello world' }, { triggerValidation: false });

    // After fill, the detector should have transitioned to mutating
    expect(detector.isIdle()).toBe(false);
    expect(detector.getStatus().settled).toBe(false);

    // Advance past settleMs
    vi.advanceTimersByTime(600);

    // Should be idle again
    expect(detector.isIdle()).toBe(true);
    expect(detector.getStatus().settled).toBe(true);

    // Verify we saw both transitions: idle->mutating (false) then mutating->idle (true)
    expect(transitions).toContain(false);
    expect(transitions).toContain(true);

    detector.destroy();
  });

  it('should not transition to mutating for non-form events', () => {
    buildForm('ignored-form', [{ id: 'ign-field', tag: 'input', type: 'text', label: 'Ignored' }]);

    const detector = new FormMutationDetector({ settleMs: 200 });
    detector.install();

    // Dispatch an input event on a non-form element (e.g., div)
    const div = document.createElement('div');
    appendToBody(div);
    div.dispatchEvent(new Event('input', { bubbles: true }));

    expect(detector.isIdle()).toBe(true);

    detector.destroy();
  });

  it('should reset settle timer on subsequent mutations', () => {
    buildForm('reset-form', [{ id: 'reset-field', tag: 'input', type: 'text', label: 'Reset' }]);

    const detector = new FormMutationDetector({ settleMs: 300 });
    detector.install();

    // First fill
    fillFormFields({ 'reset-field': 'a' }, { triggerValidation: false });
    expect(detector.isIdle()).toBe(false);

    // Advance 200ms (less than settleMs)
    vi.advanceTimersByTime(200);
    expect(detector.isIdle()).toBe(false);

    // Second fill — resets the timer
    fillFormFields({ 'reset-field': 'ab' }, { triggerValidation: false });

    // Advance 200ms more — still within new settle window
    vi.advanceTimersByTime(200);
    expect(detector.isIdle()).toBe(false);

    // Advance past the new settle window
    vi.advanceTimersByTime(200);
    expect(detector.isIdle()).toBe(true);

    detector.destroy();
  });
});

// ============================================================================
// 5. Adapter registry
// ============================================================================

describe('Adapter registry', () => {
  it('should register, detect, and unregister adapters', () => {
    const registry = createAdapterRegistry();

    // Create a mock adapter that always detects
    const mockAdapter: FormFrameworkAdapter = {
      name: 'mock-rhf',
      detect: () => true,
      extractForms: () => [
        {
          id: 'mock-form',
          fields: [
            {
              id: 'mock-field',
              label: 'Mock Field',
              type: 'text',
              value: 'test',
              valid: true,
              required: false,
              touched: false,
            },
          ],
          isValid: true,
          isDirty: false,
        },
      ],
      getFieldErrors: () => null,
      isFieldTouched: () => null,
      isFieldDirty: () => null,
    };

    // Register
    registry.register(mockAdapter);
    expect(registry.getAllAdapters()).toHaveLength(1);
    expect(registry.getAdapter('mock-rhf')).toBe(mockAdapter);

    // Detect
    const detected = registry.detectAdapters();
    expect(detected).toHaveLength(1);
    expect(detected[0].name).toBe('mock-rhf');

    // Verify extractForms works
    const forms = detected[0].extractForms();
    expect(forms).toHaveLength(1);
    expect(forms[0].id).toBe('mock-form');
    expect(forms[0].fields[0].value).toBe('test');

    // Unregister
    registry.unregister('mock-rhf');
    expect(registry.getAllAdapters()).toHaveLength(0);
    expect(registry.getAdapter('mock-rhf')).toBeUndefined();
    expect(registry.detectAdapters()).toHaveLength(0);
  });

  it('should only detect adapters that return true from detect()', () => {
    const registry = createAdapterRegistry();

    const activeAdapter: FormFrameworkAdapter = {
      name: 'active',
      detect: () => true,
      extractForms: () => [],
      getFieldErrors: () => null,
      isFieldTouched: () => null,
      isFieldDirty: () => null,
    };

    const inactiveAdapter: FormFrameworkAdapter = {
      name: 'inactive',
      detect: () => false,
      extractForms: () => [],
      getFieldErrors: () => null,
      isFieldTouched: () => null,
      isFieldDirty: () => null,
    };

    registry.register(activeAdapter);
    registry.register(inactiveAdapter);

    expect(registry.getAllAdapters()).toHaveLength(2);
    const detected = registry.detectAdapters();
    expect(detected).toHaveLength(1);
    expect(detected[0].name).toBe('active');
  });

  it('should handle adapter detect() throwing an error gracefully', () => {
    const registry = createAdapterRegistry();

    const throwingAdapter: FormFrameworkAdapter = {
      name: 'crasher',
      detect: () => {
        throw new Error('detect failed');
      },
      extractForms: () => [],
      getFieldErrors: () => null,
      isFieldTouched: () => null,
      isFieldDirty: () => null,
    };

    registry.register(throwingAdapter);
    // Should not throw
    const detected = registry.detectAdapters();
    expect(detected).toHaveLength(0);
  });
});

// ============================================================================
// 6. Semantic snapshot with includeForms
// ============================================================================

describe('Semantic snapshot with includeForms', () => {
  it('should include formsDetail when formsResponse is provided', () => {
    const manager = createSnapshotManager({ includeForms: true });

    // Build a minimal ControlSnapshot
    const controlSnapshot: ControlSnapshot = {
      elements: [],
      timestamp: Date.now(),
    };

    // Build a FormsResponse
    const formsResponse: FormsResponse = {
      forms: [
        {
          id: 'test-form',
          purpose: 'Contact',
          fields: [
            {
              id: 'name',
              label: 'Name',
              type: 'text',
              value: 'Alice',
              valid: true,
              required: true,
              touched: true,
            },
          ],
          isValid: true,
          isDirty: true,
        },
      ],
      summary: '1 form(s), 1 field(s), 1 filled',
      timestamp: Date.now(),
    };

    const snapshot = manager.createSnapshot(controlSnapshot, undefined, formsResponse);

    expect(snapshot.formsDetail).toBeDefined();
    expect(snapshot.formsDetail!.forms).toHaveLength(1);
    expect(snapshot.formsDetail!.forms[0].id).toBe('test-form');
    expect(snapshot.formsDetail!.forms[0].fields[0].value).toBe('Alice');
  });

  it('should not include formsDetail when formsResponse is not provided', () => {
    const manager = createSnapshotManager({ includeForms: false });

    const controlSnapshot: ControlSnapshot = {
      elements: [],
      timestamp: Date.now(),
    };

    const snapshot = manager.createSnapshot(controlSnapshot);

    expect(snapshot.formsDetail).toBeUndefined();
  });

  it('should include formsDetail from discoverForms in an end-to-end flow', () => {
    // Create a real form in the DOM
    const form = document.createElement('form');
    form.id = 'e2e-form';

    const input = document.createElement('input');
    input.id = 'e2e-name';
    input.type = 'text';
    input.value = 'Bob';
    input.setAttribute('aria-label', 'Name');
    form.appendChild(input);

    appendToBody(form);

    // Build discovery elements
    const elements: FormDiscoveryElement[] = [
      toDiscoveryElement('e2e-form', form, 'form'),
      toDiscoveryElement('e2e-name', input, 'input', 'Name'),
    ];

    // Discover forms
    const formsResponse = discoverForms(elements);
    expect(formsResponse.forms.length).toBeGreaterThanOrEqual(1);

    // Create snapshot with the form data
    const manager = createSnapshotManager({ includeForms: true });
    const controlSnapshot: ControlSnapshot = {
      elements: [],
      timestamp: Date.now(),
    };

    const snapshot = manager.createSnapshot(controlSnapshot, undefined, formsResponse);

    expect(snapshot.formsDetail).toBeDefined();
    expect(snapshot.formsDetail!.forms.length).toBeGreaterThanOrEqual(1);
    const discoveredForm = snapshot.formsDetail!.forms.find((f) => f.id === 'e2e-form');
    expect(discoveredForm).toBeDefined();
    expect(discoveredForm!.fields.find((f) => f.id === 'e2e-name')?.value).toBe('Bob');
  });
});

// ============================================================================
// 7. Combined end-to-end: fill -> discover -> validate -> diff
// ============================================================================

describe('Combined end-to-end flow', () => {
  it('should fill a form, discover its state, validate, and diff', () => {
    // Build a form with mixed field types
    const { form, fieldElements } = buildForm('e2e-combined-form', [
      { id: 'c-name', tag: 'input', type: 'text', label: 'Name', required: true },
      { id: 'c-email', tag: 'input', type: 'email', label: 'Email', required: true },
      { id: 'c-notes', tag: 'textarea', label: 'Notes' },
      {
        id: 'c-country',
        tag: 'select',
        label: 'Country',
        options: ['', 'us', 'uk', 'de'],
        value: '',
      },
    ]);

    // Snapshot before
    const before = captureFormSnapshot();

    // Fill all fields
    const fillResult = fillFormFields(
      {
        'c-name': 'Alice Smith',
        'c-email': 'alice@example.com',
        'c-notes': 'Hello world',
        'c-country': 'uk',
      },
      { triggerValidation: false }
    );
    expect(fillResult.success).toBe(true);

    // Snapshot after
    const after = captureFormSnapshot();

    // Diff
    const diff = diffFormSnapshots(before, after);
    expect(diff.hasChanges).toBe(true);

    // Verify value changes exist
    const nameChange = diff.changedFields.find((f) => f.fieldId === 'c-name');
    expect(nameChange).toBeDefined();
    expect(nameChange!.changes.value).toEqual({ before: '', after: 'Alice Smith' });

    const countryChange = diff.changedFields.find((f) => f.fieldId === 'c-country');
    expect(countryChange).toBeDefined();
    expect(countryChange!.changes.value).toEqual({ before: '', after: 'uk' });

    // Now use discoverForms for richer state
    const elements: FormDiscoveryElement[] = [
      toDiscoveryElement('e2e-combined-form', form, 'form'),
      toDiscoveryElement('c-name', fieldElements['c-name'], 'input', 'Name'),
      toDiscoveryElement('c-email', fieldElements['c-email'], 'input', 'Email'),
      toDiscoveryElement('c-notes', fieldElements['c-notes'], 'textarea', 'Notes'),
      toDiscoveryElement('c-country', fieldElements['c-country'], 'select', 'Country'),
    ];

    const formsResponse = discoverForms(elements);
    const discoveredForm = formsResponse.forms.find((f) => f.id === 'e2e-combined-form');
    expect(discoveredForm).toBeDefined();
    expect(discoveredForm!.isValid).toBe(true); // all required fields filled with valid data
    expect(discoveredForm!.fields.find((f) => f.id === 'c-email')?.value).toBe('alice@example.com');

    // Validate via scanner
    const errors = scanValidationErrors([
      { id: 'c-name', element: fieldElements['c-name'] },
      { id: 'c-email', element: fieldElements['c-email'] },
      { id: 'c-notes', element: fieldElements['c-notes'] },
      { id: 'c-country', element: fieldElements['c-country'] },
    ]);

    // All fields should be valid — no errors
    expect(errors).toHaveLength(0);
  });
});
