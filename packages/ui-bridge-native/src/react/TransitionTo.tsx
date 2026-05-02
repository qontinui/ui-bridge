/**
 * `<TransitionTo>` JSX wrapper (native).
 *
 * Build-time marker for the IR extractor. Mirrors the web SDK's
 * `<TransitionTo>` shape so the same ts-morph extractor can pull the
 * same fields out of mobile TSX sources.
 *
 * Like `<State>`, this is a pure JSX marker for the Section 4 spike: it
 * renders `<>{children}</>` and does NOT couple to the native registry.
 * Runtime transition behavior continues to flow through the existing
 * native hooks; this component exists so build-time extraction has a
 * stable JSX surface to match.
 *
 * `displayName` is set to `'UIBridge.TransitionTo'` for parity with the
 * web SDK (the extractor matches both `<TransitionTo>` and
 * `<UIBridge.TransitionTo>` tags).
 *
 * @example
 * ```tsx
 * function SignOutButton() {
 *   return (
 *     <TransitionTo
 *       id="settings-sign-out"
 *       name="Sign Out"
 *       fromStates={['settings-account-section']}
 *       activateStates={['login']}
 *       exitStates={['settings-account-section']}
 *       effect="write"
 *     >
 *       <Pressable>...</Pressable>
 *     </TransitionTo>
 *   );
 * }
 * ```
 */

import { Fragment, type ReactElement, type ReactNode } from 'react';

/**
 * Props for the {@link TransitionTo} component (native). The shape mirrors
 * the IR field layout so the ts-morph extractor produces byte-identical
 * output to the web SDK's `<TransitionTo>` declarations.
 */
export interface TransitionToProps {
  /** Stable IR id for this transition. Required. */
  id: string;
  /** Human-readable transition name. Required. */
  name: string;
  /** State ids this transition can fire from. */
  fromStates?: string[];
  /** State ids this transition activates on success. */
  activateStates?: string[];
  /** State ids this transition exits on success. */
  exitStates?: string[];
  /** Action sequence executed by this transition. v1 keeps the shape opaque. */
  actions?: unknown[];
  /** Read = idempotent navigation, write = side-effecting mutation. */
  effect?: 'read' | 'write';
  /** Free-form description, surfaced in tooling and IR. */
  description?: string;
  /** Path-cost weight used by pathfinding (lower = preferred). */
  pathCost?: number;
  /** Free-form structured metadata, surfaced in IR provenance. */
  metadata?: Record<string, unknown>;
  /** Children rendered as-is — the wrapper has no native impact. */
  children?: ReactNode;
}

/**
 * Build-time marker for a transition declaration. Renders a `Fragment`
 * so it has no native-tree impact; the extractor reads the props at
 * build time.
 */
export function TransitionTo({ children }: TransitionToProps): ReactElement {
  return <Fragment>{children}</Fragment>;
}

TransitionTo.displayName = 'UIBridge.TransitionTo';
