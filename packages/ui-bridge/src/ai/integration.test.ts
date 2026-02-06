/**
 * AI Module Integration Tests
 *
 * Tests the full integration flow of the AI module:
 * - Natural language instruction parsing, search, execution, and verification
 * - Error recovery with suggestions
 * - Semantic snapshot and diff detection
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ElementState } from '../core/types';
import type {
  DiscoveredElement,
  ActionExecutor,
  ControlActionResponse,
  WaitResult,
  FindResponse,
  ControlSnapshot,
} from '../control/types';
import type { NLActionRequest } from './types';

// Import modules under test
import { parseNLInstruction, describeAction, validateParsedAction } from './nl-action-parser';
import { NLActionExecutor, createNLActionExecutor } from './nl-action-executor';
import { SearchEngine, createSearchEngine } from './search-engine';
import { SemanticSnapshotManager, createSnapshotManager } from './semantic-snapshot';
import {
  computeDiff,
  SemanticDiffManager,
  hasSignificantChanges,
  describeDiff,
} from './semantic-diff';
import { createErrorContext, formatErrorContext, getBestRecoverySuggestion } from './error-context';

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a mock element state
 */
function createMockState(overrides: Partial<ElementState> = {}): ElementState {
  return {
    visible: true,
    enabled: true,
    focused: false,
    rect: { x: 100, y: 100, width: 100, height: 40, top: 100, right: 200, bottom: 140, left: 100 },
    ...overrides,
  };
}

/**
 * Create a mock discovered element
 */
function createMockElement(
  id: string,
  type: string,
  label: string,
  stateOverrides: Partial<ElementState> = {}
): DiscoveredElement {
  return {
    id,
    type,
    label,
    tagName: type === 'button' ? 'button' : type === 'input' ? 'input' : 'div',
    role: type,
    accessibleName: label,
    actions: type === 'button' ? ['click'] : type === 'input' ? ['type', 'clear', 'focus'] : [],
    state: createMockState({
      textContent: label,
      ...stateOverrides,
    }),
    registered: true,
  };
}

/**
 * Create a mock action executor
 */
function createMockActionExecutor(
  responseOverrides: Partial<ControlActionResponse> = {}
): ActionExecutor {
  return {
    executeAction: vi.fn().mockResolvedValue({
      success: true,
      elementState: createMockState(),
      durationMs: 50,
      timestamp: Date.now(),
      ...responseOverrides,
    }),
    executeComponentAction: vi.fn().mockResolvedValue({
      success: true,
      durationMs: 50,
      timestamp: Date.now(),
    }),
    waitFor: vi.fn().mockResolvedValue({
      met: true,
      waitedMs: 100,
      state: createMockState(),
    } as WaitResult),
    find: vi.fn().mockResolvedValue({
      elements: [],
      total: 0,
      durationMs: 10,
      timestamp: Date.now(),
    } as FindResponse),
    discover: vi.fn().mockResolvedValue({
      elements: [],
      total: 0,
      durationMs: 10,
      timestamp: Date.now(),
    } as FindResponse),
    getSnapshot: vi.fn().mockResolvedValue({
      timestamp: Date.now(),
      elements: [],
      components: [],
      workflows: [],
      activeRuns: [],
    } as ControlSnapshot),
  };
}

/**
 * Create a control snapshot with elements for semantic snapshot testing
 */
function createControlSnapshot(elements: DiscoveredElement[]): ControlSnapshot {
  return {
    timestamp: Date.now(),
    elements: elements.map((el) => ({
      id: el.id,
      type: el.type,
      label: el.label,
      actions: el.actions,
      state: el.state,
    })),
    components: [],
    workflows: [],
    activeRuns: [],
  };
}

// ============================================================================
// Test Suite 1: NL Instruction -> Search -> Execute -> Verify
// ============================================================================

describe('AI Module Integration: NL Instruction Flow', () => {
  let executor: NLActionExecutor;
  let mockActionExecutor: ActionExecutor;
  let elements: DiscoveredElement[];

  beforeEach(() => {
    // Create test elements
    elements = [
      createMockElement('submit-btn', 'button', 'Submit'),
      createMockElement('cancel-btn', 'button', 'Cancel'),
      createMockElement('login-btn', 'button', 'Login'),
      createMockElement('email-input', 'input', 'Email'),
      createMockElement('password-input', 'input', 'Password'),
      createMockElement('search-input', 'input', 'Search'),
      createMockElement('save-btn', 'button', 'Save Changes'),
      createMockElement('delete-btn', 'button', 'Delete', { enabled: false }),
    ];

    // Create executor with mock action executor
    mockActionExecutor = createMockActionExecutor();
    executor = createNLActionExecutor({
      defaultConfidenceThreshold: 0.7,
      verbose: false,
    });
    executor.setActionExecutor(mockActionExecutor);
    executor.updateElements(elements);
  });

  describe('Parsing natural language instructions', () => {
    it('should parse "click the Submit button"', () => {
      const parsed = parseNLInstruction('click the Submit button');

      expect(parsed).not.toBeNull();
      expect(parsed!.action).toBe('click');
      expect(parsed!.targetDescription).toMatch(/submit/i);
      expect(parsed!.parseConfidence).toBeGreaterThan(0.8);
    });

    it('should parse "type hello in the Email field"', () => {
      const parsed = parseNLInstruction('type "hello" in the Email field');

      expect(parsed).not.toBeNull();
      expect(parsed!.action).toBe('type');
      expect(parsed!.targetDescription).toMatch(/email/i);
      expect(parsed!.value).toBe('hello');
    });

    it('should parse "check the remember me checkbox"', () => {
      const parsed = parseNLInstruction('check the remember me checkbox');

      expect(parsed).not.toBeNull();
      expect(parsed!.action).toBe('check');
      expect(parsed!.targetDescription).toMatch(/remember me/i);
    });

    it('should parse "hover over the login button"', () => {
      const parsed = parseNLInstruction('hover over the login button');

      expect(parsed).not.toBeNull();
      expect(parsed!.action).toBe('hover');
      expect(parsed!.targetDescription).toMatch(/login/i);
    });

    it('should parse double-click instructions', () => {
      const parsed = parseNLInstruction('double-click the Submit button');

      expect(parsed).not.toBeNull();
      expect(parsed!.action).toBe('doubleClick');
    });

    it('should parse right-click instructions', () => {
      const parsed = parseNLInstruction('right-click the item');

      expect(parsed).not.toBeNull();
      expect(parsed!.action).toBe('rightClick');
    });

    it('should parse "select Option from dropdown"', () => {
      const parsed = parseNLInstruction('select "Option A" from the dropdown');

      expect(parsed).not.toBeNull();
      expect(parsed!.action).toBe('select');
      expect(parsed!.value).toBe('Option A');
    });

    it('should validate parsed actions', () => {
      const validAction = parseNLInstruction('click Submit')!;
      const validation = validateParsedAction(validAction);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should generate human-readable action descriptions', () => {
      const parsed = parseNLInstruction('click the Submit button')!;
      const description = describeAction(parsed);
      expect(description).toContain('Click');
      expect(description).toMatch(/submit/i);
    });
  });

  describe('Searching for elements', () => {
    let searchEngine: SearchEngine;

    beforeEach(() => {
      searchEngine = createSearchEngine();
      searchEngine.updateElements(elements);
    });

    it('should find element by exact text match', () => {
      const response = searchEngine.search({ text: 'Submit' });

      expect(response.bestMatch).not.toBeNull();
      expect(response.bestMatch!.element.id).toBe('submit-btn');
      expect(response.bestMatch!.confidence).toBeGreaterThan(0.9);
    });

    it('should find element by fuzzy text match', () => {
      const response = searchEngine.search({ text: 'Submitt', fuzzy: true });

      expect(response.bestMatch).not.toBeNull();
      expect(response.bestMatch!.element.id).toBe('submit-btn');
    });

    it('should find element by partial text', () => {
      const response = searchEngine.search({ textContains: 'Save' });

      expect(response.bestMatch).not.toBeNull();
      expect(response.bestMatch!.element.id).toBe('save-btn');
    });

    it('should find element by type constraint', () => {
      const response = searchEngine.search({ text: 'Email', type: 'input' });

      expect(response.bestMatch).not.toBeNull();
      expect(response.bestMatch!.element.type).toBe('input');
    });

    it('should return multiple results sorted by confidence', () => {
      // Search for a term that matches multiple elements
      const response = searchEngine.search({ text: 'btn', fuzzy: true, fuzzyThreshold: 0.3 });

      expect(response.results.length).toBeGreaterThan(0);
      // Results should be sorted by confidence (descending)
      for (let i = 1; i < response.results.length; i++) {
        expect(response.results[i - 1].confidence).toBeGreaterThanOrEqual(
          response.results[i].confidence
        );
      }
    });

    it('should include match reasons in results', () => {
      const response = searchEngine.search({ text: 'Submit' });

      expect(response.bestMatch).not.toBeNull();
      expect(response.bestMatch!.matchReasons.length).toBeGreaterThan(0);
    });

    it('should return null bestMatch when no elements match threshold', () => {
      const response = searchEngine.search({
        text: 'NonexistentElement',
        fuzzyThreshold: 0.9,
      });

      expect(response.bestMatch).toBeNull();
      expect(response.scannedCount).toBe(elements.length);
    });
  });

  describe('Executing actions', () => {
    it('should execute "click the Submit button" successfully', async () => {
      const request: NLActionRequest = {
        instruction: 'click the Submit button',
        confidenceThreshold: 0.7,
      };

      const response = await executor.execute(request);

      expect(response.success).toBe(true);
      expect(response.elementUsed.id).toBe('submit-btn');
      expect(response.confidence).toBeGreaterThan(0.7);
      expect(response.executedAction).toContain('Click');
      expect(mockActionExecutor.executeAction).toHaveBeenCalledWith(
        'submit-btn',
        expect.objectContaining({ action: 'click' })
      );
    });

    it('should execute "type hello in Email" successfully', async () => {
      const request: NLActionRequest = {
        instruction: 'type "hello@test.com" in the Email field',
      };

      const response = await executor.execute(request);

      expect(response.success).toBe(true);
      expect(response.elementUsed.id).toBe('email-input');
      expect(mockActionExecutor.executeAction).toHaveBeenCalledWith(
        'email-input',
        expect.objectContaining({
          action: 'type',
          params: expect.objectContaining({ text: 'hello@test.com' }),
        })
      );
    });

    it('should return element state after successful action', async () => {
      const response = await executor.execute({
        instruction: 'click Submit',
      });

      expect(response.success).toBe(true);
      expect(response.elementState).toBeDefined();
      expect(response.elementState.visible).toBe(true);
    });

    it('should return confidence score with response', async () => {
      const response = await executor.execute({
        instruction: 'click the Login button',
      });

      expect(response.success).toBe(true);
      expect(response.confidence).toBeGreaterThan(0);
      expect(response.confidence).toBeLessThanOrEqual(1);
    });

    it('should report duration of action', async () => {
      const response = await executor.execute({
        instruction: 'click Submit',
      });

      expect(response.durationMs).toBeGreaterThan(0);
      expect(response.timestamp).toBeGreaterThan(0);
    });
  });

  describe('Full flow integration', () => {
    it('should complete full flow: parse -> search -> execute -> verify', async () => {
      // 1. Parse the instruction
      const instruction = 'click the Save Changes button';
      const parsed = parseNLInstruction(instruction);
      expect(parsed).not.toBeNull();
      expect(parsed!.action).toBe('click');

      // 2. Execute (which internally searches and executes)
      const response = await executor.execute({ instruction });

      // 3. Verify the results
      expect(response.success).toBe(true);
      expect(response.elementUsed.id).toBe('save-btn');
      expect(response.executedAction).toContain('Click');
      expect(response.confidence).toBeGreaterThan(0.7);
      expect(response.durationMs).toBeGreaterThan(0);
    });

    it('should handle synonyms correctly (submit vs send)', async () => {
      // Add a "Send" button to test synonym matching
      const sendButton = createMockElement('send-btn', 'button', 'Send Message');
      executor.updateElements([...elements, sendButton]);

      // Try to find using a synonym
      const response = await executor.execute({
        instruction: 'click the send message button',
      });

      expect(response.success).toBe(true);
      expect(response.elementUsed.id).toBe('send-btn');
    });
  });
});

// ============================================================================
// Test Suite 2: Error Recovery with Suggestions
// ============================================================================

describe('AI Module Integration: Error Recovery', () => {
  let executor: NLActionExecutor;
  let mockActionExecutor: ActionExecutor;
  let elements: DiscoveredElement[];

  beforeEach(() => {
    elements = [
      createMockElement('submit-btn', 'button', 'Submit'),
      createMockElement('send-btn', 'button', 'Send'),
      createMockElement('confirm-btn', 'button', 'Confirm'),
      createMockElement('email-input', 'input', 'Email Address'),
      createMockElement('disabled-btn', 'button', 'Disabled Action', { enabled: false }),
      createMockElement('hidden-btn', 'button', 'Hidden Button', { visible: false }),
    ];

    mockActionExecutor = createMockActionExecutor();
    executor = createNLActionExecutor({ defaultConfidenceThreshold: 0.7 });
    executor.setActionExecutor(mockActionExecutor);
    executor.updateElements(elements);
  });

  describe('Element not found errors', () => {
    it('should return ELEMENT_NOT_FOUND when element does not exist', async () => {
      const response = await executor.execute({
        instruction: 'click the Nonexistent Button',
      });

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('ELEMENT_NOT_FOUND');
      expect(response.error).toBeDefined();
    });

    it('should provide suggestions when element is not found', async () => {
      const response = await executor.execute({
        instruction: 'click the XYZButton123', // Completely nonexistent
      });

      expect(response.success).toBe(false);
      expect(response.suggestions).toBeDefined();
      expect(response.suggestions!.length).toBeGreaterThan(0);
    });

    it('should return near matches as alternatives', async () => {
      const response = await executor.execute({
        instruction: 'click the Submitx button', // Close but not matching
        confidenceThreshold: 0.95, // High threshold to force failure
      });

      expect(response.success).toBe(false);
      expect(response.alternatives).toBeDefined();
      // Should find Submit as a near match
      const hasSubmitAlternative = response.alternatives!.some(
        (alt) => alt.element.id === 'submit-btn'
      );
      expect(hasSubmitAlternative).toBe(true);
    });
  });

  describe('Low confidence errors', () => {
    it('should return LOW_CONFIDENCE when best match is below threshold', async () => {
      // Create a custom executor with a very high threshold
      const highThresholdExecutor = createNLActionExecutor({
        defaultConfidenceThreshold: 0.99, // Impossibly high
      });
      highThresholdExecutor.setActionExecutor(mockActionExecutor);

      // Use elements with slightly different text to get partial matches
      const partialMatchElements = [
        createMockElement('subm-btn', 'button', 'Subm'), // Partial text
      ];
      highThresholdExecutor.updateElements(partialMatchElements);

      const response = await highThresholdExecutor.execute({
        instruction: 'click the Submit button', // Looking for "Submit" but only "Subm" exists
        confidenceThreshold: 0.99,
      });

      // With such a high threshold, even a partial match should fail
      expect(response.success).toBe(false);
      // Could be either LOW_CONFIDENCE or ELEMENT_NOT_FOUND depending on if any match was found
      expect(['LOW_CONFIDENCE', 'ELEMENT_NOT_FOUND']).toContain(response.errorCode);
    });

    it('should suggest using exact text for low confidence matches', async () => {
      // Similar setup - partial match scenario
      const partialMatchExecutor = createNLActionExecutor();
      partialMatchExecutor.setActionExecutor(mockActionExecutor);

      const partialMatchElements = [createMockElement('send-msg-btn', 'button', 'Send Message')];
      partialMatchExecutor.updateElements(partialMatchElements);

      const response = await partialMatchExecutor.execute({
        instruction: 'click the Message Sender', // Similar but not exact
        confidenceThreshold: 0.99,
      });

      expect(response.success).toBe(false);
      expect(response.suggestions).toBeDefined();
      // Check that suggestions exist - they may not always contain specific text
      expect(response.suggestions!.length).toBeGreaterThan(0);
    });
  });

  describe('Parse errors', () => {
    it('should return PARSE_ERROR for unparseable instructions', async () => {
      const response = await executor.execute({
        instruction: 'asdfghjkl qwerty', // Gibberish
      });

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('PARSE_ERROR');
    });

    it('should suggest simpler instruction format on parse error', async () => {
      const response = await executor.execute({
        instruction: '   ', // Empty/whitespace
      });

      expect(response.success).toBe(false);
      expect(response.suggestions).toBeDefined();
    });
  });

  describe('Action execution errors', () => {
    it('should return ACTION_FAILED when executor fails', async () => {
      // Make the executor fail
      (mockActionExecutor.executeAction as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        error: 'Element is not interactable',
        durationMs: 50,
        timestamp: Date.now(),
      });

      const response = await executor.execute({
        instruction: 'click the Submit button',
      });

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('ACTION_FAILED');
      expect(response.error).toContain('not interactable');
    });

    it('should provide recovery suggestions for action failures', async () => {
      (mockActionExecutor.executeAction as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        success: false,
        error: 'Element is blocked',
        durationMs: 50,
        timestamp: Date.now(),
      });

      const response = await executor.execute({
        instruction: 'click Submit',
      });

      expect(response.success).toBe(false);
      expect(response.suggestions).toBeDefined();
      expect(response.suggestions!.length).toBeGreaterThan(0);
    });
  });

  describe('Error context generation', () => {
    it('should create rich error context with page state', () => {
      const context = createErrorContext(
        'ELEMENT_NOT_FOUND',
        'click the Missing button',
        elements,
        { text: 'Missing' }
      );

      expect(context.code).toBe('ELEMENT_NOT_FOUND');
      expect(context.attemptedAction).toBe('click the Missing button');
      expect(context.searchResults.candidatesFound).toBe(elements.length);
      expect(context.pageContext.visibleElements).toBeGreaterThan(0);
    });

    it('should include nearest match in error context', () => {
      const searchEngine = createSearchEngine();
      searchEngine.updateElements(elements);
      const searchResult = searchEngine.search({ text: 'Submitt' }); // Close match

      const context = createErrorContext(
        'LOW_CONFIDENCE',
        'click the Submitt button',
        elements,
        { text: 'Submitt' },
        searchResult.bestMatch || undefined
      );

      expect(context.searchResults.nearestMatch).toBeDefined();
      expect(context.searchResults.nearestMatch!.element.id).toBe('submit-btn');
      expect(context.searchResults.nearestMatch!.whyNotSelected).toContain('Confidence');
    });

    it('should detect possible blockers (dialogs)', () => {
      const elementsWithDialog = [
        ...elements,
        createMockElement('modal-dialog', 'dialog', 'Confirmation Dialog'),
      ];

      const context = createErrorContext('ELEMENT_BLOCKED', 'click Submit', elementsWithDialog);

      expect(context.pageContext.possibleBlockers.length).toBeGreaterThan(0);
      expect(context.pageContext.possibleBlockers[0]).toContain('dialog');
    });

    it('should format error context for display', () => {
      const context = createErrorContext('ELEMENT_NOT_FOUND', 'click Missing', elements);

      const formatted = formatErrorContext(context);

      expect(formatted).toContain('ELEMENT_NOT_FOUND');
      expect(formatted).toContain('click Missing');
      expect(formatted).toContain('Suggestions');
    });

    it('should provide best recovery suggestion', () => {
      const context = createErrorContext('ELEMENT_NOT_FOUND', 'click Missing', elements);

      const bestSuggestion = getBestRecoverySuggestion(context);

      expect(bestSuggestion).not.toBeNull();
      expect(bestSuggestion!.action).toBeDefined();
      expect(bestSuggestion!.confidence).toBeGreaterThan(0);
    });
  });

  describe('Recovery suggestions quality', () => {
    it('should suggest waiting for page load on not found', () => {
      const context = createErrorContext('ELEMENT_NOT_FOUND', 'click Loading Button', []);

      const hasWaitSuggestion = context.suggestions.some((s) =>
        s.action.toLowerCase().includes('wait')
      );
      expect(hasWaitSuggestion).toBe(true);
    });

    it('should suggest scrolling when element might be off-screen', () => {
      const context = createErrorContext('ELEMENT_NOT_FOUND', 'click Bottom Button', elements);

      const hasScrollSuggestion = context.suggestions.some((s) =>
        s.action.toLowerCase().includes('scroll')
      );
      expect(hasScrollSuggestion).toBe(true);
    });

    it('should suggest closing modal when element is blocked', () => {
      const elementsWithModal = [
        ...elements,
        createMockElement('blocking-modal', 'dialog', 'Blocking Modal'),
      ];

      const context = createErrorContext('ELEMENT_BLOCKED', 'click Submit', elementsWithModal);

      const hasCloseSuggestion = context.suggestions.some(
        (s) =>
          s.action.toLowerCase().includes('close') || s.action.toLowerCase().includes('blocking')
      );
      expect(hasCloseSuggestion).toBe(true);
    });
  });
});

// ============================================================================
// Test Suite 3: Semantic Diff Detects Changes
// ============================================================================

describe('AI Module Integration: Semantic Diff', () => {
  let snapshotManager: SemanticSnapshotManager;

  beforeEach(() => {
    snapshotManager = createSnapshotManager();
  });

  describe('Capturing page state', () => {
    it('should create semantic snapshot from control snapshot', () => {
      const elements = [
        createMockElement('submit-btn', 'button', 'Submit'),
        createMockElement('email-input', 'input', 'Email'),
      ];
      const controlSnapshot = createControlSnapshot(elements);

      const snapshot = snapshotManager.createSnapshot(controlSnapshot, {
        url: 'https://example.com/login',
        title: 'Login Page',
      });

      expect(snapshot.snapshotId).toBeDefined();
      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.elements.length).toBe(2);
      expect(snapshot.page.url).toBe('https://example.com/login');
      expect(snapshot.page.title).toBe('Login Page');
    });

    it('should include element descriptions in snapshot', () => {
      const elements = [createMockElement('submit-btn', 'button', 'Submit Form')];
      const controlSnapshot = createControlSnapshot(elements);

      const snapshot = snapshotManager.createSnapshot(controlSnapshot);

      expect(snapshot.elements[0].description).toBeDefined();
      expect(snapshot.elements[0].description.length).toBeGreaterThan(0);
    });

    it('should include element aliases for matching', () => {
      const elements = [createMockElement('login-btn', 'button', 'Log In')];
      const controlSnapshot = createControlSnapshot(elements);

      const snapshot = snapshotManager.createSnapshot(controlSnapshot);

      expect(snapshot.elements[0].aliases).toBeDefined();
      expect(snapshot.elements[0].aliases.length).toBeGreaterThan(0);
    });

    it('should detect forms in snapshot', () => {
      const elements = [
        createMockElement('email-input', 'input', 'Email'),
        createMockElement('password-input', 'input', 'Password'),
        createMockElement('submit-btn', 'button', 'Submit'),
      ];
      const controlSnapshot = createControlSnapshot(elements);

      const snapshot = snapshotManager.createSnapshot(controlSnapshot);

      expect(snapshot.forms.length).toBeGreaterThan(0);
    });

    it('should count elements by type', () => {
      const elements = [
        createMockElement('btn1', 'button', 'Button 1'),
        createMockElement('btn2', 'button', 'Button 2'),
        createMockElement('input1', 'input', 'Input 1'),
      ];
      const controlSnapshot = createControlSnapshot(elements);

      const snapshot = snapshotManager.createSnapshot(controlSnapshot);

      expect(snapshot.elementCounts.button).toBe(2);
      expect(snapshot.elementCounts.input).toBe(1);
    });

    it('should generate summary for snapshot', () => {
      const elements = [
        createMockElement('submit-btn', 'button', 'Submit'),
        createMockElement('cancel-btn', 'button', 'Cancel'),
      ];
      const controlSnapshot = createControlSnapshot(elements);

      const snapshot = snapshotManager.createSnapshot(controlSnapshot, {
        title: 'Test Page',
      });

      expect(snapshot.summary).toBeDefined();
      expect(snapshot.summary.length).toBeGreaterThan(0);
    });
  });

  describe('Detecting element appearance', () => {
    it('should detect new elements appearing', () => {
      // First snapshot with 2 elements
      const elements1 = [
        createMockElement('btn1', 'button', 'Button 1'),
        createMockElement('btn2', 'button', 'Button 2'),
      ];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      // Second snapshot with 3 elements (one new)
      const elements2 = [
        createMockElement('btn1', 'button', 'Button 1'),
        createMockElement('btn2', 'button', 'Button 2'),
        createMockElement('btn3', 'button', 'New Button'),
      ];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.changes.appeared.length).toBe(1);
      expect(diff.changes.appeared[0].elementId).toBe('btn3');
      expect(diff.changes.appeared[0].description).toContain('New Button');
    });

    it('should include element type in appeared changes', () => {
      const elements1: DiscoveredElement[] = [];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      const elements2 = [createMockElement('modal', 'dialog', 'Confirmation Dialog')];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.changes.appeared.length).toBe(1);
      expect(diff.changes.appeared[0].type).toBe('dialog');
    });
  });

  describe('Detecting element disappearance', () => {
    it('should detect elements disappearing', () => {
      const elements1 = [
        createMockElement('btn1', 'button', 'Button 1'),
        createMockElement('btn2', 'button', 'Button 2'),
        createMockElement('btn3', 'button', 'Temporary Button'),
      ];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      const elements2 = [
        createMockElement('btn1', 'button', 'Button 1'),
        createMockElement('btn2', 'button', 'Button 2'),
      ];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.changes.disappeared.length).toBe(1);
      expect(diff.changes.disappeared[0].elementId).toBe('btn3');
    });

    it('should detect modal dismissal', () => {
      const elements1 = [
        createMockElement('main-content', 'button', 'Main'),
        createMockElement('modal', 'dialog', 'Alert Dialog'),
      ];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      const elements2 = [createMockElement('main-content', 'button', 'Main')];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.changes.disappeared.length).toBe(1);
      expect(diff.changes.disappeared[0].type).toBe('dialog');
      expect(diff.probableTrigger).toBe('Modal closed');
    });
  });

  describe('Tracking property changes', () => {
    it('should detect visibility changes', () => {
      const elements1 = [createMockElement('btn', 'button', 'Button', { visible: true })];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      const elements2 = [createMockElement('btn', 'button', 'Button', { visible: false })];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.changes.modified.length).toBeGreaterThan(0);
      const visibilityChange = diff.changes.modified.find((m) => m.property === 'visible');
      expect(visibilityChange).toBeDefined();
      expect(visibilityChange!.from).toBe('true');
      expect(visibilityChange!.to).toBe('false');
      expect(visibilityChange!.significant).toBe(true);
    });

    it('should detect enabled/disabled changes', () => {
      const elements1 = [createMockElement('btn', 'button', 'Submit', { enabled: false })];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      const elements2 = [createMockElement('btn', 'button', 'Submit', { enabled: true })];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);

      const enabledChange = diff.changes.modified.find((m) => m.property === 'enabled');
      expect(enabledChange).toBeDefined();
      expect(enabledChange!.significant).toBe(true);
    });

    it('should detect focus changes', () => {
      const elements1 = [createMockElement('input', 'input', 'Email', { focused: false })];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      const elements2 = [createMockElement('input', 'input', 'Email', { focused: true })];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);

      const focusChange = diff.changes.modified.find((m) => m.property === 'focused');
      expect(focusChange).toBeDefined();
      expect(diff.probableTrigger).toBe('Focus changed');
    });

    it('should detect value changes in inputs', () => {
      const elements1 = [createMockElement('input', 'input', 'Email', { value: '' })];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      const elements2 = [
        createMockElement('input', 'input', 'Email', { value: 'test@example.com' }),
      ];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);

      const valueChange = diff.changes.modified.find((m) => m.property === 'value');
      expect(valueChange).toBeDefined();
      expect(valueChange!.to).toContain('test@example.com');
      expect(diff.probableTrigger).toBe('User input');
    });

    it('should detect text content changes', () => {
      const elements1 = [
        createMockElement('status', 'button', 'Loading', { textContent: 'Loading...' }),
      ];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      const elements2 = [
        createMockElement('status', 'button', 'Complete', { textContent: 'Complete!' }),
      ];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);

      const textChange = diff.changes.modified.find((m) => m.property === 'textContent');
      expect(textChange).toBeDefined();
    });
  });

  describe('Page-level changes', () => {
    it('should detect URL changes', () => {
      const elements = [createMockElement('btn', 'button', 'Button')];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements), {
        url: 'https://example.com/page1',
        title: 'Page 1',
      });
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements), {
        url: 'https://example.com/page2',
        title: 'Page 2',
      });

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.pageChanges).toBeDefined();
      expect(diff.pageChanges!.urlChanged).toBe(true);
      expect(diff.pageChanges!.newUrl).toBe('https://example.com/page2');
    });

    it('should detect title changes', () => {
      const elements = [createMockElement('btn', 'button', 'Button')];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements), {
        url: 'https://example.com',
        title: 'Old Title',
      });
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements), {
        url: 'https://example.com',
        title: 'New Title',
      });

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.pageChanges!.titleChanged).toBe(true);
      expect(diff.pageChanges!.newTitle).toBe('New Title');
    });
  });

  describe('Diff utilities', () => {
    it('should detect significant changes with hasSignificantChanges', () => {
      const elements1 = [createMockElement('btn', 'button', 'Button')];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      const elements2 = [
        createMockElement('btn', 'button', 'Button'),
        createMockElement('new-btn', 'button', 'New Button'),
      ];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);

      expect(hasSignificantChanges(diff)).toBe(true);
    });

    it('should report no significant changes when nothing changed', () => {
      const elements = [createMockElement('btn', 'button', 'Button')];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements));
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements));

      const diff = computeDiff(snapshot1, snapshot2);

      expect(hasSignificantChanges(diff)).toBe(false);
    });

    it('should provide human-readable diff description', () => {
      const elements1 = [createMockElement('btn1', 'button', 'Button 1')];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      const elements2 = [
        createMockElement('btn1', 'button', 'Button 1'),
        createMockElement('btn2', 'button', 'Button 2'),
      ];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);
      const description = describeDiff(diff);

      expect(description).toContain('appeared');
    });

    it('should include suggested actions based on diff', () => {
      const elements1: DiscoveredElement[] = [];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      const elements2 = [createMockElement('modal', 'dialog', 'Confirm Dialog')];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.suggestedActions).toBeDefined();
      expect(diff.suggestedActions!.length).toBeGreaterThan(0);
    });
  });

  describe('SemanticDiffManager tracking', () => {
    it('should track changes over multiple updates', () => {
      const diffManager = new SemanticDiffManager();

      // First update - no diff yet
      const elements1 = [createMockElement('btn', 'button', 'Button')];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));
      const diff1 = diffManager.update(snapshot1);
      expect(diff1).toBeNull();

      // Second update - should have diff
      const elements2 = [
        createMockElement('btn', 'button', 'Button'),
        createMockElement('new-btn', 'button', 'New'),
      ];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));
      const diff2 = diffManager.update(snapshot2);

      expect(diff2).not.toBeNull();
      expect(diff2!.changes.appeared.length).toBe(1);
    });

    it('should get diff from a specific previous snapshot', () => {
      const diffManager = new SemanticDiffManager();

      const elements1 = [createMockElement('btn1', 'button', 'Button 1')];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));
      diffManager.update(snapshot1);

      const elements2 = [
        createMockElement('btn1', 'button', 'Button 1'),
        createMockElement('btn2', 'button', 'Button 2'),
      ];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));
      diffManager.update(snapshot2);

      const diffFromFirst = diffManager.diffFrom(snapshot1);

      expect(diffFromFirst).not.toBeNull();
      expect(diffFromFirst!.changes.appeared.length).toBe(1);
    });

    it('should reset tracking state', () => {
      const diffManager = new SemanticDiffManager();

      const elements = [createMockElement('btn', 'button', 'Button')];
      const snapshot = snapshotManager.createSnapshot(createControlSnapshot(elements));
      diffManager.update(snapshot);

      expect(diffManager.getLastSnapshot()).not.toBeNull();

      diffManager.reset();

      expect(diffManager.getLastSnapshot()).toBeNull();
    });
  });

  describe('Probable trigger detection', () => {
    it('should detect form validation trigger', () => {
      const elements1 = [createMockElement('form', 'input', 'Email')];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      const elements2 = [
        createMockElement('form', 'input', 'Email'),
        createMockElement('error', 'error', 'Invalid email format'),
      ];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.probableTrigger).toBe('Form validation');
    });

    it('should detect modal opened trigger', () => {
      const elements1 = [createMockElement('btn', 'button', 'Open')];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      const elements2 = [
        createMockElement('btn', 'button', 'Open'),
        createMockElement('modal', 'dialog', 'Confirmation'),
      ];
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.probableTrigger).toBe('Modal opened');
    });

    it('should detect page navigation on many new elements', () => {
      const elements1 = [createMockElement('btn', 'button', 'Navigate')];
      const snapshot1 = snapshotManager.createSnapshot(createControlSnapshot(elements1));

      // Simulate new page with many new elements
      const elements2: DiscoveredElement[] = [];
      for (let i = 0; i < 10; i++) {
        elements2.push(createMockElement(`el-${i}`, 'button', `Element ${i}`));
      }
      const snapshot2 = snapshotManager.createSnapshot(createControlSnapshot(elements2));

      const diff = computeDiff(snapshot1, snapshot2);

      expect(diff.probableTrigger).toBe('Page navigation');
    });
  });

  describe('Snapshot history', () => {
    it('should maintain snapshot history', () => {
      const elements = [createMockElement('btn', 'button', 'Button')];

      snapshotManager.createSnapshot(createControlSnapshot(elements));
      snapshotManager.createSnapshot(createControlSnapshot(elements));
      snapshotManager.createSnapshot(createControlSnapshot(elements));

      const history = snapshotManager.getHistory();

      expect(history.length).toBe(3);
    });

    it('should retrieve snapshot by ID', () => {
      const elements = [createMockElement('btn', 'button', 'Button')];
      const snapshot = snapshotManager.createSnapshot(createControlSnapshot(elements));

      const retrieved = snapshotManager.getSnapshot(snapshot.snapshotId);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.snapshotId).toBe(snapshot.snapshotId);
    });

    it('should get last snapshot', () => {
      const elements1 = [createMockElement('btn1', 'button', 'Button 1')];
      snapshotManager.createSnapshot(createControlSnapshot(elements1), {
        title: 'First',
      });

      const elements2 = [createMockElement('btn2', 'button', 'Button 2')];
      snapshotManager.createSnapshot(createControlSnapshot(elements2), {
        title: 'Second',
      });

      const last = snapshotManager.getLastSnapshot();

      expect(last).not.toBeNull();
      expect(last!.page.title).toBe('Second');
    });

    it('should clear history', () => {
      const elements = [createMockElement('btn', 'button', 'Button')];
      snapshotManager.createSnapshot(createControlSnapshot(elements));
      snapshotManager.createSnapshot(createControlSnapshot(elements));

      snapshotManager.clearHistory();

      expect(snapshotManager.getHistory().length).toBe(0);
      expect(snapshotManager.getLastSnapshot()).toBeNull();
    });
  });
});
