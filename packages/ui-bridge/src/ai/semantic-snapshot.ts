/**
 * Semantic Snapshot
 *
 * Creates enhanced state snapshots with AI-friendly element descriptions,
 * form analysis, and modal detection.
 */

import type { ElementState } from '../core/types';
import type { ControlSnapshot, DiscoveredElement } from '../control/types';
import type {
  SemanticSnapshot,
  AIDiscoveredElement,
  PageContext,
  FormState,
  FormFieldState,
  ModalState,
  FormAnalysis,
  FormFieldAnalysis,
} from './types';
import { SearchEngine } from './search-engine';
import {
  generatePageSummary,
  generateElementDescription,
  inferPageType,
} from './summary-generator';
import {
  generateAliases,
  generateDescription,
  generatePurpose,
  generateSuggestedActions,
} from './alias-generator';

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
   * Create a semantic snapshot from a control snapshot
   */
  createSnapshot(
    controlSnapshot: ControlSnapshot,
    pageContext?: Partial<PageContext>
  ): SemanticSnapshot {
    const snapshotId = `snapshot-${++this.snapshotCounter}-${Date.now()}`;

    // Convert elements to AI elements
    const aiElements = this.convertElements(controlSnapshot.elements);

    // Update search engine
    this.searchEngine.updateElements(aiElements);

    // Build page context
    const fullPageContext = this.buildPageContext(aiElements, pageContext);

    // Analyze forms
    const forms = this.config.analyzeForms
      ? this.analyzeForms(aiElements)
      : [];

    // Detect modals
    const modals = this.config.detectModals
      ? this.detectModals(aiElements)
      : [];

    // Count elements by type
    const elementCounts = this.countElementTypes(aiElements);

    // Generate summary
    const summary = generatePageSummary(aiElements, fullPageContext);

    // Find focused element
    const focusedElement = aiElements.find((el) => el.state.focused)?.id;

    const snapshot: SemanticSnapshot = {
      timestamp: Date.now(),
      snapshotId,
      page: fullPageContext,
      elements: aiElements.slice(0, this.config.maxElements),
      forms,
      activeModals: modals,
      focusedElement,
      summary,
      elementCounts,
    };

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
  private convertElements(
    elements: ControlSnapshot['elements']
  ): AIDiscoveredElement[] {
    return elements.map((el) => this.convertElement(el));
  }

  /**
   * Convert a single element to AI element
   */
  private convertElement(
    element: ControlSnapshot['elements'][0]
  ): AIDiscoveredElement {
    const aliases = generateAliases({
      textContent: element.state.textContent,
      elementType: element.type,
      id: element.id,
      labelText: element.label,
    });

    const description = this.config.generateDescriptions
      ? generateDescription({
          textContent: element.state.textContent,
          elementType: element.type,
          id: element.id,
          labelText: element.label,
        })
      : element.label || element.id;

    const purpose = generatePurpose({
      textContent: element.state.textContent,
      elementType: element.type,
    });

    const suggestedActions = generateSuggestedActions({
      textContent: element.state.textContent,
      elementType: element.type,
    });

    return {
      id: element.id,
      type: element.type,
      label: element.label,
      tagName: this.inferTagName(element.type),
      role: this.inferRole(element.type),
      accessibleName: element.label || element.state.textContent?.trim(),
      actions: element.actions,
      state: element.state,
      registered: true,
      description,
      aliases,
      purpose,
      suggestedActions,
      semanticType: this.inferSemanticType(element),
    };
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
      isDirty: fields.some((f) => f.value !== '' && f.touched),
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
        (el.type === 'input' || el.type === 'textarea' || el.type === 'select') &&
        el.state.visible
    );

    const fields = this.analyzeFormFields(inputs);
    const hasErrors = fields.some((f) => !f.valid);

    // Find submit button
    const submitButton = allElements.find(
      (el) =>
        el.type === 'button' &&
        el.state.visible &&
        el.semanticType === 'submit-button'
    );

    return {
      id: form.id,
      name: form.label,
      purpose: form.purpose,
      fields,
      isValid: !hasErrors,
      submitButton: submitButton?.id,
      isDirty: fields.some((f) => f.value !== ''),
    };
  }

  /**
   * Analyze form fields
   */
  private analyzeFormFields(inputs: AIDiscoveredElement[]): FormFieldState[] {
    return inputs.map((input) => ({
      id: input.id,
      label: input.accessibleName || input.label || input.id,
      type: input.type,
      value: input.state.value || '',
      valid: true, // Would need validation state
      required: false, // Would need DOM access
      touched: input.state.focused || (input.state.value?.length || 0) > 0,
    }));
  }

  /**
   * Detect modal dialogs
   */
  private detectModals(elements: AIDiscoveredElement[]): ModalState[] {
    const modals: ModalState[] = [];

    // Find dialog elements
    const dialogElements = elements.filter(
      (el) => el.type === 'dialog' && el.state.visible
    );

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
        (el) =>
          el.type === 'button' &&
          el.state.visible &&
          el.semanticType === 'submit-button'
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
    const labels = fields.map((f) =>
      (f.accessibleName || f.label || '').toLowerCase()
    );
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
