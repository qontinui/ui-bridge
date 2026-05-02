/**
 * `<State>` JSX wrapper (native).
 *
 * Build-time marker for the IR extractor. Mirrors the web SDK's
 * `<State>` shape so the same ts-morph extractor (which matches purely
 * on tag name) can pull the same fields out of mobile TSX sources.
 *
 * v1 scope (Section 4 spike): wrappers are pure markers — they render
 * `<>{children}</>` and do NOT couple to the native registry. Authoring
 * registration goes through the existing `useUIElement` / `useUIComponent`
 * hooks. The job of these wrappers in this phase is to expose stable JSX
 * declarations that the build-time extractor can match.
 *
 * `displayName` is set to `'UIBridge.State'` for parity with the web SDK
 * (the extractor matches both `<State>` and `<UIBridge.State>` tags).
 *
 * @example
 * ```tsx
 * function SettingsScreen() {
 *   return (
 *     <State
 *       id="settings-account-section"
 *       name="Account Section"
 *       requiredElements={[{ text: 'Account' }, { id: 'settings-user-info' }]}
 *       description="Account section with user info, API URL, and Sign Out."
 *     >
 *       <View>...</View>
 *     </State>
 *   );
 * }
 * ```
 */

import { Fragment, type ReactElement, type ReactNode } from 'react';

/**
 * A required-element shape used by `<State>`. Matches the IR shape so the
 * build-time extractor can pull the prop straight through.
 */
export interface StateRequiredElement {
  role?: string;
  text?: string;
  id?: string;
}

/**
 * Props for the {@link State} component (native). The shape mirrors the IR
 * field layout so the ts-morph extractor produces byte-identical output to
 * the web SDK's `<State>` declarations.
 */
export interface StateProps {
  /** Stable IR id for this state. Required. */
  id: string;
  /** Human-readable state name. Required. */
  name: string;
  /** Elements that must be present for this state to be active. */
  requiredElements?: StateRequiredElement[];
  /** Free-form description, surfaced in tooling and IR. */
  description?: string;
  /** When true, this state blocks navigation until exited (modals, etc.). */
  blocking?: boolean;
  /** Other state ids that this state blocks while active. */
  blocks?: string[];
  /** Optional grouping label for related states. */
  group?: string;
  /** Path-cost weight used by pathfinding (lower = preferred). */
  pathCost?: number;
  /** Free-form structured metadata, surfaced in IR provenance. */
  metadata?: Record<string, unknown>;
  /** Children rendered as-is — the wrapper has no native impact. */
  children?: ReactNode;
}

/**
 * Build-time marker for a state declaration. Renders a `Fragment` so it
 * has no native-tree impact; the extractor reads the props at build time.
 */
export function State({ children }: StateProps): ReactElement {
  return <Fragment>{children}</Fragment>;
}

State.displayName = 'UIBridge.State';
