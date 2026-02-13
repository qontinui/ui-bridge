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
  ContentChanges,
  TextChange,
  MetricChange,
  StatusChange,
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

  // Detect content changes
  const contentChanges = detectContentChanges(fromElements, toElements);

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
    contentChanges: contentChanges || undefined,
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
    const modal = appeared.find((e) => e.type === 'dialog' || e.semanticType?.includes('dialog'));
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
  if (diff.contentChanges) {
    const cc = diff.contentChanges;
    if (cc.textChanges.length > 0) return true;
    if (cc.metricChanges.some((m) => m.significant)) return true;
    if (cc.statusChanges.length > 0) return true;
  }
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

  if (diff.contentChanges) {
    parts.push(diff.contentChanges.summary);
  }

  if (parts.length === 0) {
    return 'No significant changes';
  }

  return parts.join(', ');
}

// ============================================================================
// Content Change Detection
// ============================================================================

/**
 * Content types that represent metric values
 */
const METRIC_CONTENT_TYPES = new Set(['metric-value']);

/**
 * Content types that represent status indicators
 */
const STATUS_CONTENT_TYPES = new Set(['status-message', 'badge']);

/**
 * Content types that represent headings
 */
const HEADING_CONTENT_TYPES = new Set(['heading']);

/**
 * Check if an element is a content element based on its category or contentMetadata
 */
function isContentElement(element: AIDiscoveredElement): boolean {
  return element.category === 'content' || element.contentMetadata !== undefined;
}

/**
 * Get the content type from an element's metadata or type field
 */
function getContentType(element: AIDiscoveredElement): string {
  if (element.contentMetadata?.contentRole) {
    return element.contentMetadata.contentRole;
  }
  // Fall back to element type for content elements
  return element.type;
}

/**
 * Detect content-specific changes between two snapshots
 */
function detectContentChanges(
  fromElements: Map<string, AIDiscoveredElement>,
  toElements: Map<string, AIDiscoveredElement>
): ContentChanges | null {
  const textChanges: TextChange[] = [];
  const metricChanges: MetricChange[] = [];
  const statusChanges: StatusChange[] = [];

  // Check content elements that exist in both snapshots (modified)
  for (const [id, toElement] of toElements) {
    const fromElement = fromElements.get(id);

    if (fromElement) {
      // Both exist - check for text content changes on content elements
      if (isContentElement(toElement) || isContentElement(fromElement)) {
        const fromText = (fromElement.state.textContent || '').trim();
        const toText = (toElement.state.textContent || '').trim();

        if (fromText !== toText) {
          const contentType = getContentType(toElement);
          const label = toElement.description || toElement.accessibleName || id;

          // Classify by content type
          if (METRIC_CONTENT_TYPES.has(contentType) || contentType === 'metric') {
            const parsed = parseMetricChange(fromText, toText, id, label);
            if (parsed) {
              metricChanges.push(parsed);
            }
          } else if (STATUS_CONTENT_TYPES.has(contentType) || contentType === 'status') {
            statusChanges.push({
              elementId: id,
              label,
              oldStatus: fromText,
              newStatus: toText,
              direction: classifyStatusDirection(fromText, toText),
            });
          } else {
            textChanges.push({
              elementId: id,
              contentType,
              oldText: fromText,
              newText: toText,
              changeType: 'modified',
            });
          }
        }
      }
    } else {
      // New content element appeared
      if (isContentElement(toElement)) {
        const toText = (toElement.state.textContent || '').trim();
        if (toText) {
          textChanges.push({
            elementId: id,
            contentType: getContentType(toElement),
            oldText: '',
            newText: toText,
            changeType: 'added',
          });
        }
      }
    }
  }

  // Check for content elements that disappeared
  for (const [id, fromElement] of fromElements) {
    if (!toElements.has(id) && isContentElement(fromElement)) {
      const fromText = (fromElement.state.textContent || '').trim();
      if (fromText) {
        textChanges.push({
          elementId: id,
          contentType: getContentType(fromElement),
          oldText: fromText,
          newText: '',
          changeType: 'removed',
        });
      }
    }
  }

  // If no content changes detected, return null
  if (textChanges.length === 0 && metricChanges.length === 0 && statusChanges.length === 0) {
    return null;
  }

  return {
    textChanges,
    metricChanges,
    statusChanges,
    summary: generateContentChangeSummary(textChanges, metricChanges, statusChanges),
  };
}

// ============================================================================
// Metric Value Parsing
// ============================================================================

/**
 * Parse a numeric value from a string, handling common formats:
 * - Plain numbers: "42", "1,234", "1234.56"
 * - Percentages: "95%", "12.5%"
 * - Currency: "$1,234", "$1,234.56", "-$50"
 * - Duration: "2h 30m", "1.5s", "100ms"
 * - Negative values: "-42", "($500)"
 *
 * Returns the numeric value or null if not parseable.
 */
export function parseNumericValue(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Handle parenthesized negatives: ($500) -> -500
  let working = trimmed;
  let negate = false;
  if (working.startsWith('(') && working.endsWith(')')) {
    working = working.slice(1, -1).trim();
    negate = true;
  }

  // Strip leading negative sign
  if (working.startsWith('-')) {
    negate = !negate;
    working = working.slice(1).trim();
  }
  if (working.startsWith('+')) {
    working = working.slice(1).trim();
  }

  // Strip currency symbols
  working = working.replace(/^[£€¥₹$]/, '').trim();

  // Strip trailing percent sign
  const isPercent = working.endsWith('%');
  if (isPercent) {
    working = working.slice(0, -1).trim();
  }

  // Strip trailing duration units (we parse just the numeric part)
  working = working.replace(/\s*(ms|s|m|h|d|hrs?|mins?|secs?|days?)$/i, '').trim();

  // Remove thousands separators (commas)
  working = working.replace(/,/g, '');

  // Try to parse as a number
  const num = Number(working);
  if (isNaN(num) || !isFinite(num) || working === '') {
    return null;
  }

  return negate ? -num : num;
}

/**
 * Parse a metric change between two text values
 */
function parseMetricChange(
  fromText: string,
  toText: string,
  elementId: string,
  label: string
): MetricChange | null {
  const fromNum = parseNumericValue(fromText);
  const toNum = parseNumericValue(toText);

  let numericDelta: number | undefined;
  let percentChange: number | undefined;
  let significant = false;

  if (fromNum !== null && toNum !== null) {
    numericDelta = toNum - fromNum;

    if (fromNum !== 0) {
      percentChange = ((toNum - fromNum) / Math.abs(fromNum)) * 100;
    }

    // Significant if >10% change, sign flip, or from/to zero
    if (percentChange !== undefined && Math.abs(percentChange) > 10) {
      significant = true;
    }
    if (fromNum > 0 && toNum < 0) significant = true;
    if (fromNum < 0 && toNum > 0) significant = true;
    if (fromNum === 0 && toNum !== 0) significant = true;
    if (fromNum !== 0 && toNum === 0) significant = true;
  } else {
    // Text changed but not parseable as numbers - still a change
    significant = fromText !== toText;
  }

  return {
    elementId,
    label,
    oldValue: fromText,
    newValue: toText,
    numericDelta,
    percentChange: percentChange !== undefined ? Math.round(percentChange * 100) / 100 : undefined,
    significant,
  };
}

// ============================================================================
// Status Classification
// ============================================================================

/**
 * Status progressions where later states are "better" (improved direction).
 * Each array is ordered from worst to best.
 */
const STATUS_PROGRESSIONS: string[][] = [
  [
    'failed',
    'error',
    'pending',
    'queued',
    'running',
    'in progress',
    'completed',
    'success',
    'done',
  ],
  ['disconnected', 'connecting', 'connected'],
  ['unhealthy', 'degraded', 'healthy'],
  ['offline', 'online'],
  ['inactive', 'active'],
  ['disabled', 'enabled'],
  ['down', 'up'],
  ['stopped', 'starting', 'started', 'running'],
  ['closed', 'open'],
  ['blocked', 'unblocked'],
  ['rejected', 'pending', 'approved'],
  ['critical', 'warning', 'info', 'ok'],
  ['red', 'yellow', 'green'],
];

/**
 * Classify whether a status change is an improvement, degradation, or neutral
 */
export function classifyStatusDirection(
  oldStatus: string,
  newStatus: string
): 'improved' | 'degraded' | 'neutral' {
  const oldLower = oldStatus.toLowerCase().trim();
  const newLower = newStatus.toLowerCase().trim();

  for (const progression of STATUS_PROGRESSIONS) {
    let oldIndex = -1;
    let newIndex = -1;

    for (let i = 0; i < progression.length; i++) {
      if (oldLower.includes(progression[i])) oldIndex = i;
      if (newLower.includes(progression[i])) newIndex = i;
    }

    if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
      return newIndex > oldIndex ? 'improved' : 'degraded';
    }
  }

  return 'neutral';
}

// ============================================================================
// Content Change Summary
// ============================================================================

/**
 * Generate a concise, actionable summary of content changes
 */
function generateContentChangeSummary(
  textChanges: TextChange[],
  metricChanges: MetricChange[],
  statusChanges: StatusChange[]
): string {
  const parts: string[] = [];

  // Count text changes by type
  const modified = textChanges.filter((t) => t.changeType === 'modified').length;
  const added = textChanges.filter((t) => t.changeType === 'added').length;
  const removed = textChanges.filter((t) => t.changeType === 'removed').length;

  // Heading changes
  const headingChanges = textChanges.filter(
    (t) => HEADING_CONTENT_TYPES.has(t.contentType) || t.contentType === 'heading'
  );
  if (headingChanges.length > 0) {
    parts.push(`${headingChanges.length} heading${headingChanges.length > 1 ? 's' : ''} changed`);
  }

  // Metric changes
  if (metricChanges.length > 0) {
    const significantMetrics = metricChanges.filter((m) => m.significant);
    if (significantMetrics.length > 0) {
      parts.push(
        `${significantMetrics.length} metric${significantMetrics.length > 1 ? 's' : ''} changed significantly`
      );
    } else {
      parts.push(`${metricChanges.length} metric${metricChanges.length > 1 ? 's' : ''} changed`);
    }
  }

  // Status changes
  if (statusChanges.length > 0) {
    const degraded = statusChanges.filter((s) => s.direction === 'degraded');
    const improved = statusChanges.filter((s) => s.direction === 'improved');

    if (degraded.length > 0) {
      parts.push(`${degraded.length} status${degraded.length > 1 ? 'es' : ''} degraded`);
    }
    if (improved.length > 0) {
      parts.push(`${improved.length} status${improved.length > 1 ? 'es' : ''} improved`);
    }
    const neutral = statusChanges.length - degraded.length - improved.length;
    if (neutral > 0 && degraded.length === 0 && improved.length === 0) {
      parts.push(`${neutral} status${neutral > 1 ? 'es' : ''} changed`);
    }
  }

  // General text changes (excluding headings already counted)
  const otherModified = modified - headingChanges.filter((h) => h.changeType === 'modified').length;
  if (otherModified > 0) {
    parts.push(`${otherModified} text${otherModified > 1 ? ' values' : ' value'} modified`);
  }

  if (added > 0) {
    parts.push(`${added} content${added > 1 ? ' elements' : ' element'} added`);
  }

  if (removed > 0) {
    parts.push(`${removed} content${removed > 1 ? ' elements' : ' element'} removed`);
  }

  if (parts.length === 0) {
    return 'No content changes';
  }

  return parts.join(', ');
}
