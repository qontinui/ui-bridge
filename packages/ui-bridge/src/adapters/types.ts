/**
 * Framework Adapter Types
 *
 * Defines the interface for opt-in form framework adapters that extract
 * form state directly from library internals (React Hook Form, Formik, etc.),
 * bypassing DOM heuristics for perfect accuracy.
 *
 * Adapters are opt-in: users register them explicitly. Each adapter is a
 * separate import so unused adapters are tree-shaken.
 */

import type { FormFieldState, FormState } from '../ai/types';

// Re-export for convenience so adapter authors don't need to import from ai/types
export type { FormFieldState, FormState };

/** Error information extracted from a framework adapter */
export interface AdapterFieldError {
  /** Human-readable error message */
  message: string;
  /** Error type/rule name (e.g., 'required', 'minLength', 'custom') */
  type: string;
}

/** Adapter for extracting form state from a specific form library */
export interface FormFrameworkAdapter {
  /** Unique name of the adapter (e.g., 'react-hook-form', 'formik') */
  readonly name: string;

  /** Check if this adapter can handle the current page/form */
  detect(): boolean;

  /** Extract form states from the framework's internal state */
  extractForms(): FormState[];

  /** Get validation errors for a specific field */
  getFieldErrors(fieldId: string): AdapterFieldError[] | null;

  /** Check if a specific field has been touched/interacted with */
  isFieldTouched(fieldId: string): boolean | null;

  /** Check if a specific field's value differs from its initial value */
  isFieldDirty(fieldId: string): boolean | null;
}

/** Registry for framework adapters */
export interface AdapterRegistry {
  /** Register a framework adapter */
  register(adapter: FormFrameworkAdapter): void;

  /** Unregister a framework adapter by name */
  unregister(name: string): void;

  /** Get a specific adapter by name */
  getAdapter(name: string): FormFrameworkAdapter | undefined;

  /** Run detection on all registered adapters, return those that match */
  detectAdapters(): FormFrameworkAdapter[];

  /** Get all registered adapters (whether detected or not) */
  getAllAdapters(): FormFrameworkAdapter[];
}
