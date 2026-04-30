/**
 * `<State>` JSX wrapper.
 *
 * Authoring-time sugar around {@link useUIState}. The build plugin extracts
 * `<State id="..." name="..." metadata={{...}}>` invocations into IR; at
 * runtime the wrapper compiles to a `useUIState` call so behavior is
 * delegated to the existing hook (no parallel registry, no behavior drift).
 *
 * Per Phase 4 / UI Bridge Redesign Section 1: this wrapper is purely
 * additive — `useUIState` continues to work identically for callers that
 * skip the JSX layer.
 *
 * @example
 * ```tsx
 * function LoginPage() {
 *   return (
 *     <State
 *       id="login-form"
 *       name="Login Form"
 *       elements={['email-input', 'password-input', 'submit-btn']}
 *       metadata={{
 *         description: 'Form for authenticating existing users',
 *         tags: ['auth', 'form'],
 *       }}
 *     >
 *       <form>
 *         <input id="email-input" />
 *         <input id="password-input" type="password" />
 *         <button id="submit-btn">Log in</button>
 *       </form>
 *     </State>
 *   );
 * }
 * ```
 */

import { Fragment, type ReactElement, type ReactNode } from 'react';
import { useUIState, type UseUIStateOptions } from './useUIState';

/**
 * Props for the {@link State} component. Extends every option of
 * {@link UseUIStateOptions} so the wrapper is a strict superset of the
 * underlying hook.
 */
export interface StateProps extends UseUIStateOptions {
  /** Children rendered as-is — the wrapper has no DOM impact. */
  children?: ReactNode;
}

/**
 * Declarative wrapper for {@link useUIState}. Renders a `Fragment` so it has
 * no DOM impact; runtime behavior is delegated entirely to the underlying
 * hook.
 */
export function State({ children, ...options }: StateProps): ReactElement {
  useUIState(options);
  return <Fragment>{children}</Fragment>;
}

State.displayName = 'UIBridge.State';
