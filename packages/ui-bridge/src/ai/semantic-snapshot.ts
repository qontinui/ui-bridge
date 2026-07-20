/**
 * Semantic Snapshot
 *
 * Creates enhanced state snapshots with AI-friendly element descriptions,
 * form analysis, and modal detection.
 */

import type { ControlSnapshot } from '../control/types';
import type {
  SemanticSnapshot,
  AIDiscoveredElement,
  PageContext,
  FormState,
  FormFieldState,
  ModalState,
  FormsResponse,
} from './types';
import { SearchEngine } from './search-engine';
import { generatePageSummary, inferPageType } from './summary-generator';
import {
  generateAliases,
  generateDescription,
  generatePurpose,
  generateSuggestedActions,
} from './alias-generator';
import { getGlobalAnnotationStore } from '../annotations';
import {
  verdictFromState,
  scrubContentByVerdict,
  scrubContentRequired,
  scrubValueRequired,
  trustDeveloperContent,
} from '../core/redaction';
import { classifyRegionType } from './region-segmentation';

/**
 * Configuration for semantic snapshots
 */
export interface SemanticSnapshotConfig {
  /** Include form analysis */
  analyzeForms: boolean;
  /** Include modal detection */
  detectModals: boolean;
  /** Include page type inference */
  inferPageType: boolean;
  /** Generate element descriptions */
  generateDescriptions: boolean;
  /** Maximum elements to include */
  maxElements: number;
  /** Merge annotations from the annotation store (default: true) */
  useAnnotations: boolean;
  /** Include detailed form state via DOM-level form discovery (default: false) */
  includeForms: boolean;
  /**
   * Maximum estimated token budget for the snapshot (0 = unlimited).
   * When set, elements are progressively pruned by region priority
   * (main-content > form > modal > navigation > sidebar > header > footer)
   * until the serialized snapshot fits within the budget.
   * Tokens are estimated as ~4 characters per token.
   */
  maxTokens: number;
}

/**
 * Default snapshot configuration
 */
export const DEFAULT_SNAPSHOT_CONFIG: SemanticSnapshotConfig = {
  analyzeForms: true,
  detectModals: true,
  inferPageType: true,
  generateDescriptions: true,
  maxElements: 500,
  useAnnotations: true,
  includeForms: false,
  maxTokens: 0,
};

/**
 * Snapshot history for diffing
 */
interface SnapshotHistory {
  snapshot: SemanticSnapshot;
  timestamp: number;
}

/**
 * Semantic Snapshot Manager
 */
export class SemanticSnapshotManager {
  private config: SemanticSnapshotConfig;
  private searchEngine: SearchEngine;
  private history: SnapshotHistory[] = [];
  private readonly maxHistorySize = 10;
  private snapshotCounter = 0;

  constructor(config: Partial<SemanticSnapshotConfig> = {}) {
    this.config = { ...DEFAULT_SNAPSHOT_CONFIG, ...config };
    this.searchEngine = new SearchEngine();
  }

  /**
   * Create a semantic snapshot from a control snapshot.
   *
   * @param controlSnapshot - The control-level snapshot of registered elements.
   * @param pageContext - Optional partial page context to merge in.
   * @param formsResponse - Pre-built FormsResponse from `discoverForms()`.
   *   When provided **and** `config.includeForms` is `true`, this is
   *   attached to the snapshot as `formsDetail`.
   */
  createSnapshot(
    controlSnapshot: ControlSnapshot,
    pageContext?: Partial<PageContext>,
    formsResponse?: FormsResponse
  ): SemanticSnapshot {
    const snapshotId = `snapshot-${++this.snapshotCounter}-${Date.now()}`;

    // Convert elements to AI elements
    const aiElements = this.convertElements(controlSnapshot.elements);

    // Update search engine
    this.searchEngine.updateElements(aiElements);

    // Build page context
    const fullPageContext = this.buildPageContext(aiElements, pageContext);

    // Analyze forms
    const forms = this.config.analyzeForms ? this.analyzeForms(aiElements) : [];

    // Detect modals
    const modals = this.config.detectModals ? this.detectModals(aiElements) : [];

    // Count elements by type
    const elementCounts = this.countElementTypes(aiElements);

    // Generate summary
    const summary = generatePageSummary(aiElements, fullPageContext);

    // Find focused element
    const focusedElement = aiElements.find((el) => el.state.focused)?.id;

    // Apply token budget pruning: prioritize elements by region importance
    let budgetedElements = aiElements.slice(0, this.config.maxElements);
    if (this.config.maxTokens > 0) {
      budgetedElements = this.applyTokenBudget(budgetedElements, this.config.maxTokens);
    }

    const snapshot: SemanticSnapshot = {
      timestamp: Date.now(),
      snapshotId,
      page: fullPageContext,
      elements: budgetedElements,
      forms,
      activeModals: modals,
      focusedElement,
      summary,
      elementCounts,
    };

    // Attach detailed form state when provided (caller opted in via
    // the includeForms option or constructed the FormsResponse directly)
    if (formsResponse) {
      snapshot.formsDetail = formsResponse;
    }

    // Add to history
    this.addToHistory(snapshot);

    return snapshot;
  }

  /**
   * Get the last snapshot
   */
  getLastSnapshot(): SemanticSnapshot | null {
    if (this.history.length === 0) return null;
    return this.history[this.history.length - 1].snapshot;
  }

  /**
   * Get snapshot by ID
   */
  getSnapshot(snapshotId: string): SemanticSnapshot | null {
    const entry = this.history.find((h) => h.snapshot.snapshotId === snapshotId);
    return entry?.snapshot || null;
  }

  /**
   * Get snapshot history
   */
  getHistory(): SemanticSnapshot[] {
    return this.history.map((h) => h.snapshot);
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Convert control snapshot elements to AI elements
   */
  private convertElements(elements: ControlSnapshot['elements']): AIDiscoveredElement[] {
    return elements.map((el) => this.convertElement(el));
  }

  /**
   * Convert a single element to AI element
   */
  private convertElement(element: ControlSnapshot['elements'][0]): AIDiscoveredElement {
    const isContent = element.category === 'content';

    // §4.6: no DOM ref here (ControlSnapshot crosses the wire) — recover the
    // verdict from the stamped state. A content-redacted element contributes no
    // DOM-derived aliases.
    const redactionVerdict = verdictFromState(element.state);
    const aliases = redactionVerdict.content
      ? []
      : generateAliases({
      textContent: element.state.textContent,
      elementType: element.type,
      id: element.id,
      labelText: element.label,
    });

    // Generate content-specific descriptions
    let description: string;
    if (isContent && element.contentMetadata) {
      description = this.generateContentDescription(element);
    } else if (this.config.generateDescriptions) {
      description = generateDescription({
        textContent: element.state.textContent,
        elementType: element.type,
        id: element.id,
        labelText: element.label,
      });
    } else {
      description = element.label || element.id;
    }

    const purpose = isContent
      ? generatePurpose({ textContent: element.state.textContent, elementType: element.type })
      : generatePurpose({ textContent: element.state.textContent, elementType: element.type });

    const suggestedActions = isContent
      ? generateSuggestedActions({
          textContent: element.state.textContent,
          elementType: element.type,
        })
      : generateSuggestedActions({
          textContent: element.state.textContent,
          elementType: element.type,
        });

    // Merge annotation overrides (explicit > inferred)
    let finalDescription = description;
    let finalPurpose = purpose;
    let finalAliases = aliases;

    if (this.config.useAnnotations) {
      const annotation = getGlobalAnnotationStore().get(element.id);
      if (annotation) {
        if (annotation.description) {
          finalDescription = annotation.description;
        }
        if (annotation.purpose) {
          finalPurpose = annotation.purpose;
        }
        if (annotation.tags && annotation.tags.length > 0) {
          // Merge tags into aliases additively
          const tagSet = new Set([...finalAliases, ...annotation.tags.map((t) => t.toLowerCase())]);
          finalAliases = [...tagSet];
        }
      }
    }

    return {
      id: element.id,
      type: element.type,
      // Inputs are ControlSnapshot elements already scrubbed by their upstream
      // producer; brand for the wire slot (dev label passes through). The
      // `.trim()` on textContent would strip the brand, so read `state.textContent`
      // (already trimmed + scrubbed) directly.
      label: trustDeveloperContent(element.label),
      tagName: this.inferTagName(element.type),
      role: this.inferRole(element.type),
      accessibleName: trustDeveloperContent(element.label) ?? element.state.textContent,
      actions: element.actions,
      state: element.state,
      registered: true,
      description: scrubContentRequired(finalDescription, redactionVerdict),
      aliases: finalAliases.map((a) => trustDeveloperContent(a)!),
      purpose: finalPurpose,
      suggestedActions,
      semanticType: this.inferSemanticType(element),
      category: element.category,
      contentMetadata: element.contentMetadata,
    };
  }

  /**
   * Generate a content-specific description
   */
  private generateContentDescription(element: ControlSnapshot['elements'][0]): string {
    const meta = element.contentMetadata;
    const text = element.state.textContent?.trim() || '';
    const truncatedText = text.length > 60 ? text.substring(0, 57) + '...' : text;

    if (!meta) return `"${truncatedText}"`;

    switch (meta.contentRole) {
      case 'heading':
        return `Level ${meta.headingLevel || '?'} heading: '${truncatedText}'`;
      case 'table-cell':
        return `Table cell${meta.structuralContext ? ` (${meta.structuralContext})` : ''}: '${truncatedText}'`;
      case 'table-header':
        return `Table header${meta.structuralContext ? ` (${meta.structuralContext})` : ''}: '${truncatedText}'`;
      case 'status':
        return `Status message: '${truncatedText}'`;
      case 'badge':
        return `Badge: '${truncatedText}'`;
      case 'metric':
        return `Metric value: '${truncatedText}'`;
      case 'body-text':
        return `Text: '${truncatedText}'`;
      case 'list-item':
        return `List item: '${truncatedText}'`;
      case 'quote':
        return `Blockquote: '${truncatedText}'`;
      case 'code':
        return `Code block: '${truncatedText}'`;
      case 'caption':
        return `Caption: '${truncatedText}'`;
      case 'label':
        return `Label: '${truncatedText}'`;
      case 'description':
        return `Description: '${truncatedText}'`;
      case 'navigation':
        return `Navigation text: '${truncatedText}'`;
      default:
        return `Content: '${truncatedText}'`;
    }
  }

  /**
   * Build full page context
   */
  private buildPageContext(
    elements: AIDiscoveredElement[],
    partial?: Partial<PageContext>
  ): PageContext {
    const url = partial?.url || (typeof window !== 'undefined' ? window.location.href : '');
    const title = partial?.title || (typeof document !== 'undefined' ? document.title : '');

    const pageType = this.config.inferPageType
      ? inferPageType(url, title, elements)
      : partial?.pageType || 'unknown';

    // Detect active modals from elements
    const activeModals = elements
      .filter((el) => el.type === 'dialog' && el.state.visible)
      .map((el) => el.id);

    return {
      url,
      title,
      pageType,
      activeModals: partial?.activeModals || activeModals,
      focusedElement: partial?.focusedElement || elements.find((el) => el.state.focused)?.id,
      navigation: partial?.navigation,
      pathname: partial?.pathname,
      pageName: partial?.pageName,
      section: partial?.section,
      breadcrumb: partial?.breadcrumb,
      routePattern: partial?.routePattern,
      routeParams: partial?.routeParams,
    };
  }

  /**
   * Analyze forms in the snapshot
   */
  private analyzeForms(elements: AIDiscoveredElement[]): FormState[] {
    const forms: FormState[] = [];

    // Find form elements
    const formElements = elements.filter((el) => el.type === 'form');

    // If no explicit forms, try to detect implicit forms
    if (formElements.length === 0) {
      const implicitForm = this.detectImplicitForm(elements);
      if (implicitForm) {
        forms.push(implicitForm);
      }
    } else {
      for (const form of formElements) {
        const formState = this.analyzeForm(form, elements);
        if (formState) {
          forms.push(formState);
        }
      }
    }

    return forms;
  }

  /**
   * Detect implicit form from inputs
   */
  private detectImplicitForm(elements: AIDiscoveredElement[]): FormState | null {
    const inputs = elements.filter(
      (el) =>
        el.type === 'input' ||
        el.type === 'textarea' ||
        el.type === 'select' ||
        el.type === 'checkbox'
    );

    if (inputs.length === 0) return null;

    // Find potential submit button
    const submitButton = elements.find(
      (el) =>
        el.type === 'button' &&
        el.state.visible &&
        (el.semanticType === 'submit-button' ||
          el.state.textContent?.toLowerCase().match(/submit|save|send|continue/))
    );

    const fields = this.analyzeFormFields(inputs);
    const hasErrors = fields.some((f) => !f.valid);

    return {
      id: 'implicit-form',
      purpose: this.inferFormPurpose(inputs),
      fields,
      isValid: !hasErrors,
      submitButton: submitButton?.id,
      isDirty: fields.some((f) => f.isDirty),
    };
  }

  /**
   * Analyze a specific form
   */
  private analyzeForm(
    form: AIDiscoveredElement,
    allElements: AIDiscoveredElement[]
  ): FormState | null {
    // Find form fields (simplified - would need DOM relationship data)
    const inputs = allElements.filter(
      (el) =>
        (el.type === 'input' || el.type === 'textarea' || el.type === 'select') && el.state.visible
    );

    const fields = this.analyzeFormFields(inputs);
    const hasErrors = fields.some((f) => !f.valid);

    // Find submit button
    const submitButton = allElements.find(
      (el) => el.type === 'button' && el.state.visible && el.semanticType === 'submit-button'
    );

    return {
      id: form.id,
      name: form.label,
      purpose: form.purpose,
      fields,
      isValid: !hasErrors,
      submitButton: submitButton?.id,
      isDirty: fields.some((f) => f.isDirty),
    };
  }

  /**
   * Analyze form fields
   */
  private analyzeFormFields(inputs: AIDiscoveredElement[]): FormFieldState[] {
    return inputs.map((input) => {
      const valid = input.state.validationState ? input.state.validationState.valid : true;
      const error = input.state.validationState?.validationMessage || undefined;

      // §4.6: `input` is an already-scrubbed AIDiscoveredElement; re-mint the
      // FormFieldState slots (idempotent) using the stamped verdict.
      const redactionVerdict = verdictFromState(input.state);
      return {
        id: input.id,
        label: scrubContentRequired(input.accessibleName || input.label || input.id, redactionVerdict),
        type: input.type,
        value: scrubValueRequired(input.state.value || '', redactionVerdict),
        valid,
        error: scrubContentByVerdict(error, redactionVerdict),
        required: input.state.required ?? false,
        touched: input.state.focused || (input.state.value?.length || 0) > 0,
        placeholder: undefined, // Not available from AIDiscoveredElement
        isDirty: (input.state.value?.length || 0) > 0,
        checked: input.state.checked,
        selectedOptions: input.state.selectedOptions,
        constraints: input.state.constraints,
      };
    });
  }

  /**
   * Detect modal dialogs
   */
  private detectModals(elements: AIDiscoveredElement[]): ModalState[] {
    const modals: ModalState[] = [];

    // Find dialog elements
    const dialogElements = elements.filter((el) => el.type === 'dialog' && el.state.visible);

    for (const dialog of dialogElements) {
      // Try to find close button within dialog context
      const closeButton = elements.find(
        (el) =>
          el.type === 'button' &&
          el.state.visible &&
          (el.semanticType === 'cancel-button' ||
            el.state.textContent?.toLowerCase().match(/close|cancel|x|dismiss/))
      );

      // Try to find primary action
      const primaryAction = elements.find(
        (el) => el.type === 'button' && el.state.visible && el.semanticType === 'submit-button'
      );

      modals.push({
        id: dialog.id,
        title: dialog.accessibleName || dialog.label,
        type: this.inferModalType(dialog),
        blocking: true, // Assume dialogs are blocking
        closeButton: closeButton?.id,
        primaryAction: primaryAction?.id,
      });
    }

    return modals;
  }

  /**
   * Infer modal type
   */
  private inferModalType(dialog: AIDiscoveredElement): ModalState['type'] {
    const text = (dialog.accessibleName || dialog.state.textContent || '').toLowerCase();

    if (text.includes('alert') || text.includes('warning') || text.includes('error')) {
      return 'alert';
    }
    if (text.includes('confirm') || text.includes('are you sure')) {
      return 'confirm';
    }
    if (text.includes('prompt') || text.includes('enter')) {
      return 'prompt';
    }

    return 'dialog';
  }

  /**
   * Count elements by type
   */
  private countElementTypes(elements: AIDiscoveredElement[]): Record<string, number> {
    const counts: Record<string, number> = {};

    for (const el of elements) {
      const type = el.type.toLowerCase();
      counts[type] = (counts[type] || 0) + 1;
    }

    return counts;
  }

  /**
   * Infer form purpose from fields
   */
  private inferFormPurpose(fields: AIDiscoveredElement[]): string {
    const labels = fields.map((f) => (f.accessibleName || f.label || '').toLowerCase());
    const allLabels = labels.join(' ');

    if (allLabels.includes('email') && allLabels.includes('password')) {
      if (allLabels.includes('confirm') || allLabels.includes('name')) {
        return 'Registration';
      }
      return 'Login';
    }

    if (allLabels.includes('search')) return 'Search';
    if (allLabels.includes('address') || allLabels.includes('city')) return 'Address';
    if (allLabels.includes('card') || allLabels.includes('payment')) return 'Payment';
    if (allLabels.includes('contact') || allLabels.includes('message')) return 'Contact';

    return 'Form';
  }

  /**
   * Infer tag name from element type
   */
  private inferTagName(type: string): string {
    const typeMap: Record<string, string> = {
      button: 'button',
      input: 'input',
      textarea: 'textarea',
      select: 'select',
      checkbox: 'input',
      radio: 'input',
      link: 'a',
      form: 'form',
      dialog: 'dialog',
    };
    return typeMap[type] || 'div';
  }

  /**
   * Infer ARIA role from element type
   */
  private inferRole(type: string): string | undefined {
    const roleMap: Record<string, string> = {
      button: 'button',
      input: 'textbox',
      textarea: 'textbox',
      select: 'combobox',
      checkbox: 'checkbox',
      radio: 'radio',
      link: 'link',
      dialog: 'dialog',
      menu: 'menu',
      menuitem: 'menuitem',
      tab: 'tab',
    };
    return roleMap[type];
  }

  /**
   * Infer semantic type
   */
  private inferSemanticType(element: ControlSnapshot['elements'][0]): string {
    // Content elements use their contentRole as semantic type
    if (element.category === 'content' && element.contentMetadata) {
      const role = element.contentMetadata.contentRole;
      if (role === 'heading' && element.contentMetadata.headingLevel) {
        return `heading-${element.contentMetadata.headingLevel}`;
      }
      return role;
    }

    const text = (element.state.textContent || element.label || '').toLowerCase();
    const type = element.type.toLowerCase();

    if (type === 'button') {
      if (text.match(/submit|save|confirm|ok|done|apply/)) return 'submit-button';
      if (text.match(/cancel|close|dismiss/)) return 'cancel-button';
      if (text.match(/delete|remove|trash/)) return 'delete-button';
      if (text.match(/add|create|new|\+/)) return 'add-button';
      if (text.match(/edit|modify/)) return 'edit-button';
      if (text.match(/next|continue/)) return 'next-button';
      if (text.match(/back|previous/)) return 'back-button';
      return 'action-button';
    }

    if (type === 'input') {
      if (text.includes('email') || element.id.includes('email')) return 'email-input';
      if (text.includes('password') || element.id.includes('password')) return 'password-input';
      if (text.includes('search') || element.id.includes('search')) return 'search-input';
      return 'text-input';
    }

    return type;
  }

  /**
   * Add snapshot to history
   */
  /**
   * Region priority for token budget pruning.
   * Higher priority regions are kept; lower priority regions are pruned first.
   */
  private static readonly REGION_PRIORITY: Record<string, number> = {
    'main-content': 100,
    form: 90,
    modal: 85,
    table: 80,
    card: 75,
    toolbar: 70,
    navigation: 50,
    sidebar: 40,
    header: 30,
    footer: 20,
    unknown: 10,
  };

  /**
   * Estimate token count from serialized JSON length.
   * Uses ~4 characters per token as a rough approximation.
   */
  private estimateTokens(elements: AIDiscoveredElement[]): number {
    let charCount = 0;
    for (const el of elements) {
      // Estimate without full serialization for performance:
      // id + type + label + description + aliases + state keys
      charCount += (el.id?.length ?? 0) + (el.type?.length ?? 0);
      charCount += (el.label?.length ?? 0) + (el.description?.length ?? 0);
      charCount += el.purpose?.length ?? 0;
      if (el.aliases) charCount += el.aliases.join(',').length;
      if (el.suggestedActions) charCount += el.suggestedActions.join(',').length;
      // State contributes ~100 chars on average
      charCount += 100;
      // Content metadata contributes ~50 chars on average
      if (el.contentMetadata) charCount += 50;
    }
    return Math.ceil(charCount / 4);
  }

  /**
   * Apply token budget by pruning low-priority elements.
   * Uses region classification to determine which elements to keep.
   * Interactive elements in main-content are prioritized highest.
   */
  private applyTokenBudget(
    elements: AIDiscoveredElement[],
    maxTokens: number
  ): AIDiscoveredElement[] {
    // Quick check: if already within budget, return as-is
    if (this.estimateTokens(elements) <= maxTokens) {
      return elements;
    }

    // Classify each element by region and assign a priority score
    const scored = elements.map((el) => {
      const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 0) || 800;
      const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 0) || 1280;
      const relativeY = (el.state?.rect?.y ?? 0) / viewportHeight;
      const relativeX = (el.state?.rect?.x ?? 0) / viewportWidth;

      const region = classifyRegionType(el, relativeY, relativeX);
      const regionPriority = SemanticSnapshotManager.REGION_PRIORITY[region.type] ?? 50;

      // Boost interactive elements (buttons, inputs, links)
      const interactiveBoost = el.type === 'content' ? 0 : 20;
      // Boost visible elements
      const visibleBoost = el.state?.visible ? 10 : 0;
      // Boost focused element
      const focusBoost = el.state?.focused ? 30 : 0;

      return {
        element: el,
        priority: regionPriority + interactiveBoost + visibleBoost + focusBoost,
      };
    });

    // Sort by priority descending (highest priority first)
    scored.sort((a, b) => b.priority - a.priority);

    // Progressively include elements until budget is exceeded
    const result: AIDiscoveredElement[] = [];
    let currentTokens = 0;

    for (const { element } of scored) {
      const elementTokens = this.estimateTokens([element]);
      if (currentTokens + elementTokens > maxTokens && result.length > 0) {
        break;
      }
      result.push(element);
      currentTokens += elementTokens;
    }

    return result;
  }

  private addToHistory(snapshot: SemanticSnapshot): void {
    this.history.push({
      snapshot,
      timestamp: Date.now(),
    });

    // Trim history if needed
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }
  }
}

/**
 * Create a semantic snapshot manager
 */
export function createSnapshotManager(
  config?: Partial<SemanticSnapshotConfig>
): SemanticSnapshotManager {
  return new SemanticSnapshotManager(config);
}
