/**
 * useAutoRegister Hook
 *
 * Enables automatic registration of interactive DOM elements with the UI Bridge.
 * This eliminates the need for manual useUIElement() calls on every component.
 *
 * Features:
 * - Auto-discovers interactive elements (buttons, inputs, links, etc.)
 * - Uses MutationObserver to detect new elements
 * - Smart ID generation (data-testid > data-ui-id > semantic > auto-generated)
 * - Debounced updates for performance
 * - Respects existing manually registered elements
 */

import { useEffect, useRef, useCallback } from 'react';
import { useUIBridgeOptional } from './UIBridgeProvider';
import type { ElementType, StandardAction } from '../core/types';

/**
 * ID generation strategy
 */
export type IdStrategy =
  | 'data-testid' // Use data-testid attribute if present
  | 'data-ui-id' // Use data-ui-id attribute if present
  | 'semantic' // Generate semantic ID based on element content
  | 'auto' // Auto-generate unique ID
  | 'prefer-existing'; // Use existing attributes, fall back to auto

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
    button: [...baseActions, 'click', 'hover'],
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
    tab: [...baseActions, 'click', 'select'],
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
 * Generate semantic ID based on element
 */
function generateSemanticId(element: HTMLElement): string {
  const type = inferElementType(element);
  const label = getAccessibleLabel(element);

  if (label) {
    // Convert label to kebab-case ID
    const sanitized = label
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 30);
    return `${type}-${sanitized}`;
  }

  // Fall back to tag + index
  const parent = element.parentElement;
  if (parent) {
    const siblings = Array.from(parent.querySelectorAll(element.tagName));
    const index = siblings.indexOf(element);
    return `${element.tagName.toLowerCase()}-${index}`;
  }

  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
      return testId || generateAutoId(element);
    }
    case 'data-ui-id': {
      const uiId = element.getAttribute('data-ui-id');
      return uiId || generateAutoId(element);
    }
    case 'semantic':
      return generateSemanticId(element);
    case 'auto':
      return generateAutoId(element);
    case 'prefer-existing':
    default: {
      // Priority: data-ui-id > data-testid > id > semantic > auto
      const uiId = element.getAttribute('data-ui-id');
      if (uiId) return uiId;

      const testId = element.getAttribute('data-testid');
      if (testId) return testId;

      const htmlId = element.id;
      if (htmlId) return htmlId;

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
  } = options;

  const bridge = useUIBridgeOptional();
  const registeredElementsRef = useRef(new Map<HTMLElement, string>());
  const pendingRegistrationsRef = useRef(new Set<HTMLElement>());
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
   * Register a single element
   */
  const registerElement = useCallback(
    (element: HTMLElement): void => {
      if (!bridge?.registry || registeredElementsRef.current.has(element)) {
        return;
      }

      const id = generateIdForElement(element, idStrategy, customGenerateId);

      // Check if ID already exists in registry
      const existing = bridge.registry.getElement(id);
      if (existing) {
        // Generate a unique ID to avoid collision
        const uniqueId = `${id}-${Date.now().toString(36)}`;
        const type = inferElementType(element);
        const actions = inferActions(type);
        const label = getAccessibleLabel(element);

        bridge.registry.registerElement(uniqueId, element, {
          type,
          actions,
          label,
        });

        registeredElementsRef.current.set(element, uniqueId);
        onRegister?.(uniqueId, element);
      } else {
        const type = inferElementType(element);
        const actions = inferActions(type);
        const label = getAccessibleLabel(element);

        bridge.registry.registerElement(id, element, {
          type,
          actions,
          label,
        });

        registeredElementsRef.current.set(element, id);
        onRegister?.(id, element);
      }
    },
    [bridge, idStrategy, customGenerateId, onRegister]
  );

  /**
   * Unregister a single element
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
   * Scan and register all existing interactive elements
   */
  const scanAndRegister = useCallback(
    (rootElement: HTMLElement): void => {
      const allSelectors = [...INTERACTIVE_SELECTORS, ...includeSelectors].join(', ');
      const elements = rootElement.querySelectorAll<HTMLElement>(allSelectors);

      elements.forEach((element) => {
        if (shouldRegister(element)) {
          queueRegistration(element);
        }
      });
    },
    [includeSelectors, shouldRegister, queueRegistration]
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

            // Check the element itself
            if (shouldRegister(element)) {
              queueRegistration(element);
            }

            // Check descendants
            const allSelectors = [...INTERACTIVE_SELECTORS, ...includeSelectors].join(', ');
            const descendants = element.querySelectorAll<HTMLElement>(allSelectors);
            descendants.forEach((descendant) => {
              if (shouldRegister(descendant)) {
                queueRegistration(descendant);
              }
            });
          }
        });

        // Handle removed nodes
        mutation.removedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as HTMLElement;

            // Unregister the element itself
            if (registeredElementsRef.current.has(element)) {
              unregisterElement(element);
            }

            // Unregister descendants
            const descendants = element.querySelectorAll<HTMLElement>('*');
            descendants.forEach((descendant) => {
              if (registeredElementsRef.current.has(descendant)) {
                unregisterElement(descendant);
              }
            });
          }
        });
      });
    },
    [shouldRegister, queueRegistration, unregisterElement, includeSelectors]
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

      // Unregister all elements
      registeredElementsRef.current.forEach((id, _element) => {
        bridge.registry.unregisterElement(id);
      });
      registeredElementsRef.current.clear();
    };
  }, [enabled, bridge, root, scanAndRegister, handleMutations]);
}

export default useAutoRegister;
