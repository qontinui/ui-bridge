/**
 * Summary Generator
 *
 * Generates LLM-friendly text summaries of pages and elements
 * for AI agents to understand the current UI state.
 */

import type {
  AIDiscoveredElement,
  FormAnalysis,
  FormState,
  PageContext,
  SemanticSnapshot,
} from './types';

/**
 * Configuration for summary generation
 */
export interface SummaryConfig {
  /** Maximum summary length in characters */
  maxLength: number;
  /** Include form details */
  includeForms: boolean;
  /** Include element counts */
  includeElementCounts: boolean;
  /** Include active modals */
  includeModals: boolean;
  /** Include focused element */
  includeFocused: boolean;
  /** Verbosity level */
  verbosity: 'brief' | 'normal' | 'detailed';
}

/**
 * Default summary configuration
 */
export const DEFAULT_SUMMARY_CONFIG: SummaryConfig = {
  maxLength: 2000,
  includeForms: true,
  includeElementCounts: true,
  includeModals: true,
  includeFocused: true,
  verbosity: 'normal',
};

/**
 * Generate a page summary from elements
 */
export function generatePageSummary(
  elements: AIDiscoveredElement[],
  pageContext?: Partial<PageContext>,
  config: Partial<SummaryConfig> = {}
): string {
  const finalConfig = { ...DEFAULT_SUMMARY_CONFIG, ...config };
  const lines: string[] = [];

  // Page context
  if (pageContext) {
    if (pageContext.title) {
      lines.push(`Page: "${pageContext.title}"`);
    }
    if (pageContext.pageType && pageContext.pageType !== 'unknown') {
      lines.push(`Type: ${formatPageType(pageContext.pageType)}`);
    }
  }

  // Element counts
  if (finalConfig.includeElementCounts) {
    const counts = countElementTypes(elements);
    const countParts: string[] = [];

    if (counts.button > 0)
      countParts.push(`${counts.button} button${counts.button > 1 ? 's' : ''}`);
    if (counts.input > 0) countParts.push(`${counts.input} input${counts.input > 1 ? 's' : ''}`);
    if (counts.link > 0) countParts.push(`${counts.link} link${counts.link > 1 ? 's' : ''}`);
    if (counts.select > 0)
      countParts.push(`${counts.select} dropdown${counts.select > 1 ? 's' : ''}`);
    if (counts.checkbox > 0)
      countParts.push(`${counts.checkbox} checkbox${counts.checkbox > 1 ? 'es' : ''}`);

    if (countParts.length > 0) {
      lines.push(`Contains: ${countParts.join(', ')}`);
    }
  }

  // Forms
  if (finalConfig.includeForms) {
    const forms = detectForms(elements);
    if (forms.length > 0) {
      lines.push('');
      lines.push('Forms:');
      for (const form of forms) {
        lines.push(generateFormSummary(form, finalConfig.verbosity));
      }
    }
  }

  // Active modals
  if (
    finalConfig.includeModals &&
    pageContext?.activeModals &&
    pageContext.activeModals.length > 0
  ) {
    lines.push('');
    lines.push(`Active modals: ${pageContext.activeModals.join(', ')}`);
  }

  // Focused element
  if (finalConfig.includeFocused && pageContext?.focusedElement) {
    lines.push(`Focus: ${pageContext.focusedElement}`);
  }

  // Key interactive elements
  const keyElements = getKeyElements(elements);
  if (keyElements.length > 0) {
    lines.push('');
    lines.push('Key elements:');
    for (const el of keyElements) {
      lines.push(`  - ${el.description}${el.state.enabled ? '' : ' (disabled)'}`);
    }
  }

  // Build final summary
  let summary = lines.join('\n');

  // Truncate if needed
  if (summary.length > finalConfig.maxLength) {
    summary = summary.substring(0, finalConfig.maxLength - 3) + '...';
  }

  return summary;
}

/**
 * Generate an element description
 */
export function generateElementDescription(element: AIDiscoveredElement): string {
  const parts: string[] = [];

  // Element type and name
  const name = element.accessibleName || element.label || element.state.textContent?.trim();
  if (name) {
    parts.push(`"${truncate(name, 30)}"`);
  }

  // Type
  parts.push(formatElementType(element.type));

  // State indicators
  const stateIndicators: string[] = [];
  if (!element.state.visible) stateIndicators.push('hidden');
  if (!element.state.enabled) stateIndicators.push('disabled');
  if (element.state.focused) stateIndicators.push('focused');
  if (element.state.checked) stateIndicators.push('checked');

  if (stateIndicators.length > 0) {
    parts.push(`(${stateIndicators.join(', ')})`);
  }

  // Value for inputs
  if (element.state.value && element.type !== 'button') {
    const valuePreview = truncate(element.state.value, 20);
    parts.push(`value: "${valuePreview}"`);
  }

  return parts.join(' ');
}

/**
 * Generate a form summary
 */
function generateFormSummary(form: FormAnalysis, verbosity: SummaryConfig['verbosity']): string {
  const lines: string[] = [];
  const formName = form.name || form.purpose || form.id;

  lines.push(`  ${formName}:`);

  if (verbosity === 'brief') {
    const fieldCount = form.fields.length;
    const filledCount = form.fields.filter((f) => f.value).length;
    lines.push(
      `    ${filledCount}/${fieldCount} fields filled, ${form.isValid ? 'valid' : 'has errors'}`
    );
  } else {
    // List fields
    for (const field of form.fields) {
      let fieldLine = `    - ${field.label || field.id}`;

      if (field.value) {
        fieldLine += ` = "${truncate(field.value, 15)}"`;
      } else if (field.placeholder) {
        fieldLine += ` (${field.placeholder})`;
      } else {
        fieldLine += ' (empty)';
      }

      if (!field.valid && field.error) {
        fieldLine += ` [ERROR: ${field.error}]`;
      } else if (field.required && !field.value) {
        fieldLine += ' [required]';
      }

      lines.push(fieldLine);
    }

    // Submit button
    if (form.submitButton) {
      lines.push(`    Submit: ${form.submitButton}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate a snapshot summary
 */
export function generateSnapshotSummary(
  snapshot: SemanticSnapshot,
  config: Partial<SummaryConfig> = {}
): string {
  const finalConfig = { ...DEFAULT_SUMMARY_CONFIG, ...config };
  const lines: string[] = [];

  // Page info
  lines.push(`Page: "${snapshot.page.title}"`);
  lines.push(`URL: ${snapshot.page.url}`);
  if (snapshot.page.pageType) {
    lines.push(`Type: ${formatPageType(snapshot.page.pageType)}`);
  }

  // Element counts
  if (finalConfig.includeElementCounts) {
    const countParts: string[] = [];
    for (const [type, count] of Object.entries(snapshot.elementCounts)) {
      if (count > 0) {
        countParts.push(`${count} ${type}${count > 1 ? 's' : ''}`);
      }
    }
    if (countParts.length > 0) {
      lines.push(`Elements: ${countParts.join(', ')}`);
    }
  }

  // Forms
  if (finalConfig.includeForms && snapshot.forms.length > 0) {
    lines.push('');
    lines.push('Forms:');
    for (const form of snapshot.forms) {
      lines.push(generateFormStateSummary(form));
    }
  }

  // Modals
  if (finalConfig.includeModals && snapshot.activeModals.length > 0) {
    lines.push('');
    lines.push('Active dialogs:');
    for (const modal of snapshot.activeModals) {
      lines.push(`  - ${modal.title || modal.id} (${modal.type})`);
    }
  }

  // Focused element
  if (finalConfig.includeFocused && snapshot.focusedElement) {
    const focused = snapshot.elements.find((e) => e.id === snapshot.focusedElement);
    if (focused) {
      lines.push(`Focused: ${generateElementDescription(focused)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate form state summary
 */
function generateFormStateSummary(form: FormState): string {
  const lines: string[] = [];
  const formName = form.name || form.purpose || form.id;

  const filledCount = form.fields.filter((f) => f.value).length;
  const errorCount = form.fields.filter((f) => !f.valid).length;

  let statusLine = `  ${formName}: ${filledCount}/${form.fields.length} filled`;
  if (errorCount > 0) {
    statusLine += `, ${errorCount} error${errorCount > 1 ? 's' : ''}`;
  }
  if (form.isDirty) {
    statusLine += ' (modified)';
  }

  lines.push(statusLine);

  // List errors
  for (const field of form.fields) {
    if (!field.valid && field.error) {
      lines.push(`    ERROR: ${field.label}: ${field.error}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate diff summary
 */
export function generateDiffSummary(
  appeared: string[],
  disappeared: string[],
  modified: Array<{ description: string; property: string; from: string; to: string }>
): string {
  const lines: string[] = [];

  if (appeared.length > 0) {
    lines.push(`Appeared: ${appeared.join(', ')}`);
  }

  if (disappeared.length > 0) {
    lines.push(`Disappeared: ${disappeared.join(', ')}`);
  }

  if (modified.length > 0) {
    lines.push('Changed:');
    for (const mod of modified.slice(0, 5)) {
      lines.push(
        `  - ${mod.description}: ${mod.property} changed from "${mod.from}" to "${mod.to}"`
      );
    }
    if (modified.length > 5) {
      lines.push(`  ... and ${modified.length - 5} more changes`);
    }
  }

  if (lines.length === 0) {
    return 'No changes detected';
  }

  return lines.join('\n');
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Count elements by type
 */
function countElementTypes(elements: AIDiscoveredElement[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const el of elements) {
    const type = el.type.toLowerCase();
    counts[type] = (counts[type] || 0) + 1;
  }

  return counts;
}

/**
 * Detect forms from elements
 */
function detectForms(elements: AIDiscoveredElement[]): FormAnalysis[] {
  // Group inputs by common patterns (this is a simplified heuristic)
  const formElements = elements.filter(
    (el) =>
      el.type === 'input' ||
      el.type === 'textarea' ||
      el.type === 'select' ||
      el.type === 'checkbox'
  );

  if (formElements.length === 0) return [];

  // For simplicity, treat all inputs as one form if no explicit forms
  const forms: FormAnalysis[] = [];

  // Find submit buttons
  const submitButtons = elements.filter(
    (el) =>
      el.type === 'button' &&
      (el.state.textContent?.toLowerCase().includes('submit') ||
        el.state.textContent?.toLowerCase().includes('save') ||
        el.state.textContent?.toLowerCase().includes('send') ||
        el.semanticType === 'submit-button')
  );

  // Create a default form
  const defaultForm: FormAnalysis = {
    id: 'detected-form',
    purpose: inferFormPurpose(formElements),
    fields: formElements.map((el) => ({
      id: el.id,
      label: el.labelText || el.accessibleName || el.placeholder || el.id,
      type: el.type,
      value: el.state.value || '',
      valid: true, // Can't determine without validation state
      required: false, // Can't determine without DOM access
      placeholder: el.placeholder,
    })),
    isValid: true,
    submitButton: submitButtons[0]?.id,
  };

  if (defaultForm.fields.length > 0) {
    forms.push(defaultForm);
  }

  return forms;
}

/**
 * Infer form purpose from fields
 */
function inferFormPurpose(fields: AIDiscoveredElement[]): string {
  const labels = fields.map((f) =>
    (f.labelText || f.accessibleName || f.placeholder || '').toLowerCase()
  );
  const allLabels = labels.join(' ');

  if (allLabels.includes('email') && allLabels.includes('password')) {
    if (allLabels.includes('confirm') || allLabels.includes('name')) {
      return 'Registration form';
    }
    return 'Login form';
  }

  if (allLabels.includes('search')) {
    return 'Search form';
  }

  if (allLabels.includes('address') || allLabels.includes('city') || allLabels.includes('zip')) {
    return 'Address form';
  }

  if (allLabels.includes('card') || allLabels.includes('cvv') || allLabels.includes('expir')) {
    return 'Payment form';
  }

  if (allLabels.includes('contact') || allLabels.includes('message')) {
    return 'Contact form';
  }

  return 'Form';
}

/**
 * Get key interactive elements for summary
 */
function getKeyElements(elements: AIDiscoveredElement[]): AIDiscoveredElement[] {
  const keyElements: AIDiscoveredElement[] = [];

  // Prioritize submit/action buttons
  const actionButtons = elements.filter(
    (el) =>
      el.type === 'button' &&
      el.state.visible &&
      (el.semanticType?.includes('submit') ||
        el.semanticType?.includes('action') ||
        el.semanticType?.includes('next'))
  );
  keyElements.push(...actionButtons.slice(0, 2));

  // Add primary inputs
  const primaryInputs = elements.filter(
    (el) => (el.type === 'input' || el.type === 'textarea') && el.state.visible
  );
  keyElements.push(...primaryInputs.slice(0, 3));

  // Add visible links
  const links = elements.filter((el) => el.type === 'link' && el.state.visible);
  keyElements.push(...links.slice(0, 2));

  // Deduplicate and limit
  const unique = [...new Map(keyElements.map((e) => [e.id, e])).values()];
  return unique.slice(0, 8);
}

/**
 * Format page type for display
 */
function formatPageType(pageType: PageContext['pageType']): string {
  const typeLabels: Record<NonNullable<PageContext['pageType']>, string> = {
    login: 'Login page',
    dashboard: 'Dashboard',
    form: 'Form page',
    list: 'List/table page',
    detail: 'Detail page',
    search: 'Search page',
    checkout: 'Checkout page',
    settings: 'Settings page',
    unknown: 'Unknown',
  };

  return typeLabels[pageType || 'unknown'] || 'Page';
}

/**
 * Format element type for display
 */
function formatElementType(type: string): string {
  const typeLabels: Record<string, string> = {
    button: 'button',
    input: 'input field',
    textarea: 'text area',
    select: 'dropdown',
    checkbox: 'checkbox',
    radio: 'radio button',
    link: 'link',
    form: 'form',
    menu: 'menu',
    menuitem: 'menu item',
    tab: 'tab',
    dialog: 'dialog',
    switch: 'switch',
    slider: 'slider',
  };

  return typeLabels[type.toLowerCase()] || type;
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Infer page type from URL and elements
 */
export function inferPageType(
  url: string,
  title: string,
  elements: AIDiscoveredElement[]
): PageContext['pageType'] {
  const urlLower = url.toLowerCase();
  const titleLower = title.toLowerCase();

  // URL-based detection
  if (urlLower.includes('login') || urlLower.includes('signin')) return 'login';
  if (urlLower.includes('dashboard')) return 'dashboard';
  if (urlLower.includes('search')) return 'search';
  if (urlLower.includes('checkout') || urlLower.includes('payment')) return 'checkout';
  if (urlLower.includes('settings') || urlLower.includes('preferences')) return 'settings';

  // Title-based detection
  if (titleLower.includes('login') || titleLower.includes('sign in')) return 'login';
  if (titleLower.includes('dashboard')) return 'dashboard';
  if (titleLower.includes('search')) return 'search';

  // Element-based detection
  const hasLoginForm =
    elements.some((el) => el.type === 'input' && el.semanticType === 'email-input') &&
    elements.some((el) => el.type === 'input' && el.semanticType === 'password-input');
  if (hasLoginForm) return 'login';

  const hasSearchInput = elements.some(
    (el) => el.type === 'input' && el.semanticType === 'search-input'
  );
  if (hasSearchInput) return 'search';

  // Check for form presence
  const inputCount = elements.filter(
    (el) => el.type === 'input' || el.type === 'textarea' || el.type === 'select'
  ).length;
  if (inputCount >= 3) return 'form';

  // Check for list/table
  const hasTable = elements.some((el) => el.tagName === 'table');
  const hasMany = elements.length > 20;
  if (hasTable || hasMany) return 'list';

  return 'unknown';
}
