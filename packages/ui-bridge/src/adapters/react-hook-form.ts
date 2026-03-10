/**
 * React Hook Form Adapter
 *
 * Extracts form state from React Hook Form's internal state, bypassing
 * DOM heuristics for perfect accuracy. Uses multiple strategies:
 *
 * 1. `window.__RHF_DEVTOOLS__` — when RHF DevTools extension is installed
 * 2. React fiber tree walking — finds useForm state in component fibers
 * 3. DOM fallback — RHF-specific selectors and data attributes
 *
 * For guaranteed accuracy, apps can expose their form instances via
 * `window.__UI_BRIDGE_RHF_FORMS__` as a Map<string, UseFormReturn>.
 * The adapter will prefer this over fiber walking.
 *
 * @example
 * ```ts
 * import { createAdapterRegistry, ReactHookFormAdapter } from '@qontinui/ui-bridge';
 *
 * const registry = createAdapterRegistry();
 * registry.register(new ReactHookFormAdapter());
 * ```
 *
 * For guaranteed accuracy in your app:
 * ```ts
 * // In your app code — expose form instances on a well-known global
 * const form = useForm({ defaultValues: { email: '', password: '' } });
 *
 * useEffect(() => {
 *   window.__UI_BRIDGE_RHF_FORMS__ = window.__UI_BRIDGE_RHF_FORMS__ || new Map();
 *   window.__UI_BRIDGE_RHF_FORMS__.set('login-form', form);
 *   return () => { window.__UI_BRIDGE_RHF_FORMS__?.delete('login-form'); };
 * }, [form]);
 * ```
 *
 * If no explicit instances are provided, the adapter falls back to
 * RHF DevTools (`window.__RHF_DEVTOOLS__`) and React fiber walking
 * to auto-detect forms on the page.
 */

import type { FormFieldState, FormState } from '../ai/types';
import type { AdapterFieldError, FormFrameworkAdapter } from './types';

/* -------------------------------------------------------------------------- */
/*  Global augmentation for RHF-specific window properties                    */
/* -------------------------------------------------------------------------- */

/** Minimal shape of a React Hook Form `UseFormReturn` we depend on */
interface RHFFormInstance {
  formState: {
    errors: Record<string, RHFFieldError | undefined>;
    touchedFields: Record<string, boolean | undefined>;
    dirtyFields: Record<string, boolean | undefined>;
    isValid: boolean;
    isDirty: boolean;
  };
  getValues: () => Record<string, unknown>;
}

interface RHFFieldError {
  message?: string;
  type?: string;
  types?: Record<string, string | boolean>;
}

/** Shape exposed by RHF DevTools */
interface RHFDevTools {
  forms?: Map<string, RHFFormInstance> | Record<string, RHFFormInstance>;
}

/** Augment the global Window interface */
declare global {
  interface Window {
    /** RHF DevTools extension */
    __RHF_DEVTOOLS__?: RHFDevTools;
    /** Explicit form instances provided by the app for guaranteed accuracy */
    __UI_BRIDGE_RHF_FORMS__?: Map<string, RHFFormInstance>;
    /** React DevTools hook (used for fiber walking) */
    __REACT_DEVTOOLS_GLOBAL_HOOK__?: {
      renderers?: Map<number, { findFiberByHostInstance?: (instance: Element) => unknown }>;
    };
  }
}

/** Minimal React fiber node shape */
interface Fiber {
  memoizedState: MemoizedState | null;
  return: Fiber | null;
  stateNode: Element | null;
  child: Fiber | null;
  sibling: Fiber | null;
  tag: number;
  type: unknown;
}

interface MemoizedState {
  memoizedState: unknown;
  queue: unknown;
  next: MemoizedState | null;
}

/* -------------------------------------------------------------------------- */
/*  Adapter implementation                                                    */
/* -------------------------------------------------------------------------- */

export class ReactHookFormAdapter implements FormFrameworkAdapter {
  readonly name = 'react-hook-form';

  /* ------ Cache (refreshed per detect cycle) ------------------------------ */

  private cachedInstances: Map<string, RHFFormInstance> | null = null;

  /* ------ Interface methods ---------------------------------------------- */

  detect(): boolean {
    // Strategy 1: explicit app-provided instances
    if (window.__UI_BRIDGE_RHF_FORMS__ && window.__UI_BRIDGE_RHF_FORMS__.size > 0) {
      return true;
    }

    // Strategy 2: RHF DevTools
    if (window.__RHF_DEVTOOLS__?.forms) {
      return true;
    }

    // Strategy 3: DOM markers — RHF doesn't add specific data attributes by
    // default, but many projects use data-rhf or the form element itself will
    // have noValidate (RHF typically sets this).
    if (document.querySelector('[data-rhf]') || document.querySelector('form[novalidate]')) {
      return true;
    }

    // Strategy 4: React fiber — look for forms on the page and check fibers
    const forms = document.querySelectorAll('form');
    for (const form of forms) {
      if (this.findRHFInstanceInFiber(form)) {
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
      const error = instance.formState.errors[fieldId];
      if (error) {
        return this.normalizeError(error);
      }
    }

    return null;
  }

  isFieldTouched(fieldId: string): boolean | null {
    const instances = this.getInstances();

    for (const instance of instances.values()) {
      const touched = instance.formState.touchedFields[fieldId];
      if (touched !== undefined) {
        return touched;
      }
    }

    return null;
  }

  isFieldDirty(fieldId: string): boolean | null {
    const instances = this.getInstances();

    for (const instance of instances.values()) {
      const dirty = instance.formState.dirtyFields[fieldId];
      if (dirty !== undefined) {
        return dirty;
      }
    }

    return null;
  }

  /* ------ Private helpers ------------------------------------------------- */

  /** Collect all RHF form instances from available sources */
  private getInstances(): Map<string, RHFFormInstance> {
    if (this.cachedInstances) {
      return this.cachedInstances;
    }

    const instances = new Map<string, RHFFormInstance>();

    // Source 1: explicit app-provided instances (highest priority)
    if (window.__UI_BRIDGE_RHF_FORMS__) {
      for (const [key, val] of window.__UI_BRIDGE_RHF_FORMS__) {
        instances.set(key, val);
      }
    }

    // Source 2: RHF DevTools
    if (window.__RHF_DEVTOOLS__?.forms && instances.size === 0) {
      const devForms = window.__RHF_DEVTOOLS__.forms;
      if (devForms instanceof Map) {
        for (const [key, val] of devForms) {
          instances.set(key, val);
        }
      } else {
        for (const [key, val] of Object.entries(devForms)) {
          instances.set(key, val);
        }
      }
    }

    // Source 3: React fiber walking (last resort)
    if (instances.size === 0) {
      const forms = document.querySelectorAll('form');
      let idx = 0;
      for (const form of forms) {
        const instance = this.findRHFInstanceInFiber(form);
        if (instance) {
          const id = form.id || form.getAttribute('name') || `rhf-form-${idx}`;
          instances.set(id, instance);
        }
        idx++;
      }
    }

    this.cachedInstances = instances;

    // Invalidate cache on next microtask so we always get fresh state
    // on the next call boundary
    Promise.resolve().then(() => {
      this.cachedInstances = null;
    });

    return instances;
  }

  /** Walk React fiber tree to find RHF's useForm state */
  private findRHFInstanceInFiber(element: Element): RHFFormInstance | null {
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    if (!hook?.renderers) return null;

    for (const renderer of hook.renderers.values()) {
      if (!renderer.findFiberByHostInstance) continue;

      try {
        let fiber = renderer.findFiberByHostInstance(element) as Fiber | null;
        // Walk up the fiber tree looking for a component with RHF-shaped memoized state
        let depth = 0;
        const maxDepth = 30;
        while (fiber && depth < maxDepth) {
          const instance = this.extractRHFFromFiber(fiber);
          if (instance) return instance;
          fiber = fiber.return;
          depth++;
        }
      } catch {
        // Fiber walking can fail for many reasons — continue
      }
    }

    return null;
  }

  /** Check if a fiber node contains RHF-shaped state */
  private extractRHFFromFiber(fiber: Fiber): RHFFormInstance | null {
    // React Hook Form stores its control object in hooks.
    // We look for a memoizedState chain that has the RHF shape:
    // { formState, getValues, ... }
    let hookState = fiber.memoizedState;
    let hookIdx = 0;
    const maxHooks = 50;

    while (hookState && hookIdx < maxHooks) {
      const val = hookState.memoizedState;
      if (this.isRHFInstance(val)) {
        return val as RHFFormInstance;
      }
      // Also check if the value is wrapped (some versions wrap in arrays)
      if (Array.isArray(val) && val.length > 0 && this.isRHFInstance(val[0])) {
        return val[0] as RHFFormInstance;
      }
      hookState = hookState.next;
      hookIdx++;
    }

    return null;
  }

  /** Shape-check: does this value look like a UseFormReturn? */
  private isRHFInstance(val: unknown): val is RHFFormInstance {
    if (!val || typeof val !== 'object') return false;
    const obj = val as Record<string, unknown>;
    return (
      typeof obj.getValues === 'function' &&
      obj.formState !== null &&
      typeof obj.formState === 'object' &&
      'errors' in (obj.formState as Record<string, unknown>) &&
      'touchedFields' in (obj.formState as Record<string, unknown>) &&
      'dirtyFields' in (obj.formState as Record<string, unknown>)
    );
  }

  /** Convert an RHF form instance to the UI Bridge FormState shape */
  private instanceToFormState(formId: string, instance: RHFFormInstance): FormState {
    const values = instance.getValues();
    const { errors, touchedFields, dirtyFields, isValid, isDirty } = instance.formState;

    const fields: FormFieldState[] = [];

    for (const [name, value] of Object.entries(values)) {
      const error = errors[name];
      const touched = touchedFields[name] ?? false;
      const dirty = dirtyFields[name] ?? false;

      // Try to find the corresponding DOM element for label/type info
      const domField = document.querySelector(`[name="${name}"], #${CSS.escape(name)}`) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
        | null;

      const placeholder = domField && 'placeholder' in domField ? domField.placeholder : undefined;

      const fieldState: FormFieldState = {
        id: name,
        label: this.getFieldLabel(name, domField),
        type: domField?.type || 'text',
        value: this.stringifyValue(value),
        valid: !error,
        error: error?.message || undefined,
        required: domField?.required ?? false,
        touched,
        placeholder: placeholder || undefined,
        isDirty: dirty,
      };

      if (domField instanceof HTMLInputElement) {
        if (domField.type === 'checkbox' || domField.type === 'radio') {
          fieldState.checked = domField.checked;
        }
      }

      if (domField instanceof HTMLSelectElement) {
        fieldState.selectedOptions = Array.from(domField.selectedOptions).map((opt) => opt.value);
      }

      fields.push(fieldState);
    }

    return {
      id: formId,
      name: formId,
      fields,
      isValid,
      isDirty: isDirty,
    };
  }

  /** Normalize an RHF error into AdapterFieldError[] */
  private normalizeError(error: RHFFieldError): AdapterFieldError[] {
    const errors: AdapterFieldError[] = [];

    if (error.types) {
      // Multiple validation errors
      for (const [type, msg] of Object.entries(error.types)) {
        if (typeof msg === 'string') {
          errors.push({ message: msg, type });
        } else {
          errors.push({ message: '', type });
        }
      }
    } else {
      errors.push({
        message: error.message || '',
        type: error.type || 'validation',
      });
    }

    return errors;
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
        // Remove the input's own text from the label
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
