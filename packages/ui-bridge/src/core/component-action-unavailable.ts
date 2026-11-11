/**
 * The refusal a `useUIComponent` handler wrapper throws when the latest
 * committed render provides no handler for the action it was called with. Both
 * hooks in this package throw it: the web one (`react/useUIComponent.ts`) and
 * the native one (`native/react/useUIComponent.ts`).
 *
 * The registry learns that a render withdrew an action from a passive effect,
 * after the commit that withdrew it; for a non-discrete update that can be a
 * whole task later (always, under React 19, whose scheduler yields after every
 * commit). A call landing in between still finds the action listed. Running a
 * handler captured at an earlier publish could act on an item the screen no
 * longer shows, and reporting success with no handler run would be a lie, so
 * the wrapper refuses.
 *
 * What the caller gets back depends on the executor. The web executor answers
 * this refusal the way it answers an action the registry does not list, which
 * is what the same call gets once the registry has caught up:
 * `success: false` under `UB-UNSUPPORTED-ACTION`, with no stack. The native
 * executor has no error codes; it answers any handler throw with
 * `success: false`, the throw's message and its `stack`.
 *
 * Recognised by a `Symbol.for` brand, not by `instanceof`: tsup bundles every
 * entry point on its own (`splitting: false`), so the hook that throws and the
 * executor that catches can each hold a different copy of this class.
 */

const BRAND = Symbol.for('@qontinui/ui-bridge/component-action-unavailable');

export class ComponentActionUnavailableError extends Error {
  readonly componentId: string;
  readonly actionId: string;

  constructor(componentId: string, actionId: string) {
    super(
      `Action "${actionId}" is no longer declared by component "${componentId}": ` +
        'its latest committed render withdrew it. Read the component again before calling one of its actions.'
    );
    this.name = 'ComponentActionUnavailableError';
    this.componentId = componentId;
    this.actionId = actionId;
    Object.defineProperty(this, BRAND, { value: true });
  }

  /** True for this refusal, whichever bundled copy of the class threw it. */
  static is(error: unknown): error is ComponentActionUnavailableError {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as Record<symbol, unknown>)[BRAND] === true
    );
  }
}
