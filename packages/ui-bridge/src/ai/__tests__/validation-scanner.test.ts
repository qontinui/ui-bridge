/**
 * Validation Scanner Tests
 *
 * Tests for the validation error heuristic scanner that detects form field
 * validation errors using HTML5, ARIA, adjacent element, and CSS class strategies.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { scanValidationErrors } from '../validation-scanner';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create an HTMLInputElement and optionally attach it to the DOM.
 */
function createInput(options: {
  id?: string;
  type?: string;
  validity?: Partial<ValidityState>;
  validationMessage?: string;
  ariaInvalid?: string;
  ariaErrorMessage?: string;
  ariaDescribedBy?: string;
  classes?: string[];
  dataInvalid?: string;
  dataError?: string;
  parent?: HTMLElement;
}): HTMLInputElement {
  const input = document.createElement('input');
  if (options.id) input.id = options.id;
  if (options.type) input.type = options.type;

  if (options.validity) {
    const validityState: ValidityState = {
      badInput: false,
      customError: false,
      patternMismatch: false,
      rangeOverflow: false,
      rangeUnderflow: false,
      stepMismatch: false,
      tooLong: false,
      tooShort: false,
      typeMismatch: false,
      valid: true,
      valueMissing: false,
      ...options.validity,
    };
    Object.defineProperty(input, 'validity', {
      value: validityState,
      configurable: true,
    });
  }

  if (options.validationMessage !== undefined) {
    Object.defineProperty(input, 'validationMessage', {
      value: options.validationMessage,
      configurable: true,
    });
  }

  if (options.ariaInvalid) {
    input.setAttribute('aria-invalid', options.ariaInvalid);
  }
  if (options.ariaErrorMessage) {
    input.setAttribute('aria-errormessage', options.ariaErrorMessage);
  }
  if (options.ariaDescribedBy) {
    input.setAttribute('aria-describedby', options.ariaDescribedBy);
  }
  if (options.classes) {
    for (const cls of options.classes) {
      input.classList.add(cls);
    }
  }
  if (options.dataInvalid) {
    input.setAttribute('data-invalid', options.dataInvalid);
  }
  if (options.dataError !== undefined) {
    input.setAttribute('data-error', options.dataError);
  }

  if (options.parent) {
    options.parent.appendChild(input);
  }

  return input;
}

afterEach(() => {
  document.body.innerHTML = '';
});

// ============================================================================
// Basic behavior
// ============================================================================

describe('scanValidationErrors', () => {
  it('should return empty array for empty input', () => {
    const result = scanValidationErrors([]);
    expect(result).toEqual([]);
  });

  it('should skip non-form-control elements (div, span, etc.)', () => {
    const div = document.createElement('div');
    const span = document.createElement('span');
    const p = document.createElement('p');

    const result = scanValidationErrors([
      { id: 'div1', element: div },
      { id: 'span1', element: span },
      { id: 'p1', element: p },
    ]);

    expect(result).toEqual([]);
  });

  it('should process textarea elements', () => {
    const textarea = document.createElement('textarea');
    textarea.classList.add('is-invalid');
    document.body.appendChild(textarea);

    const result = scanValidationErrors([{ id: 'ta1', element: textarea }]);
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe('ta1');
    expect(result[0].source).toBe('css-class');
  });

  it('should process select elements', () => {
    const select = document.createElement('select');
    select.classList.add('is-invalid');
    document.body.appendChild(select);

    const result = scanValidationErrors([{ id: 'sel1', element: select }]);
    expect(result).toHaveLength(1);
    expect(result[0].fieldId).toBe('sel1');
    expect(result[0].source).toBe('css-class');
  });

  // ============================================================================
  // Strategy 1: HTML5 Constraint Validation API
  // ============================================================================

  describe('HTML5 Constraint Validation', () => {
    it('should detect invalid field with validationMessage', () => {
      const input = createInput({
        id: 'email',
        validity: { valid: false, typeMismatch: true },
        validationMessage: 'Please enter a valid email address',
      });

      const result = scanValidationErrors([{ id: 'email', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        fieldId: 'email',
        message: 'Please enter a valid email address',
        confidence: 1.0,
        source: 'html5',
      });
    });

    it('should detect invalid field with valueMissing', () => {
      const input = createInput({
        id: 'required-field',
        validity: { valid: false, valueMissing: true },
        validationMessage: 'Please fill out this field',
      });

      const result = scanValidationErrors([{ id: 'required-field', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].confidence).toBe(1.0);
      expect(result[0].source).toBe('html5');
      expect(result[0].message).toBe('Please fill out this field');
    });

    it('should use fallback message when validationMessage is empty', () => {
      const input = createInput({
        id: 'field',
        validity: { valid: false },
        validationMessage: '',
      });

      const result = scanValidationErrors([{ id: 'field', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe('Invalid value');
    });

    it('should not detect error on valid field', () => {
      const input = createInput({
        id: 'valid-field',
        validity: { valid: true },
        validationMessage: '',
      });

      const result = scanValidationErrors([{ id: 'valid-field', element: input }]);

      expect(result).toHaveLength(0);
    });
  });

  // ============================================================================
  // Strategy 2: ARIA attributes
  // ============================================================================

  describe('ARIA attributes', () => {
    it('should detect aria-invalid="true" with aria-errormessage reference', () => {
      const errorEl = document.createElement('span');
      errorEl.id = 'email-error';
      errorEl.textContent = 'Email is required';
      document.body.appendChild(errorEl);

      const input = createInput({
        id: 'email',
        ariaInvalid: 'true',
        ariaErrorMessage: 'email-error',
      });
      document.body.appendChild(input);

      const result = scanValidationErrors([{ id: 'email', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        fieldId: 'email',
        message: 'Email is required',
        confidence: 0.95,
        source: 'aria',
      });
    });

    it('should detect aria-invalid="true" with aria-describedby reference', () => {
      const descEl = document.createElement('div');
      descEl.id = 'name-desc';
      descEl.setAttribute('role', 'alert');
      descEl.textContent = 'Name must be at least 2 characters';
      document.body.appendChild(descEl);

      const input = createInput({
        id: 'name',
        ariaInvalid: 'true',
        ariaDescribedBy: 'name-desc',
      });
      document.body.appendChild(input);

      const result = scanValidationErrors([{ id: 'name', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe('Name must be at least 2 characters');
      expect(result[0].confidence).toBe(0.95);
      expect(result[0].source).toBe('aria');
    });

    it('should detect aria-invalid="true" with aria-describedby using short text', () => {
      // Short text near an aria-invalid input is treated as an error even without role=alert
      const descEl = document.createElement('span');
      descEl.id = 'field-hint';
      descEl.textContent = 'Invalid format';
      document.body.appendChild(descEl);

      const input = createInput({
        id: 'phone',
        ariaInvalid: 'true',
        ariaDescribedBy: 'field-hint',
      });
      document.body.appendChild(input);

      const result = scanValidationErrors([{ id: 'phone', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe('Invalid format');
    });

    it('should handle aria-describedby with space-separated IDs', () => {
      const helpEl = document.createElement('span');
      helpEl.id = 'help1';
      helpEl.textContent = ''; // empty
      document.body.appendChild(helpEl);

      const errorEl = document.createElement('span');
      errorEl.id = 'error1';
      errorEl.setAttribute('role', 'alert');
      errorEl.textContent = 'Field is invalid';
      document.body.appendChild(errorEl);

      const input = createInput({
        id: 'multi-desc',
        ariaInvalid: 'true',
        ariaDescribedBy: 'help1 error1',
      });
      document.body.appendChild(input);

      const result = scanValidationErrors([{ id: 'multi-desc', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe('Field is invalid');
    });

    it('should detect aria-invalid="true" without error message element', () => {
      const input = createInput({
        id: 'solo-invalid',
        ariaInvalid: 'true',
      });
      document.body.appendChild(input);

      const result = scanValidationErrors([{ id: 'solo-invalid', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        fieldId: 'solo-invalid',
        message: '',
        confidence: 0.95,
        source: 'aria',
      });
    });

    it('should not detect aria-invalid="false"', () => {
      const input = createInput({
        id: 'valid-aria',
        ariaInvalid: 'false',
      });

      const result = scanValidationErrors([{ id: 'valid-aria', element: input }]);

      expect(result).toHaveLength(0);
    });
  });

  // ============================================================================
  // Strategy 3: Adjacent sibling error elements
  // ============================================================================

  describe('Adjacent element detection', () => {
    it('should find .error element in parent container', () => {
      const container = document.createElement('div');
      container.classList.add('form-group');
      document.body.appendChild(container);

      const input = createInput({ id: 'field1', parent: container });

      const errorSpan = document.createElement('span');
      errorSpan.classList.add('error');
      errorSpan.textContent = 'This field is required';
      container.appendChild(errorSpan);

      const result = scanValidationErrors([{ id: 'field1', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        fieldId: 'field1',
        message: 'This field is required',
        confidence: 0.8,
        source: 'adjacent-element',
      });
    });

    it('should find .invalid-feedback in form-group', () => {
      const container = document.createElement('div');
      container.classList.add('form-group');
      document.body.appendChild(container);

      const input = createInput({ id: 'field2', parent: container });

      const feedback = document.createElement('div');
      feedback.classList.add('invalid-feedback');
      feedback.textContent = 'Please provide a valid value';
      container.appendChild(feedback);

      const result = scanValidationErrors([{ id: 'field2', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe('Please provide a valid value');
      expect(result[0].confidence).toBe(0.8);
      expect(result[0].source).toBe('adjacent-element');
    });

    it('should find next sibling with error class', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      const input = createInput({ id: 'field3', parent: container });

      const sibling = document.createElement('span');
      sibling.classList.add('is-invalid');
      sibling.textContent = 'Error in field';
      container.appendChild(sibling);

      const result = scanValidationErrors([{ id: 'field3', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe('Error in field');
      expect(result[0].confidence).toBe(0.8);
    });

    it('should find [role="alert"] in container', () => {
      const container = document.createElement('div');
      container.classList.add('form-field');
      document.body.appendChild(container);

      const input = createInput({ id: 'field-alert', parent: container });

      const alert = document.createElement('div');
      alert.setAttribute('role', 'alert');
      alert.textContent = 'Alert: invalid input';
      container.appendChild(alert);

      const result = scanValidationErrors([{ id: 'field-alert', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].message).toBe('Alert: invalid input');
      expect(result[0].source).toBe('adjacent-element');
    });

    it('should not find error when container has no error elements', () => {
      const container = document.createElement('div');
      container.classList.add('form-group');
      document.body.appendChild(container);

      const input = createInput({ id: 'clean-field', parent: container });

      const label = document.createElement('label');
      label.textContent = 'Username';
      container.appendChild(label);

      const result = scanValidationErrors([{ id: 'clean-field', element: input }]);

      expect(result).toHaveLength(0);
    });
  });

  // ============================================================================
  // Strategy 4: CSS class heuristics
  // ============================================================================

  describe('CSS class heuristics', () => {
    it('should detect is-invalid class on input', () => {
      const input = createInput({
        id: 'css-field1',
        classes: ['is-invalid'],
      });

      const result = scanValidationErrors([{ id: 'css-field1', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        fieldId: 'css-field1',
        message: '',
        confidence: 0.6,
        source: 'css-class',
      });
    });

    it('should detect has-error class on input', () => {
      const input = createInput({
        id: 'css-field2',
        classes: ['has-error'],
      });

      const result = scanValidationErrors([{ id: 'css-field2', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('css-class');
    });

    it('should detect error class on input', () => {
      const input = createInput({
        id: 'css-field3',
        classes: ['error'],
      });

      const result = scanValidationErrors([{ id: 'css-field3', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('css-class');
    });

    it('should detect Mui-error class on input', () => {
      const input = createInput({
        id: 'mui-field',
        classes: ['Mui-error'],
      });

      const result = scanValidationErrors([{ id: 'mui-field', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('css-class');
    });

    it('should detect data-invalid="true" attribute', () => {
      const input = createInput({
        id: 'data-field1',
        dataInvalid: 'true',
      });

      const result = scanValidationErrors([{ id: 'data-field1', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('css-class');
      expect(result[0].confidence).toBe(0.6);
    });

    it('should detect data-error attribute', () => {
      const input = createInput({
        id: 'data-field2',
        dataError: 'some error',
      });

      const result = scanValidationErrors([{ id: 'data-field2', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('css-class');
    });

    it('should not detect when no error classes or data attributes', () => {
      const input = createInput({
        id: 'clean',
        classes: ['form-control', 'regular-class'],
      });

      const result = scanValidationErrors([{ id: 'clean', element: input }]);

      expect(result).toHaveLength(0);
    });
  });

  // ============================================================================
  // Priority and deduplication
  // ============================================================================

  describe('Priority and deduplication', () => {
    it('should prefer HTML5 over ARIA when both present', () => {
      const input = createInput({
        id: 'both',
        validity: { valid: false, valueMissing: true },
        validationMessage: 'Required field',
        ariaInvalid: 'true',
      });

      const result = scanValidationErrors([{ id: 'both', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('html5');
      expect(result[0].confidence).toBe(1.0);
      expect(result[0].message).toBe('Required field');
    });

    it('should prefer HTML5 over CSS class when both present', () => {
      const input = createInput({
        id: 'html5-css',
        validity: { valid: false },
        validationMessage: 'Pattern mismatch',
        classes: ['is-invalid'],
      });

      const result = scanValidationErrors([{ id: 'html5-css', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('html5');
    });

    it('should prefer ARIA over CSS class when both present', () => {
      const input = createInput({
        id: 'aria-css',
        ariaInvalid: 'true',
        classes: ['is-invalid'],
      });

      const result = scanValidationErrors([{ id: 'aria-css', element: input }]);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('aria');
      expect(result[0].confidence).toBe(0.95);
    });

    it('should report same field ID only once (deduplication)', () => {
      const input1 = createInput({
        id: 'dup',
        validity: { valid: false },
        validationMessage: 'Error 1',
      });

      const input2 = createInput({
        id: 'dup-2',
        classes: ['is-invalid'],
      });

      const result = scanValidationErrors([
        { id: 'dup', element: input1 },
        { id: 'dup', element: input2 },
      ]);

      // Same field ID 'dup' should only appear once
      expect(result).toHaveLength(1);
      expect(result[0].fieldId).toBe('dup');
      expect(result[0].source).toBe('html5');
    });

    it('should report different field IDs separately', () => {
      const input1 = createInput({
        id: 'field-a',
        validity: { valid: false },
        validationMessage: 'Error A',
      });

      const input2 = createInput({
        id: 'field-b',
        classes: ['is-invalid'],
      });

      const result = scanValidationErrors([
        { id: 'field-a', element: input1 },
        { id: 'field-b', element: input2 },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].fieldId).toBe('field-a');
      expect(result[1].fieldId).toBe('field-b');
    });
  });

  // ============================================================================
  // Edge cases
  // ============================================================================

  describe('Edge cases', () => {
    it('should handle fields with no errors among multiple fields', () => {
      const validInput = createInput({
        id: 'valid',
        validity: { valid: true },
      });

      const invalidInput = createInput({
        id: 'invalid',
        validity: { valid: false },
        validationMessage: 'Error',
      });

      const result = scanValidationErrors([
        { id: 'valid', element: validInput },
        { id: 'invalid', element: invalidInput },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].fieldId).toBe('invalid');
    });

    it('should handle mixed form element types', () => {
      const input = createInput({ id: 'inp', classes: ['is-invalid'] });

      const textarea = document.createElement('textarea');
      textarea.classList.add('error');

      const select = document.createElement('select');
      // No error indicators

      const div = document.createElement('div');

      const result = scanValidationErrors([
        { id: 'inp', element: input },
        { id: 'ta', element: textarea },
        { id: 'sel', element: select },
        { id: 'div', element: div },
      ]);

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.fieldId)).toEqual(['inp', 'ta']);
    });
  });
});
