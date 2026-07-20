/**
 * Formik Adapter
 *
 * Extracts form state from Formik's internal state, bypassing DOM heuristics
 * for perfect accuracy. Uses multiple strategies:
 *
 * 1. `window.__UI_BRIDGE_FORMIK_FORMS__` — explicit app-provided instances
 * 2. React fiber tree walking — finds Formik context providers in component fibers
 * 3. DOM fallback — Formik-specific data attributes
 *
 * For guaranteed accuracy, apps can expose their Formik instances via
 * `window.__UI_BRIDGE_FORMIK_FORMS__` as a Map<string, FormikContextType>.
 *
 * @example
 * ```ts
 * import { createAdapterRegistry, FormikAdapter } from '@qontinui/ui-bridge';
 *
 * const registry = createAdapterRegistry();
 * registry.register(new FormikAdapter());
 * ```
 *
 * For guaranteed accuracy in your app:
 * ```ts
 * // In your app code, inside a Formik context
 * const formik = useFormikContext();
 *
 * useEffect(() => {
 *   window.__UI_BRIDGE_FORMIK_FORMS__ = window.__UI_BRIDGE_FORMIK_FORMS__ || new Map();
 *   window.__UI_BRIDGE_FORMIK_FORMS__.set('signup-form', formik);
 *   return () => { window.__UI_BRIDGE_FORMIK_FORMS__?.delete('signup-form'); };
 * }, [formik]);
 * ```
 *
 * If no explicit instances are provided, the adapter falls back to
 * Formik-specific DOM attributes (`data-formik-id`, `data-formik`) and
 * React fiber walking to auto-detect forms on the page.
 */

import type { FormFieldState, FormState } from '../ai/types';
import type { AdapterFieldError, FormFrameworkAdapter } from './types';
import {
  verdictOf,
  verdictFailClosed,
  scrubContentRequired,
  scrubValueRequired,
  scrubContentByVerdict,
} from '../core/redaction';

/* -------------------------------------------------------------------------- */
/*  Formik-specific types                                                     */
/* -------------------------------------------------------------------------- */

/** Minimal shape of Formik's context/state we depend on */
interface FormikInstance {
  values: Record<string, unknown>;
  errors: Record<string, string | undefined>;
  touched: Record<string, boolean | undefined>;
  dirty: boolean;
  isValid: boolean;
  initialValues: Record<string, unknown>;
}

/** Augment the global Window interface */
declare global {
  interface Window {
    /** Explicit Formik instances provided by the app for guaranteed accuracy */
    __UI_BRIDGE_FORMIK_FORMS__?: Map<string, FormikInstance>;
  }
}

/** Minimal React fiber node shape */
interface Fiber {
  memoizedState: MemoizedState | null;
  memoizedProps: Record<string, unknown> | null;
  return: Fiber | null;
  stateNode: Element | null;
  child: Fiber | null;
  sibling: Fiber | null;
  tag: number;
  type: FiberType | string | null;
}

interface FiberType {
  displayName?: string;
  name?: string;
  _context?: {
    _currentValue?: unknown;
  };
}

interface MemoizedState {
  memoizedState: unknown;
  queue: unknown;
  next: MemoizedState | null;
}

/* -------------------------------------------------------------------------- */
/*  Adapter implementation                                                    */
/* -------------------------------------------------------------------------- */

export class FormikAdapter implements FormFrameworkAdapter {
  readonly name = 'formik';

  /* ------ Cache (refreshed per detect cycle) ------------------------------ */

  private cachedInstances: Map<string, FormikInstance> | null = null;

  /* ------ Interface methods ---------------------------------------------- */

  detect(): boolean {
    // Strategy 1: explicit app-provided instances
    if (window.__UI_BRIDGE_FORMIK_FORMS__ && window.__UI_BRIDGE_FORMIK_FORMS__.size > 0) {
      return true;
    }

    // Strategy 2: Formik-specific DOM attributes
    if (document.querySelector('[data-formik-id]') || document.querySelector('[data-formik]')) {
      return true;
    }

    // Strategy 3: Formik renders forms — walk fibers on form elements
    const forms = document.querySelectorAll('form');
    for (const form of forms) {
      if (this.findFormikInstanceInFiber(form)) {
        return true;
      }
    }

    return false;
  }

  extractForms(): FormState[] {
    const instances = this.getInstances();
    const result: FormState[] = [];

    for (const [formId, instance] of instances) {
      try {
        result.push(this.instanceToFormState(formId, instance));
      } catch {
        // Skip forms whose state we cannot read
      }
    }

    return result;
  }

  getFieldErrors(fieldId: string): AdapterFieldError[] | null {
    const instances = this.getInstances();

    for (const instance of instances.values()) {
      const error = instance.errors[fieldId];
      if (error) {
        return [{ message: error, type: 'validation' }];
      }
    }

    return null;
  }

  isFieldTouched(fieldId: string): boolean | null {
    const instances = this.getInstances();

    for (const instance of instances.values()) {
      const touched = instance.touched[fieldId];
      if (touched !== undefined) {
        return touched;
      }
    }

    return null;
  }

  isFieldDirty(fieldId: string): boolean | null {
    const instances = this.getInstances();

    for (const instance of instances.values()) {
      const currentValue = instance.values[fieldId];
      const initialValue = instance.initialValues[fieldId];

      if (currentValue !== undefined) {
        return currentValue !== initialValue;
      }
    }

    return null;
  }

  /* ------ Private helpers ------------------------------------------------- */

  /** Collect all Formik form instances from available sources */
  private getInstances(): Map<string, FormikInstance> {
    if (this.cachedInstances) {
      return this.cachedInstances;
    }

    const instances = new Map<string, FormikInstance>();

    // Source 1: explicit app-provided instances (highest priority)
    if (window.__UI_BRIDGE_FORMIK_FORMS__) {
      for (const [key, val] of window.__UI_BRIDGE_FORMIK_FORMS__) {
        instances.set(key, val);
      }
    }

    // Source 2: React fiber walking
    if (instances.size === 0) {
      const forms = document.querySelectorAll('form');
      let idx = 0;
      for (const form of forms) {
        const instance = this.findFormikInstanceInFiber(form);
        if (instance) {
          const id = form.id || form.getAttribute('name') || `formik-form-${idx}`;
          instances.set(id, instance);
        }
        idx++;
      }
    }

    this.cachedInstances = instances;

    // Invalidate cache on next microtask so we always get fresh state
    Promise.resolve().then(() => {
      this.cachedInstances = null;
    });

    return instances;
  }

  /** Walk React fiber tree to find Formik context/state */
  private findFormikInstanceInFiber(element: Element): FormikInstance | null {
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook?.renderers) return null;

    for (const renderer of hook.renderers.values()) {
      if (!renderer.findFiberByHostInstance) continue;

      try {
        let fiber = renderer.findFiberByHostInstance(element) as Fiber | null;
        let depth = 0;
        const maxDepth = 30;

        while (fiber && depth < maxDepth) {
          const instance = this.extractFormikFromFiber(fiber);
          if (instance) return instance;
          fiber = fiber.return;
          depth++;
        }
      } catch {
        // Fiber walking can fail — continue
      }
    }

    return null;
  }

  /** Check if a fiber node contains Formik-shaped state */
  private extractFormikFromFiber(fiber: Fiber): FormikInstance | null {
    // Formik v2 uses a context provider. Look for Formik's context value
    // in the fiber's memoizedProps or via context providers.

    // Check if this is a Formik context provider
    if (fiber.type && typeof fiber.type === 'object') {
      const fiberType = fiber.type as FiberType;
      const name = fiberType.displayName || fiberType.name || '';

      // Formik's context provider
      if (name === 'FormikProvider' || name === 'Formik') {
        // The context value is typically in memoizedProps.value
        const props = fiber.memoizedProps;
        if (props && this.isFormikInstance(props.value)) {
          return props.value as FormikInstance;
        }
      }

      // Check context _currentValue
      if (fiberType._context?._currentValue) {
        if (this.isFormikInstance(fiberType._context._currentValue)) {
          return fiberType._context._currentValue as FormikInstance;
        }
      }
    }

    // Also walk hooks for useFormik state
    let hookState = fiber.memoizedState;
    let hookIdx = 0;
    const maxHooks = 50;

    while (hookState && hookIdx < maxHooks) {
      const val = hookState.memoizedState;
      if (this.isFormikInstance(val)) {
        return val as FormikInstance;
      }
      hookState = hookState.next;
      hookIdx++;
    }

    return null;
  }

  /** Shape-check: does this value look like a Formik context? */
  private isFormikInstance(val: unknown): val is FormikInstance {
    if (!val || typeof val !== 'object') return false;
    const obj = val as Record<string, unknown>;
    return (
      obj.values !== null &&
      typeof obj.values === 'object' &&
      obj.errors !== null &&
      typeof obj.errors === 'object' &&
      obj.touched !== null &&
      typeof obj.touched === 'object' &&
      typeof obj.dirty === 'boolean' &&
      typeof obj.isValid === 'boolean' &&
      obj.initialValues !== null &&
      typeof obj.initialValues === 'object'
    );
  }

  /** Convert a Formik instance to the UI Bridge FormState shape */
  private instanceToFormState(formId: string, instance: FormikInstance): FormState {
    const { values, errors, touched, dirty, isValid, initialValues } = instance;

    const fields: FormFieldState[] = [];

    for (const [name, value] of Object.entries(values)) {
      const error = errors[name];
      const isTouched = touched[name] ?? false;
      const isDirty = value !== initialValues[name];

      // Try to find the corresponding DOM element for label/type info
      const domField = document.querySelector(`[name="${name}"], #${CSS.escape(name)}`) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
        | null;

      const placeholder = domField && 'placeholder' in domField ? domField.placeholder : undefined;

      // §4.6: the value comes from the FORMIK STORE (`stringifyValue`), which no
      // DOM scrub reaches — gate it here against the field's DOM node. FAIL
      // CLOSED when `domField` is null (registered-but-unmounted): there is no
      // element to test, so redact rather than ship a store value un-gated.
      const verdict = domField ? verdictOf(domField) : verdictFailClosed();
      const fieldState: FormFieldState = {
        id: name,
        label: scrubContentRequired(this.getFieldLabel(name, domField), verdict),
        type: domField?.type || 'text',
        value: scrubValueRequired(this.stringifyValue(value), verdict),
        valid: !error,
        error: scrubContentByVerdict(error || undefined, verdict),
        required: domField?.required ?? false,
        touched: isTouched,
        placeholder: scrubContentByVerdict(placeholder || undefined, verdict),
        isDirty,
      };

      if (domField instanceof HTMLInputElement) {
        if (domField.type === 'checkbox' || domField.type === 'radio') {
          fieldState.checked = domField.checked;
        }
      }

      if (domField instanceof HTMLSelectElement) {
        fieldState.selectedOptions = Array.from(domField.selectedOptions).map((opt) =>
          scrubValueRequired(opt.value, verdict)
        );
      }

      fields.push(fieldState);
    }

    return {
      id: formId,
      name: formId,
      fields,
      isValid,
      isDirty: dirty,
    };
  }

  /** Best-effort field label extraction */
  private getFieldLabel(name: string, domField: HTMLElement | null): string {
    if (domField) {
      // Check for aria-label
      const ariaLabel = domField.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;

      // Check for associated <label>
      const id = domField.id;
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label?.textContent) return label.textContent.trim();
      }

      // Check for wrapping <label>
      const parentLabel = domField.closest('label');
      if (parentLabel?.textContent) {
        const clone = parentLabel.cloneNode(true) as HTMLElement;
        const inputs = clone.querySelectorAll('input, select, textarea');
        inputs.forEach((el) => el.remove());
        const text = clone.textContent?.trim();
        if (text) return text;
      }
    }

    // Fall back to humanizing the field name
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase())
      .trim();
  }

  /** Stringify a form value for the FormFieldState shape */
  private stringifyValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}
