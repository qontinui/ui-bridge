/**
 * useAutoRegister Hook
 *
 * Enables automatic registration of interactive DOM elements with the UI Bridge.
 * This eliminates the need for manual useUIElement() calls on every component.
 *
 * Features:
 * - Auto-discovers interactive elements (buttons, inputs, links, etc.)
 * - Uses MutationObserver to detect new elements
 * - Generates stable, deterministic semantic IDs from element content/attributes
 * - Registers elements via the internal bridge registry (no DOM attributes set)
 * - Debounced updates for performance
 * - Respects existing manually registered elements
 */

import { useEffect, useRef, useCallback } from 'react';
import { useUIBridgeOptional } from './UIBridgeProvider';
import type { ElementType, StandardAction } from '../core/types';
import type { ContentDiscoveryOptions } from './content-discovery';
import {
  CONTENT_SELECTORS,
  shouldRegisterContent,
  inferContentType,
  inferContentMetadata,
  generateContentId,
} from './content-discovery';

/**
 * ID generation strategy
 */
export type IdStrategy =
  | 'data-testid' // Use data-testid attribute if present
  | 'semantic' // Generate stable semantic ID based on element content
  | 'auto' // Auto-generate unique ID (unstable across renders)
  | 'prefer-existing'; // Use existing attributes (data-testid, id), fall back to semantic

/**
 * Options for auto-registration
 */
export interface AutoRegisterOptions {
  /** Enable auto-registration (default: true in dev mode) */
  enabled?: boolean;
  /** Root element to observe (default: document.body) */
  root?: HTMLElement | null;
  /** ID generation strategy (default: 'prefer-existing') */
  idStrategy?: IdStrategy;
  /** Debounce time for mutation handling (ms, default: 100) */
  debounceMs?: number;
  /** Include hidden elements (default: false) */
  includeHidden?: boolean;
  /** Only register elements matching these selectors */
  includeSelectors?: string[];
  /** Exclude elements matching these selectors */
  excludeSelectors?: string[];
  /** Custom ID generator function */
  generateId?: (element: HTMLElement) => string;
  /** Callback when element is registered */
  onRegister?: (id: string, element: HTMLElement) => void;
  /** Callback when element is unregistered */
  onUnregister?: (id: string) => void;
  /** Content discovery options (enabled by default) */
  contentDiscovery?: ContentDiscoveryOptions;
}

/**
 * Interactive element selectors
 */
const INTERACTIVE_SELECTORS = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="textbox"]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
  '[data-ui-element]', // Explicitly marked for registration
  '[data-testid]', // Testing library convention
];

/**
 * Infer element type from DOM element
 */
function inferElementType(element: HTMLElement): ElementType {
  const role = element.getAttribute('role');
  if (role) {
    const roleMap: Record<string, ElementType> = {
      button: 'button',
      link: 'link',
      checkbox: 'checkbox',
      radio: 'radio',
      menuitem: 'menuitem',
      tab: 'tab',
      switch: 'switch',
      slider: 'slider',
      combobox: 'combobox',
      listbox: 'listbox',
      option: 'option',
      textbox: 'textbox',
    };
    if (role in roleMap) {
      return roleMap[role];
    }
  }

  const tagName = element.tagName.toLowerCase();
  switch (tagName) {
    case 'a':
      return 'link';
    case 'button':
      return 'button';
    case 'input': {
      const type = (element as HTMLInputElement).type?.toLowerCase() || 'text';
      switch (type) {
        case 'checkbox':
          return 'checkbox';
        case 'radio':
          return 'radio';
        case 'range':
          return 'slider';
        case 'submit':
        case 'button':
          return 'button';
        default:
          return 'input';
      }
    }
    case 'select':
      return 'select';
    case 'textarea':
      return 'textarea';
    case 'option':
      return 'option';
    default:
      return 'generic';
  }
}

/**
 * Infer actions for element type
 */
function inferActions(type: ElementType): StandardAction[] {
  const baseActions: StandardAction[] = ['focus', 'blur'];

  const typeActions: Record<ElementType, StandardAction[]> = {
    button: [...baseActions, 'click', 'hover', 'middleClick'],
    link: [...baseActions, 'click', 'hover'],
    input: [...baseActions, 'type', 'clear', 'click'],
    textarea: [...baseActions, 'type', 'clear', 'click'],
    textbox: [...baseActions, 'type', 'clear', 'click'],
    checkbox: [...baseActions, 'check', 'uncheck', 'toggle', 'click'],
    radio: [...baseActions, 'click', 'select'],
    select: [...baseActions, 'select', 'click'],
    combobox: [...baseActions, 'select', 'type', 'click'],
    listbox: [...baseActions, 'select', 'click'],
    option: [...baseActions, 'select', 'click'],
    switch: [...baseActions, 'toggle', 'click'],
    slider: [...baseActions, 'setValue', 'click', 'drag'],
    tab: [...baseActions, 'click', 'select', 'middleClick'],
    menuitem: [...baseActions, 'click'],
    dialog: [...baseActions],
    menu: [...baseActions],
    form: [...baseActions, 'submit', 'reset'],
    custom: [...baseActions, 'click'],
    generic: [...baseActions, 'click'],
  };

  return typeActions[type] || baseActions;
}

/**
 * Get accessible label for element
 */
function getAccessibleLabel(element: HTMLElement): string | undefined {
  // aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;

  // aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent?.trim();
  }

  // Associated label (for inputs)
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) return label.textContent?.trim();
  }

  // Title attribute
  const title = element.getAttribute('title');
  if (title) return title;

  // Inner text (limited)
  const text = element.textContent?.trim();
  if (text && text.length <= 50) return text;

  // Placeholder for inputs
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const placeholder = element.placeholder;
    if (placeholder) return placeholder;
  }

  return undefined;
}

/**
 * Check if element is visible
 */
function isElementVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Sanitize a string into a kebab-case slug suitable for an ID.
 * Strips parenthetical hints like "(Ctrl+Shift+T)" and special chars.
 */
function slugify(text: string, maxLen = 30): string {
  return text
    .replace(/\s*\(.*?\)\s*/g, '') // strip parenthetical hints
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen);
}

/**
 * Get a short, stable ancestor context slug for disambiguation.
 * Walks up the DOM looking for the nearest ancestor with an id, data-testid,
 * aria-label, or semantic landmark tag to provide positional context.
 */
function getAncestorContext(element: HTMLElement): string | undefined {
  let current = element.parentElement;
  let depth = 0;
  while (current && depth < 5) {
    // Check for explicit identifiers
    const testId = current.getAttribute('data-testid');
    if (testId) return slugify(testId, 20);

    const id = current.id;
    if (id && !/^:r[0-9a-z]+:$/.test(id)) return slugify(id, 20); // skip React auto-ids

    // Check for semantic landmarks
    const role = current.getAttribute('role');
    if (
      role &&
      ['navigation', 'main', 'banner', 'dialog', 'tabpanel', 'toolbar', 'form'].includes(role)
    ) {
      const label = current.getAttribute('aria-label');
      return label ? slugify(`${role}-${label}`, 20) : role;
    }

    // Check for landmark tags
    const tag = current.tagName.toLowerCase();
    if (['nav', 'main', 'header', 'footer', 'aside', 'form', 'dialog', 'section'].includes(tag)) {
      const label = current.getAttribute('aria-label');
      return label ? slugify(`${tag}-${label}`, 20) : tag;
    }

    current = current.parentElement;
    depth++;
  }
  return undefined;
}

/**
 * Get a sibling index among same-type elements in the same parent.
 * Returns undefined if the element is the only one of its type.
 */
function getSiblingIndex(element: HTMLElement): number | undefined {
  const parent = element.parentElement;
  if (!parent) return undefined;

  const tag = element.tagName;
  const role = element.getAttribute('role');

  // Count same-type siblings
  const siblings = Array.from(parent.children).filter((child) => {
    if (child.tagName !== tag) return false;
    if (role && child.getAttribute('role') !== role) return false;
    return true;
  });

  if (siblings.length <= 1) return undefined;
  return siblings.indexOf(element);
}

/**
 * Selector for interactive elements used to detect nesting.
 * Matches the same elements as INTERACTIVE_SELECTORS but consolidated
 * for use with Element.closest().
 */
const INTERACTIVE_CLOSEST_SELECTOR = [
  'a[href]',
  'button',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="link"]',
  '[role="option"]',
  '[role="switch"]',
].join(', ');

/**
 * Find the nearest ancestor that is itself an interactive element.
 * Returns null if the element is not nested inside another interactive element.
 */
function findParentInteractive(element: HTMLElement): HTMLElement | null {
  const parent = element.parentElement;
  if (!parent) return null;
  const match = parent.closest(INTERACTIVE_CLOSEST_SELECTOR);
  return match ? (match as HTMLElement) : null;
}

/**
 * Try to infer a purpose label for an icon-only element (no text content).
 * Checks for common close/action patterns: aria-label on the element,
 * title attribute, small size heuristic, or SVG-only children.
 */
function inferIconAction(element: HTMLElement): string | undefined {
  // aria-label or title would have been caught by getAccessibleLabel,
  // but check for common class-name hints
  const className = element.className;
  if (typeof className === 'string') {
    const lower = className.toLowerCase();
    if (lower.includes('close')) return 'close';
    if (lower.includes('delete') || lower.includes('remove')) return 'remove';
    if (lower.includes('expand')) return 'expand';
    if (lower.includes('collapse')) return 'collapse';
    if (lower.includes('minimize')) return 'minimize';
    if (lower.includes('maximize')) return 'maximize';
  }

  // Check if the element contains only SVG (icon-only button)
  const children = element.children;
  if (children.length === 1 && children[0].tagName.toLowerCase() === 'svg') {
    // Check SVG for class hints
    const svgClass = children[0].className;
    const svgClassStr =
      typeof svgClass === 'string' ? svgClass : ((svgClass as SVGAnimatedString)?.baseVal ?? '');
    const svgLower = svgClassStr.toLowerCase();
    if (svgLower.includes('close') || svgLower.includes('x-icon')) return 'close';
    if (svgLower.includes('delete') || svgLower.includes('trash')) return 'remove';
    if (svgLower.includes('chevron')) return 'toggle';
    if (svgLower.includes('plus') || svgLower.includes('add')) return 'add';
  }

  // Small element heuristic: if the element is small (~24px or less)
  // and nested, it's likely a close/dismiss/action button
  const rect = element.getBoundingClientRect();
  if (rect.width > 0 && rect.width <= 28 && rect.height > 0 && rect.height <= 28) {
    return 'action';
  }

  return undefined;
}

/**
 * Generate a stable, deterministic semantic ID based on element content,
 * attributes, and position in the DOM hierarchy.
 *
 * ID format: {type}-{label}[-{context}][-{index}]
 *
 * For nested interactive elements (e.g., close button inside a tab):
 *   {type}-{iconAction}-{parentLabel}  or  {type}-{parentLabel}-{index}
 *
 * Examples:
 *   button with title "New terminal (Ctrl+Shift+T)" → "button-new-terminal"
 *   button with text "Sessions" in toolbar           → "button-sessions"
 *   input with placeholder "Search..."               → "input-search"
 *   button with no label, 3rd in toolbar              → "button-toolbar-2"
 *   close icon inside "Terminal 1" tab                → "button-close-terminal-1"
 *   icon-only button inside "File" menu item          → "button-action-file"
 */
function generateSemanticId(element: HTMLElement): string {
  const type = inferElementType(element);
  const label = getAccessibleLabel(element);

  if (label) {
    const slug = slugify(label);
    if (slug) {
      const siblingIdx = getSiblingIndex(element);
      if (siblingIdx !== undefined) {
        // Multiple elements with same label in same parent — disambiguate
        return `${type}-${slug}-${siblingIdx}`;
      }
      return `${type}-${slug}`;
    }
  }

  // Check if this element is nested inside another interactive element.
  // This handles cases like a close button (icon-only) inside a tab —
  // the parent tab's label provides the missing context.
  const parentInteractive = findParentInteractive(element);
  if (parentInteractive) {
    const parentLabel = getAccessibleLabel(parentInteractive);
    if (parentLabel) {
      const parentSlug = slugify(parentLabel, 20);
      if (parentSlug) {
        // Try to infer what this nested element does (close, remove, etc.)
        const iconAction = inferIconAction(element);
        if (iconAction) {
          return `${type}-${iconAction}-${parentSlug}`;
        }
        // Fallback: use parent label + sibling index among nested interactive elements
        const siblingIdx = getSiblingIndex(element);
        if (siblingIdx !== undefined) {
          return `${type}-${parentSlug}-${siblingIdx}`;
        }
        return `${type}-${parentSlug}-nested`;
      }
    }
  }

  // No label available — use ancestor context + sibling index
  const context = getAncestorContext(element);
  const siblingIdx = getSiblingIndex(element);

  if (context && siblingIdx !== undefined) {
    return `${type}-${context}-${siblingIdx}`;
  }
  if (context) {
    return `${type}-${context}`;
  }
  if (siblingIdx !== undefined) {
    return `${element.tagName.toLowerCase()}-${siblingIdx}`;
  }

  // Last resort: tag + DOM path position (still deterministic, no randomness)
  const parent = element.parentElement;
  if (parent) {
    const allChildren = Array.from(parent.children);
    const idx = allChildren.indexOf(element);
    return `${type}-child-${idx}`;
  }

  return `${type}-root`;
}

/**
 * Generate unique auto ID
 */
function generateAutoId(element: HTMLElement): string {
  const type = inferElementType(element);
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate ID based on strategy
 */
function generateIdForElement(
  element: HTMLElement,
  strategy: IdStrategy,
  customGenerator?: (element: HTMLElement) => string
): string {
  if (customGenerator) {
    return customGenerator(element);
  }

  switch (strategy) {
    case 'data-testid': {
      const testId = element.getAttribute('data-testid');
      return testId || generateSemanticId(element);
    }
    case 'semantic':
      return generateSemanticId(element);
    case 'auto':
      return generateAutoId(element);
    case 'prefer-existing':
    default: {
      // Priority: data-testid > id > semantic
      // Note: data-ui-id is not used — elements are identified via the bridge registry
      const testId = element.getAttribute('data-testid');
      if (testId) return testId;

      const htmlId = element.id;
      // Skip React auto-generated IDs (e.g., ":r1a:")
      if (htmlId && !/^:r[0-9a-z]+:$/.test(htmlId)) return htmlId;

      return generateSemanticId(element);
    }
  }
}

/**
 * Hook for automatic element registration
 *
 * @example
 * ```tsx
 * function App() {
 *   // Enable auto-registration for all interactive elements
 *   useAutoRegister({ enabled: true });
 *
 *   return (
 *     <div>
 *       <button data-testid="submit-btn">Submit</button>
 *       <input data-testid="email-input" />
 *     </div>
 *   );
 * }
 * ```
 */
export function useAutoRegister(options: AutoRegisterOptions = {}): void {
  const {
    enabled = process.env.NODE_ENV === 'development',
    root = null,
    idStrategy = 'prefer-existing',
    debounceMs = 100,
    includeHidden = false,
    includeSelectors = [],
    excludeSelectors = [],
    generateId: customGenerateId,
    onRegister,
    onUnregister,
    contentDiscovery,
  } = options;

  const contentEnabled = contentDiscovery?.enabled !== false;

  const bridge = useUIBridgeOptional();
  const registeredElementsRef = useRef(new Map<HTMLElement, string>());
  const registeredContentElementsRef = useRef(new Map<HTMLElement, string>());
  const pendingRegistrationsRef = useRef(new Set<HTMLElement>());
  const pendingContentRegistrationsRef = useRef(new Set<HTMLElement>());
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentDebounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Check if element should be registered
   */
  const shouldRegister = useCallback(
    (element: HTMLElement): boolean => {
      // Check visibility
      if (!includeHidden && !isElementVisible(element)) {
        return false;
      }

      // Check exclude selectors
      for (const selector of excludeSelectors) {
        if (element.matches(selector)) {
          return false;
        }
      }

      // Check if already registered
      if (registeredElementsRef.current.has(element)) {
        return false;
      }

      // Check if matches interactive selectors
      const allSelectors = [...INTERACTIVE_SELECTORS, ...includeSelectors];
      for (const selector of allSelectors) {
        if (element.matches(selector)) {
          return true;
        }
      }

      return false;
    },
    [includeHidden, includeSelectors, excludeSelectors]
  );

  /**
   * Register a single element with the bridge registry.
   * Elements are identified through the internal registry, not DOM attributes.
   */
  const registerElement = useCallback(
    (element: HTMLElement): void => {
      if (!bridge?.registry || registeredElementsRef.current.has(element)) {
        return;
      }

      let id = generateIdForElement(element, idStrategy, customGenerateId);

      // Check if ID already exists in registry — disambiguate with sibling index
      const existing = bridge.registry.getElement(id);
      if (existing) {
        // Find a unique suffix by counting collisions
        let suffix = 1;
        while (bridge.registry.getElement(`${id}-${suffix}`)) {
          suffix++;
        }
        id = `${id}-${suffix}`;
      }

      const type = inferElementType(element);
      const actions = inferActions(type);
      const label = getAccessibleLabel(element);

      const registered = bridge.registry.registerElement(id, element, {
        type,
        actions,
        label,
      });

      const finalId = registered.id;
      registeredElementsRef.current.set(element, finalId);

      onRegister?.(finalId, element);
    },
    [bridge, idStrategy, customGenerateId, onRegister]
  );

  /**
   * Unregister a single element from the bridge registry.
   */
  const unregisterElement = useCallback(
    (element: HTMLElement): void => {
      const id = registeredElementsRef.current.get(element);
      if (!id || !bridge?.registry) return;

      bridge.registry.unregisterElement(id);
      registeredElementsRef.current.delete(element);

      onUnregister?.(id);
    },
    [bridge, onUnregister]
  );

  /**
   * Register a single content element
   */
  const registerContentElement = useCallback(
    (element: HTMLElement): void => {
      if (!bridge?.registry || registeredContentElementsRef.current.has(element)) {
        return;
      }

      const maxElements = contentDiscovery?.maxContentElements ?? 500;
      if (registeredContentElementsRef.current.size >= maxElements) {
        return;
      }

      const id = generateContentId(element);

      // Check if ID already exists in registry
      const existing = bridge.registry.getElement(id);
      if (existing) {
        return; // Content IDs are deterministic — skip duplicates
      }

      const contentType = inferContentType(element);
      const metadata = inferContentMetadata(element);
      const label =
        element.getAttribute('data-content-label') ||
        element.textContent?.trim().substring(0, 50) ||
        undefined;

      bridge.registry.registerContentElement(id, element, {
        contentType,
        contentMetadata: metadata,
        label,
      });

      registeredContentElementsRef.current.set(element, id);
    },
    [bridge, contentDiscovery?.maxContentElements]
  );

  /**
   * Unregister a single content element
   */
  const unregisterContentElement = useCallback(
    (element: HTMLElement): void => {
      const id = registeredContentElementsRef.current.get(element);
      if (!id || !bridge?.registry) return;

      bridge.registry.unregisterElement(id);
      registeredContentElementsRef.current.delete(element);
    },
    [bridge]
  );

  /**
   * Process pending registrations (debounced)
   */
  const processPendingRegistrations = useCallback(() => {
    pendingRegistrationsRef.current.forEach((element) => {
      if (shouldRegister(element)) {
        registerElement(element);
      }
    });
    pendingRegistrationsRef.current.clear();
  }, [shouldRegister, registerElement]);

  /**
   * Process pending content registrations (debounced, separate timer)
   */
  const processPendingContentRegistrations = useCallback(() => {
    const registeredIds = new Set(registeredContentElementsRef.current.values());
    pendingContentRegistrationsRef.current.forEach((element) => {
      if (shouldRegisterContent(element, contentDiscovery, registeredIds)) {
        registerContentElement(element);
      }
    });
    pendingContentRegistrationsRef.current.clear();
  }, [contentDiscovery, registerContentElement]);

  /**
   * Queue element for registration (with debounce)
   */
  const queueRegistration = useCallback(
    (element: HTMLElement): void => {
      pendingRegistrationsRef.current.add(element);

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }

      debounceTimeoutRef.current = setTimeout(processPendingRegistrations, debounceMs);
    },
    [debounceMs, processPendingRegistrations]
  );

  /**
   * Queue content element for registration (separate debounce timer)
   */
  const queueContentRegistration = useCallback(
    (element: HTMLElement): void => {
      pendingContentRegistrationsRef.current.add(element);

      if (contentDebounceTimeoutRef.current) {
        clearTimeout(contentDebounceTimeoutRef.current);
      }

      const contentDebounceMs = contentDiscovery?.contentDebounceMs ?? 250;
      contentDebounceTimeoutRef.current = setTimeout(
        processPendingContentRegistrations,
        contentDebounceMs
      );
    },
    [contentDiscovery?.contentDebounceMs, processPendingContentRegistrations]
  );

  /**
   * Scan and register all existing interactive elements
   */
  const scanAndRegister = useCallback(
    (rootElement: HTMLElement): void => {
      // Scan interactive elements
      const allSelectors = [...INTERACTIVE_SELECTORS, ...includeSelectors].join(', ');
      const elements = rootElement.querySelectorAll<HTMLElement>(allSelectors);

      elements.forEach((element) => {
        if (shouldRegister(element)) {
          queueRegistration(element);
        }
      });

      // Scan content elements
      if (contentEnabled) {
        const contentSelectors = [
          ...CONTENT_SELECTORS,
          ...(contentDiscovery?.includeContentSelectors || []),
        ].join(', ');
        const contentElements = rootElement.querySelectorAll<HTMLElement>(contentSelectors);
        const registeredIds = new Set(registeredContentElementsRef.current.values());

        contentElements.forEach((element) => {
          if (shouldRegisterContent(element, contentDiscovery, registeredIds)) {
            queueContentRegistration(element);
          }
        });
      }
    },
    [
      includeSelectors,
      shouldRegister,
      queueRegistration,
      contentEnabled,
      contentDiscovery,
      queueContentRegistration,
    ]
  );

  /**
   * Handle mutations
   */
  const handleMutations = useCallback(
    (mutations: MutationRecord[]): void => {
      mutations.forEach((mutation) => {
        // Handle added nodes
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;

            // Check the element itself for interactive registration
            if (shouldRegister(element)) {
              queueRegistration(element);
            }

            // Check descendants for interactive registration
            const allSelectors = [...INTERACTIVE_SELECTORS, ...includeSelectors].join(', ');
            const descendants = element.querySelectorAll<HTMLElement>(allSelectors);
            descendants.forEach((descendant) => {
              if (shouldRegister(descendant)) {
                queueRegistration(descendant);
              }
            });

            // Content discovery for added nodes
            if (contentEnabled) {
              const contentSelectors = [
                ...CONTENT_SELECTORS,
                ...(contentDiscovery?.includeContentSelectors || []),
              ].join(', ');
              const registeredIds = new Set(registeredContentElementsRef.current.values());

              // Check the element itself
              if (shouldRegisterContent(element, contentDiscovery, registeredIds)) {
                queueContentRegistration(element);
              }

              // Check descendants
              const contentDescendants = element.querySelectorAll<HTMLElement>(contentSelectors);
              contentDescendants.forEach((descendant) => {
                if (shouldRegisterContent(descendant, contentDiscovery, registeredIds)) {
                  queueContentRegistration(descendant);
                }
              });
            }
          }
        });

        // Handle removed nodes
        mutation.removedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;

            // Unregister the element itself (interactive)
            if (registeredElementsRef.current.has(element)) {
              unregisterElement(element);
            }

            // Unregister the element itself (content)
            if (registeredContentElementsRef.current.has(element)) {
              unregisterContentElement(element);
            }

            // Unregister descendants
            const descendants = element.querySelectorAll<HTMLElement>('*');
            descendants.forEach((descendant) => {
              if (registeredElementsRef.current.has(descendant)) {
                unregisterElement(descendant);
              }
              if (registeredContentElementsRef.current.has(descendant)) {
                unregisterContentElement(descendant);
              }
            });
          }
        });
      });
    },
    [
      shouldRegister,
      queueRegistration,
      unregisterElement,
      includeSelectors,
      contentEnabled,
      contentDiscovery,
      queueContentRegistration,
      unregisterContentElement,
    ]
  );

  /**
   * Setup observer and initial scan
   */
  useEffect(() => {
    if (!enabled || !bridge?.registry) return;

    const rootElement = root || document.body;

    // Initial scan
    scanAndRegister(rootElement);

    // Setup mutation observer
    const observer = new MutationObserver(handleMutations);
    observer.observe(rootElement, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (contentDebounceTimeoutRef.current) {
        clearTimeout(contentDebounceTimeoutRef.current);
      }

      // Unregister all interactive elements
      registeredElementsRef.current.forEach((id, _element) => {
        bridge.registry.unregisterElement(id);
      });
      registeredElementsRef.current.clear();

      // Unregister all content elements
      registeredContentElementsRef.current.forEach((id, _element) => {
        bridge.registry.unregisterElement(id);
      });
      registeredContentElementsRef.current.clear();
    };
  }, [enabled, bridge, root, scanAndRegister, handleMutations]);
}

export default useAutoRegister;
