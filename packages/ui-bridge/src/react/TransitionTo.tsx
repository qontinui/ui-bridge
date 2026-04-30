/**
 * `<TransitionTo>` JSX wrapper.
 *
 * Authoring-time sugar around {@link useUITransition}. The component name
 * reflects the destination — the `activateStates` set — so callers read as
 * "transition to <these states>" at the call site.
 *
 * Like `<State>`, this wrapper compiles to a hook call at runtime; build
 * plugins extract the JSX into IR. Renders a `Fragment` so it has no DOM
 * impact.
 *
 * @example
 * ```tsx
 * function LoginButton() {
 *   return (
 *     <TransitionTo
 *       id="open-login"
 *       name="Open Login"
 *       fromStates={['landing']}
 *       activateStates={['login-form']}
 *       exitStates={['landing']}
 *       effect="read"
 *       metadata={{ description: 'Navigate from landing to the login form' }}
 *     >
 *       <button>Log in</button>
 *     </TransitionTo>
 *   );
 * }
 * ```
 */

import { Fragment, type ReactElement, type ReactNode } from 'react';
import { useUITransition, type UseUITransitionOptions } from './useUITransition';

/**
 * Props for the {@link TransitionTo} component. Extends every option of
 * {@link UseUITransitionOptions} so the wrapper is a strict superset of the
 * underlying hook.
 */
export interface TransitionToProps extends UseUITransitionOptions {
  /** Children rendered as-is — the wrapper has no DOM impact. */
  children?: ReactNode;
}

/**
 * Declarative wrapper for {@link useUITransition}. Renders a `Fragment` so
 * it has no DOM impact; runtime behavior is delegated entirely to the
 * underlying hook.
 */
export function TransitionTo({ children, ...options }: TransitionToProps): ReactElement {
  useUITransition(options);
  return <Fragment>{children}</Fragment>;
}

TransitionTo.displayName = 'UIBridge.TransitionTo';
