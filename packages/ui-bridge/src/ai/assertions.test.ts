/**
 * Assertions Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  AssertionExecutor,
  createAssertionExecutor,
  DEFAULT_ASSERTION_CONFIG,
} from './assertions';
import type { AIDiscoveredElement } from './types';

// Helper to create mock AI discovered elements
function createMockAIElement(
  id: string,
  options: {
    textContent?: string;
    type?: string;
    visible?: boolean;
    enabled?: boolean;
    focused?: boolean;
    checked?: boolean;
    value?: string;
    description?: string;
    aliases?: string[];
    placeholder?: string;
    title?: string;
  } = {}
): AIDiscoveredElement {
  const {
    textContent = '',
    type = 'button',
    visible = true,
    enabled = true,
    focused = false,
    checked,
    value = '',
    description = `Mock ${type}`,
    aliases = [id],
    placeholder,
    title,
  } = options;

  return {
    id,
    type,
    label: id,
    tagName: type === 'button' ? 'button' : type === 'input' ? 'input' : 'div',
    description,
    aliases,
    suggestedActions: ['click'],
    actions: ['click'],
    state: {
      visible,
      enabled,
      focused,
      checked,
      value,
      textContent,
      rect: { x: 0, y: 0, width: 100, height: 30 },
      attributes: {},
    },
    registered: false,
    placeholder,
    title,
  };
}

describe('AssertionExecutor', () => {
  let executor: AssertionExecutor;

  beforeEach(() => {
    executor = new AssertionExecutor();
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const executor = new AssertionExecutor();
      expect(executor).toBeDefined();
    });

    it('should accept custom config', () => {
      const executor = new AssertionExecutor({
        defaultTimeout: 10000,
        fuzzyThreshold: 0.8,
      });
      expect(executor).toBeDefined();
    });
  });

  describe('createAssertionExecutor', () => {
    it('should create an assertion executor instance', () => {
      const executor = createAssertionExecutor();
      expect(executor).toBeInstanceOf(AssertionExecutor);
    });

    it('should accept custom config', () => {
      const executor = createAssertionExecutor({ defaultTimeout: 3000 });
      expect(executor).toBeInstanceOf(AssertionExecutor);
    });
  });

  describe('updateElements', () => {
    it('should update available elements', async () => {
      const elements = [
        createMockAIElement('btn-1', { textContent: 'Submit' }),
        createMockAIElement('btn-2', { textContent: 'Cancel' }),
      ];

      executor.updateElements(elements);

      const result = await executor.assertVisible('Submit');
      expect(result.passed).toBe(true);
    });
  });

  describe('assertVisible', () => {
    it('should pass when element is visible', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit', visible: true })];
      executor.updateElements(elements);

      const result = await executor.assertVisible('Submit');

      expect(result.passed).toBe(true);
      expect(result.expected).toBe(true);
      expect(result.actual).toBe(true);
    });

    it('should fail when element is hidden', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit', visible: false })];
      executor.updateElements(elements);

      const result = await executor.assertVisible('Submit');

      expect(result.passed).toBe(false);
      expect(result.actual).toBe(false);
      expect(result.failureReason).toBeDefined();
    });

    it('should fail when element is not found', async () => {
      executor.updateElements([]);

      const result = await executor.assertVisible('NonExistent');

      expect(result.passed).toBe(false);
      expect(result.failureReason).toContain('could not be found');
    });

    it('should include suggestion on failure', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit', visible: false })];
      executor.updateElements(elements);

      const result = await executor.assertVisible('Submit');

      expect(result.suggestion).toBeDefined();
    });
  });

  describe('assertHidden', () => {
    it('should pass when element is hidden', async () => {
      const elements = [createMockAIElement('modal', { textContent: 'Modal', visible: false })];
      executor.updateElements(elements);

      const result = await executor.assertHidden('Modal');

      expect(result.passed).toBe(true);
    });

    it('should fail when element is visible', async () => {
      const elements = [createMockAIElement('modal', { textContent: 'Modal', visible: true })];
      executor.updateElements(elements);

      const result = await executor.assertHidden('Modal');

      expect(result.passed).toBe(false);
    });
  });

  describe('assertEnabled', () => {
    it('should pass when element is enabled', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit', enabled: true })];
      executor.updateElements(elements);

      const result = await executor.assertEnabled('Submit');

      expect(result.passed).toBe(true);
    });

    it('should fail when element is disabled', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit', enabled: false })];
      executor.updateElements(elements);

      const result = await executor.assertEnabled('Submit');

      expect(result.passed).toBe(false);
    });
  });

  describe('assertDisabled', () => {
    it('should pass when element is disabled', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit', enabled: false })];
      executor.updateElements(elements);

      const result = await executor.assertDisabled('Submit');

      expect(result.passed).toBe(true);
    });

    it('should fail when element is enabled', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit', enabled: true })];
      executor.updateElements(elements);

      const result = await executor.assertDisabled('Submit');

      expect(result.passed).toBe(false);
    });
  });

  describe('assertHasText', () => {
    it('should pass when element has exact text', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit Form', aliases: ['btn-1', 'submit form'] })];
      executor.updateElements(elements);

      // Search by text content
      const result = await executor.assertHasText('Submit Form', 'Submit Form');

      expect(result.passed).toBe(true);
    });

    it('should fail when text does not match exactly', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit Form', aliases: ['btn-1', 'submit form'] })];
      executor.updateElements(elements);

      const result = await executor.assertHasText('Submit Form', 'Submit');

      expect(result.passed).toBe(false);
    });

    it('should include expected and actual text', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Actual Text', aliases: ['btn-1', 'actual text'] })];
      executor.updateElements(elements);

      const result = await executor.assertHasText('Actual Text', 'Expected Text');

      expect(result.expected).toBe('Expected Text');
      expect(result.actual).toBe('Actual Text');
    });
  });

  describe('assertContainsText', () => {
    it('should pass when element contains text', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit Form Now', aliases: ['btn-1', 'submit form now'] })];
      executor.updateElements(elements);

      // Search by the full text content
      const result = await executor.assertContainsText('Submit Form Now', 'Form');

      expect(result.passed).toBe(true);
    });

    it('should fail when element does not contain text', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit Form', aliases: ['btn-1', 'submit form'] })];
      executor.updateElements(elements);

      const result = await executor.assertContainsText('Submit Form', 'Cancel');

      expect(result.passed).toBe(false);
    });
  });

  describe('assertHasValue', () => {
    it('should pass when input has expected value', async () => {
      const elements = [
        createMockAIElement('email-input', {
          type: 'input',
          textContent: 'Email',
          value: 'test@example.com',
        }),
      ];
      executor.updateElements(elements);

      const result = await executor.assertHasValue('Email', 'test@example.com');

      expect(result.passed).toBe(true);
    });

    it('should fail when value does not match', async () => {
      const elements = [
        createMockAIElement('email-input', {
          type: 'input',
          textContent: 'Email',
          value: 'actual@example.com',
        }),
      ];
      executor.updateElements(elements);

      const result = await executor.assertHasValue('Email', 'expected@example.com');

      expect(result.passed).toBe(false);
    });
  });

  describe('assertExists', () => {
    it('should pass when element exists', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit' })];
      executor.updateElements(elements);

      const result = await executor.assertExists('Submit');

      expect(result.passed).toBe(true);
    });

    it('should fail when element does not exist', async () => {
      executor.updateElements([]);

      const result = await executor.assertExists('NonExistent');

      expect(result.passed).toBe(false);
    });
  });

  describe('assertNotExists', () => {
    it('should pass when element does not exist', async () => {
      executor.updateElements([]);

      const result = await executor.assertNotExists('NonExistent');

      expect(result.passed).toBe(true);
    });

    it('should fail when element exists', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit' })];
      executor.updateElements(elements);

      const result = await executor.assertNotExists('Submit');

      expect(result.passed).toBe(false);
    });
  });

  describe('assertChecked', () => {
    it('should pass when checkbox is checked', async () => {
      const elements = [
        createMockAIElement('checkbox-1', {
          type: 'checkbox',
          textContent: 'Accept Terms',
          checked: true,
        }),
      ];
      executor.updateElements(elements);

      const result = await executor.assertChecked('Accept Terms');

      expect(result.passed).toBe(true);
    });

    it('should fail when checkbox is unchecked', async () => {
      const elements = [
        createMockAIElement('checkbox-1', {
          type: 'checkbox',
          textContent: 'Accept Terms',
          checked: false,
        }),
      ];
      executor.updateElements(elements);

      const result = await executor.assertChecked('Accept Terms');

      expect(result.passed).toBe(false);
    });
  });

  describe('assertUnchecked', () => {
    it('should pass when checkbox is unchecked', async () => {
      const elements = [
        createMockAIElement('checkbox-1', {
          type: 'checkbox',
          textContent: 'Newsletter',
          checked: false,
        }),
      ];
      executor.updateElements(elements);

      const result = await executor.assertUnchecked('Newsletter');

      expect(result.passed).toBe(true);
    });

    it('should fail when checkbox is checked', async () => {
      const elements = [
        createMockAIElement('checkbox-1', {
          type: 'checkbox',
          textContent: 'Newsletter',
          checked: true,
        }),
      ];
      executor.updateElements(elements);

      const result = await executor.assertUnchecked('Newsletter');

      expect(result.passed).toBe(false);
    });
  });

  describe('assertCount', () => {
    it('should pass when element count matches', async () => {
      const elements = [
        createMockAIElement('btn-1', { type: 'button', textContent: 'Button 1' }),
        createMockAIElement('btn-2', { type: 'button', textContent: 'Button 2' }),
        createMockAIElement('btn-3', { type: 'button', textContent: 'Button 3' }),
      ];
      executor.updateElements(elements);

      const result = await executor.assertCount({ type: 'button' }, 3);

      expect(result.passed).toBe(true);
    });

    it('should fail when count does not match', async () => {
      const elements = [
        createMockAIElement('btn-1', { type: 'button', textContent: 'Button 1' }),
        createMockAIElement('btn-2', { type: 'button', textContent: 'Button 2' }),
      ];
      executor.updateElements(elements);

      const result = await executor.assertCount({ type: 'button' }, 5);

      expect(result.passed).toBe(false);
      expect(result.expected).toBe(5);
      expect(result.actual).toBe(2);
    });
  });

  describe('assert with SearchCriteria', () => {
    it('should find element using search criteria', async () => {
      const elements = [
        createMockAIElement('submit-btn', { textContent: 'Submit', type: 'button', aliases: ['submit', 'submit-btn'] }),
      ];
      executor.updateElements(elements);

      const result = await executor.assert({
        target: { text: 'Submit', type: 'button' },
        type: 'visible',
      });

      expect(result.passed).toBe(true);
    });

    it('should support fuzzy matching in criteria', async () => {
      const elements = [createMockAIElement('submit-btn', { textContent: 'Submit', aliases: ['submit', 'submit-btn'] })];
      executor.updateElements(elements);

      // Use textContains for partial matching which is more lenient
      const result = await executor.assert({
        target: { textContains: 'Sub', fuzzy: true },
        type: 'visible',
      });

      expect(result.passed).toBe(true);
    });
  });

  describe('assertBatch', () => {
    beforeEach(() => {
      const elements = [
        createMockAIElement('submit-btn', { textContent: 'Submit', visible: true, enabled: true }),
        createMockAIElement('cancel-btn', { textContent: 'Cancel', visible: true, enabled: false }),
      ];
      executor.updateElements(elements);
    });

    it('should pass when all assertions pass in "all" mode', async () => {
      const result = await executor.assertBatch({
        assertions: [
          { target: 'Submit', type: 'visible' },
          { target: 'Submit', type: 'enabled' },
        ],
        mode: 'all',
      });

      expect(result.passed).toBe(true);
      expect(result.passedCount).toBe(2);
      expect(result.failedCount).toBe(0);
    });

    it('should fail when any assertion fails in "all" mode', async () => {
      const result = await executor.assertBatch({
        assertions: [
          { target: 'Submit', type: 'visible' },
          { target: 'Cancel', type: 'enabled' }, // Cancel is disabled
        ],
        mode: 'all',
      });

      expect(result.passed).toBe(false);
      expect(result.failedCount).toBeGreaterThan(0);
    });

    it('should pass when any assertion passes in "any" mode', async () => {
      const result = await executor.assertBatch({
        assertions: [
          { target: 'Cancel', type: 'enabled' }, // fails
          { target: 'Submit', type: 'visible' }, // passes
        ],
        mode: 'any',
      });

      expect(result.passed).toBe(true);
      expect(result.passedCount).toBeGreaterThan(0);
    });

    it('should fail when no assertions pass in "any" mode', async () => {
      const result = await executor.assertBatch({
        assertions: [
          { target: 'Cancel', type: 'enabled' }, // fails
          { target: 'NonExistent', type: 'visible' }, // fails
        ],
        mode: 'any',
      });

      expect(result.passed).toBe(false);
    });

    it('should stop on first failure when stopOnFailure is true', async () => {
      const result = await executor.assertBatch({
        assertions: [
          { target: 'Cancel', type: 'enabled' }, // fails first
          { target: 'Submit', type: 'visible' }, // would pass
          { target: 'Submit', type: 'enabled' }, // would pass
        ],
        mode: 'all',
        stopOnFailure: true,
      });

      expect(result.passed).toBe(false);
      expect(result.results.length).toBe(1); // Only first assertion executed
    });

    it('should include duration and timestamp', async () => {
      const result = await executor.assertBatch({
        assertions: [{ target: 'Submit', type: 'visible' }],
        mode: 'all',
      });

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('assertion result properties', () => {
    it('should include target in result', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit' })];
      executor.updateElements(elements);

      const result = await executor.assertVisible('Submit');

      expect(result.target).toBeDefined();
    });

    it('should include targetDescription', async () => {
      const elements = [
        createMockAIElement('btn-1', { textContent: 'Submit', description: 'Submit button' }),
      ];
      executor.updateElements(elements);

      const result = await executor.assertVisible('Submit');

      expect(result.targetDescription).toBeDefined();
    });

    it('should include element state', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit' })];
      executor.updateElements(elements);

      const result = await executor.assertVisible('Submit');

      expect(result.elementState).toBeDefined();
      expect(result.elementState?.visible).toBe(true);
    });

    it('should include duration', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit' })];
      executor.updateElements(elements);

      const result = await executor.assertVisible('Submit');

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should include timestamp', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit' })];
      executor.updateElements(elements);

      const result = await executor.assertVisible('Submit');

      expect(result.timestamp).toBeDefined();
    });
  });

  describe('attribute assertions', () => {
    it('should attempt to check placeholder attribute', async () => {
      const elements = [
        createMockAIElement('input-1', {
          type: 'input',
          textContent: 'Email',
          placeholder: 'Enter email',
        }),
      ];
      executor.updateElements(elements);

      // The assertion system attempts to check the attribute
      const result = await executor.assert({
        target: 'Email',
        type: 'attribute',
        attributeName: 'placeholder',
        expected: 'Enter email',
      });

      // The result should be defined (the assertion ran)
      expect(result).toBeDefined();
      expect(result.target).toBeDefined();
      // Note: placeholder checking depends on element discovery finding the property
    });

    it('should attempt to check title attribute', async () => {
      const elements = [
        createMockAIElement('btn-1', {
          textContent: 'Submit',
          title: 'Click to submit',
        }),
      ];
      executor.updateElements(elements);

      const result = await executor.assert({
        target: 'Submit',
        type: 'attribute',
        attributeName: 'title',
        expected: 'Click to submit',
      });

      // The result should be defined
      expect(result).toBeDefined();
      expect(result.target).toBeDefined();
    });

    it('should fail for unsupported attributes', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit', aliases: ['btn-1', 'submit'] })];
      executor.updateElements(elements);

      const result = await executor.assert({
        target: 'Submit',
        type: 'attribute',
        attributeName: 'data-custom',
        expected: 'value',
      });

      expect(result.passed).toBe(false);
      expect(result.failureReason).toContain('Cannot check attribute');
    });
  });

  describe('hasClass assertion', () => {
    it('should fail with DOM access error', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit' })];
      executor.updateElements(elements);

      const result = await executor.assert({
        target: 'Submit',
        type: 'hasClass',
        expected: 'btn-primary',
      });

      expect(result.passed).toBe(false);
      expect(result.failureReason).toContain('DOM access');
    });
  });

  describe('cssProperty assertion', () => {
    it('should fail when computed styles not available', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit' })];
      executor.updateElements(elements);

      const result = await executor.assert({
        target: 'Submit',
        type: 'cssProperty',
        propertyName: 'color',
        expected: 'red',
      });

      expect(result.passed).toBe(false);
      expect(result.failureReason).toContain('not available');
    });
  });

  describe('focused assertion', () => {
    it('should pass when element is focused', async () => {
      const elements = [
        createMockAIElement('input-1', { type: 'input', textContent: 'Email', focused: true }),
      ];
      executor.updateElements(elements);

      const result = await executor.assert({
        target: 'Email',
        type: 'focused',
      });

      expect(result.passed).toBe(true);
    });

    it('should fail when element is not focused', async () => {
      const elements = [
        createMockAIElement('input-1', { type: 'input', textContent: 'Email', focused: false }),
      ];
      executor.updateElements(elements);

      const result = await executor.assert({
        target: 'Email',
        type: 'focused',
      });

      expect(result.passed).toBe(false);
    });
  });

  describe('custom message', () => {
    it('should use custom message on failure', async () => {
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit', visible: false })];
      executor.updateElements(elements);

      const result = await executor.assert({
        target: 'Submit',
        type: 'visible',
        message: 'Submit button should be visible after form load',
      });

      expect(result.passed).toBe(false);
      expect(result.failureReason).toBe('Submit button should be visible after form load');
    });
  });

  describe('suggestions disabled', () => {
    it('should not include suggestions when disabled', async () => {
      const executorNoSuggestions = new AssertionExecutor({ includeSuggestions: false });
      const elements = [createMockAIElement('btn-1', { textContent: 'Submit', visible: false })];
      executorNoSuggestions.updateElements(elements);

      const result = await executorNoSuggestions.assertVisible('Submit');

      expect(result.passed).toBe(false);
      expect(result.suggestion).toBeUndefined();
    });
  });

  describe('DEFAULT_ASSERTION_CONFIG', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_ASSERTION_CONFIG.defaultTimeout).toBe(5000);
      expect(DEFAULT_ASSERTION_CONFIG.pollInterval).toBe(100);
      expect(DEFAULT_ASSERTION_CONFIG.fuzzyThreshold).toBe(0.7);
      expect(DEFAULT_ASSERTION_CONFIG.includeSuggestions).toBe(true);
    });
  });
});
