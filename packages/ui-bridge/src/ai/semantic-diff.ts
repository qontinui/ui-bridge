/**
 * Semantic Diff
 *
 * Tracks and describes semantic changes between snapshots
 * with LLM-friendly summaries and suggested actions.
 */

import type {
  SemanticSnapshot,
  SemanticDiff,
  ElementChange,
  ElementModification,
  AIDiscoveredElement,
} from './types';
import { generateDiffSummary } from './summary-generator';

/**
 * Configuration for semantic diff
 */
export interface SemanticDiffConfig {
  /** Ignore insignificant changes */
  ignoreInsignificant: boolean;
  /** Properties to track for modifications */
  trackedProperties: string[];
  /** Generate suggested actions */
  generateSuggestions: boolean;
  /** Maximum modifications to report */
  maxModifications: number;
}

/**
 * Default diff configuration
 */
export const DEFAULT_DIFF_CONFIG: SemanticDiffConfig = {
  ignoreInsignificant: true,
  trackedProperties: ['visible', 'enabled', 'focused', 'checked', 'value', 'textContent'],
  generateSuggestions: true,
  maxModifications: 20,
};

/**
 * Properties that are considered insignificant
 */
const INSIGNIFICANT_PROPERTIES = new Set(['rect', 'computedStyles', 'innerHTML']);

/**
 * Compute semantic diff between two snapshots
 */
export function computeDiff(
  fromSnapshot: SemanticSnapshot,
  toSnapshot: SemanticSnapshot,
  config: Partial<SemanticDiffConfig> = {}
): SemanticDiff {
  const startTime = performance.now();
  const finalConfig = { ...DEFAULT_DIFF_CONFIG, ...config };

  // Build element maps for comparison
  const fromElements = new Map(fromSnapshot.elements.map((el) => [el.id, el]));
  const toElements = new Map(toSnapshot.elements.map((el) => [el.id, el]));

  // Find appeared elements
  const appeared: ElementChange[] = [];
  for (const [id, element] of toElements) {
    if (!fromElements.has(id)) {
      appeared.push({
        elementId: id,
        description: element.description,
        type: element.type,
        semanticType: element.semanticType,
      });
    }
  }

  // Find disappeared elements
  const disappeared: ElementChange[] = [];
  for (const [id, element] of fromElements) {
    if (!toElements.has(id)) {
      disappeared.push({
        elementId: id,
        description: element.description,
        type: element.type,
        semanticType: element.semanticType,
      });
    }
  }

  // Find modified elements
  const modified: ElementModification[] = [];
  for (const [id, toElement] of toElements) {
    const fromElement = fromElements.get(id);
    if (fromElement) {
      const modifications = compareElements(fromElement, toElement, finalConfig);
      modified.push(...modifications);
    }
  }

  // Limit modifications
  const limitedModifications = modified.slice(0, finalConfig.maxModifications);

  // Detect probable trigger
  const probableTrigger = detectTrigger(appeared, disappeared, limitedModifications);

  // Generate suggested actions
  const suggestedActions = finalConfig.generateSuggestions
    ? generateSuggestedActionsFromDiff(appeared, disappeared, limitedModifications, probableTrigger)
    : undefined;

  // Detect page changes
  const pageChanges = detectPageChanges(fromSnapshot, toSnapshot);

  // Generate summary
  const summary = generateDiffSummary(
    appeared.map((e) => e.description),
    disappeared.map((e) => e.description),
    limitedModifications
  );

  return {
    summary,
    fromSnapshotId: fromSnapshot.snapshotId,
    toSnapshotId: toSnapshot.snapshotId,
    changes: {
      appeared,
      disappeared,
      modified: limitedModifications,
    },
    probableTrigger,
    suggestedActions,
    pageChanges,
    durationMs: performance.now() - startTime,
    timestamp: Date.now(),
  };
}

/**
 * Compare two elements and return modifications
 */
function compareElements(
  fromElement: AIDiscoveredElement,
  toElement: AIDiscoveredElement,
  config: SemanticDiffConfig
): ElementModification[] {
  const modifications: ElementModification[] = [];

  for (const property of config.trackedProperties) {
    const fromValue = getPropertyValue(fromElement, property);
    const toValue = getPropertyValue(toElement, property);

    if (fromValue !== toValue) {
      // Check significance
      const isSignificant = isSignificantChange(property, fromValue, toValue);

      if (!config.ignoreInsignificant || isSignificant) {
        modifications.push({
          elementId: toElement.id,
          description: toElement.description,
          property,
          from: formatValue(fromValue),
          to: formatValue(toValue),
          significant: isSignificant,
        });
      }
    }
  }

  return modifications;
}

/**
 * Get a property value from an element
 */
function getPropertyValue(element: AIDiscoveredElement, property: string): unknown {
  if (property in element.state) {
    return element.state[property as keyof typeof element.state];
  }
  return element[property as keyof AIDiscoveredElement];
}

/**
 * Check if a change is significant
 */
function isSignificantChange(property: string, fromValue: unknown, toValue: unknown): boolean {
  // Insignificant properties
  if (INSIGNIFICANT_PROPERTIES.has(property)) {
    return false;
  }

  // Visibility changes are always significant
  if (property === 'visible') {
    return true;
  }

  // Enabled state changes are significant
  if (property === 'enabled') {
    return true;
  }

  // Focus changes are significant
  if (property === 'focused') {
    return true;
  }

  // Checked state changes are significant
  if (property === 'checked') {
    return true;
  }

  // Value changes are significant if non-empty
  if (property === 'value') {
    return Boolean(fromValue) || Boolean(toValue);
  }

  // Text content changes are significant if substantial
  if (property === 'textContent') {
    const fromText = String(fromValue || '');
    const toText = String(toValue || '');
    // Significant if more than whitespace changes
    return fromText.trim() !== toText.trim();
  }

  return true;
}

/**
 * Format a value for display
 */
function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    // Truncate long strings
    if (value.length > 50) {
      return value.substring(0, 47) + '...';
    }
    return value;
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Detect the probable trigger for the changes
 */
function detectTrigger(
  appeared: ElementChange[],
  disappeared: ElementChange[],
  modified: ElementModification[]
): string | undefined {
  // Check for form validation
  const hasNewErrors = appeared.some(
    (e) => e.description.toLowerCase().includes('error') || e.type === 'error'
  );
  if (hasNewErrors) {
    return 'Form validation';
  }

  // Check for modal appearance
  const hasNewModal = appeared.some(
    (e) => e.type === 'dialog' || e.semanticType?.includes('dialog')
  );
  if (hasNewModal) {
    return 'Modal opened';
  }

  // Check for modal dismissal
  const hasModalDismissed = disappeared.some(
    (e) => e.type === 'dialog' || e.semanticType?.includes('dialog')
  );
  if (hasModalDismissed) {
    return 'Modal closed';
  }

  // Check for loading state
  const hasLoading = modified.some((m) => m.description.toLowerCase().includes('loading'));
  if (hasLoading) {
    return 'Loading state change';
  }

  // Check for focus change
  const hasFocusChange = modified.some((m) => m.property === 'focused');
  if (hasFocusChange && modified.length <= 2) {
    return 'Focus changed';
  }

  // Check for value change (user input)
  const hasValueChange = modified.some((m) => m.property === 'value');
  if (hasValueChange && modified.length <= 2) {
    return 'User input';
  }

  // Check for visibility changes (dropdown, accordion)
  const visibilityChanges = modified.filter((m) => m.property === 'visible');
  if (visibilityChanges.length > 0 && visibilityChanges.length <= 5) {
    return 'UI expansion/collapse';
  }

  // Multiple elements appeared (navigation)
  if (appeared.length > 5) {
    return 'Page navigation';
  }

  return undefined;
}

/**
 * Detect page-level changes
 */
function detectPageChanges(
  fromSnapshot: SemanticSnapshot,
  toSnapshot: SemanticSnapshot
): SemanticDiff['pageChanges'] | undefined {
  const urlChanged = fromSnapshot.page.url !== toSnapshot.page.url;
  const titleChanged = fromSnapshot.page.title !== toSnapshot.page.title;

  if (!urlChanged && !titleChanged) {
    return undefined;
  }

  return {
    urlChanged,
    titleChanged,
    newUrl: urlChanged ? toSnapshot.page.url : undefined,
    newTitle: titleChanged ? toSnapshot.page.title : undefined,
  };
}

/**
 * Generate suggested actions based on the diff
 */
function generateSuggestedActionsFromDiff(
  appeared: ElementChange[],
  disappeared: ElementChange[],
  modified: ElementModification[],
  trigger?: string
): string[] {
  const suggestions: string[] = [];

  // Suggestions based on trigger
  if (trigger === 'Form validation') {
    suggestions.push('Fix the validation errors before submitting');
  }

  if (trigger === 'Modal opened') {
    const modal = appeared.find(
      (e) => e.type === 'dialog' || e.semanticType?.includes('dialog')
    );
    if (modal) {
      suggestions.push(`Interact with the "${modal.description}" dialog`);
    }
  }

  if (trigger === 'Modal closed') {
    suggestions.push('Continue with the main page interaction');
  }

  // Suggestions based on appeared elements
  for (const element of appeared.slice(0, 3)) {
    if (element.type === 'button' && element.semanticType === 'submit-button') {
      suggestions.push(`Click the "${element.description}" to proceed`);
    }
    if (element.description.toLowerCase().includes('error')) {
      suggestions.push(`Address the error: ${element.description}`);
    }
  }

  // Suggestions based on modifications
  for (const mod of modified.slice(0, 3)) {
    if (mod.property === 'enabled' && mod.to === 'true') {
      suggestions.push(`"${mod.description}" is now enabled`);
    }
    if (mod.property === 'visible' && mod.to === 'true') {
      suggestions.push(`"${mod.description}" is now visible`);
    }
  }

  return suggestions.slice(0, 5);
}

/**
 * Create a diff manager for tracking changes over time
 */
export class SemanticDiffManager {
  private config: SemanticDiffConfig;
  private lastSnapshot: SemanticSnapshot | null = null;

  constructor(config: Partial<SemanticDiffConfig> = {}) {
    this.config = { ...DEFAULT_DIFF_CONFIG, ...config };
  }

  /**
   * Update with new snapshot and get diff
   */
  update(newSnapshot: SemanticSnapshot): SemanticDiff | null {
    if (!this.lastSnapshot) {
      this.lastSnapshot = newSnapshot;
      return null;
    }

    const diff = computeDiff(this.lastSnapshot, newSnapshot, this.config);
    this.lastSnapshot = newSnapshot;
    return diff;
  }

  /**
   * Get diff from a specific snapshot to current
   */
  diffFrom(fromSnapshot: SemanticSnapshot): SemanticDiff | null {
    if (!this.lastSnapshot) return null;
    return computeDiff(fromSnapshot, this.lastSnapshot, this.config);
  }

  /**
   * Reset the manager
   */
  reset(): void {
    this.lastSnapshot = null;
  }

  /**
   * Get the last known snapshot
   */
  getLastSnapshot(): SemanticSnapshot | null {
    return this.lastSnapshot;
  }
}

/**
 * Create a semantic diff manager
 */
export function createDiffManager(config?: Partial<SemanticDiffConfig>): SemanticDiffManager {
  return new SemanticDiffManager(config);
}

/**
 * Utility: Check if any significant changes occurred
 */
export function hasSignificantChanges(diff: SemanticDiff): boolean {
  if (diff.changes.appeared.length > 0) return true;
  if (diff.changes.disappeared.length > 0) return true;
  if (diff.changes.modified.some((m) => m.significant)) return true;
  if (diff.pageChanges?.urlChanged) return true;
  return false;
}

/**
 * Utility: Get a brief description of what changed
 */
export function describeDiff(diff: SemanticDiff): string {
  const parts: string[] = [];

  if (diff.changes.appeared.length > 0) {
    parts.push(`${diff.changes.appeared.length} elements appeared`);
  }

  if (diff.changes.disappeared.length > 0) {
    parts.push(`${diff.changes.disappeared.length} elements disappeared`);
  }

  const significantMods = diff.changes.modified.filter((m) => m.significant);
  if (significantMods.length > 0) {
    parts.push(`${significantMods.length} elements modified`);
  }

  if (diff.pageChanges?.urlChanged) {
    parts.push('URL changed');
  }

  if (parts.length === 0) {
    return 'No significant changes';
  }

  return parts.join(', ');
}
