/**
 * useUIComponent Hook
 *
 * Register a component with UI Bridge for component-level actions.
 */

import { useEffect, useCallback, useRef, useMemo } from 'react';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';
import type { IREffect, RegisteredComponent } from '../core/types';
import type { EffectSignature } from '../control/effect-types';
import { useUIBridgeOptional } from './UIBridgeProvider';

/**
 * Action definition for useUIComponent
 */
export interface ComponentActionDef<TParams = unknown, TResult = unknown> {
  /** Action identifier */
  id: string;
  /** Human-readable label */
  label?: string;
  /** Description */
  description?: string;
  /**
   * Parameter schema — **serialized, published to agents, and VALIDATED.**
   *
   * It is spread onto `/control/components` and `/control/component/:id`, and
   * four `qontinui-runner` consumers read it from there — including the LLM
   * router that generates a slash command's args from it. Since Phase 2 of
   * plan `2026-08-20-ui-bridge-action-declaration-shape` the invocation seam
   * checks `params` against it BEFORE your handler runs, so a schema declared
   * here is a promise the runtime keeps.
   *
   * (The doc this replaces promised both halves of a contradiction: the schema
   * is "surfaced verbatim on `/control/component/:id`" AND "No runtime
   * validation is performed." The first half was always true; the second is no
   * longer.)
   *
   * Two accepted shapes:
   *
   * - **Object-schema form** — `{ type: 'object', properties: { ... },
   *   required: ['...'], additionalProperties: false }`. The only form that can
   *   express *requiredness*. `paramSchemaOf()` from
   *   `@qontinui/ui-bridge-wrapper` emits it for you.
   * - **Map form** — `{ paramName: 'string', other: { type: 'number' } }`. A
   *   TYPE hint only: it cannot mark anything required, and a string that is
   *   not one of the seven JSON Schema primitive names (`string`, `number`,
   *   `integer`, `boolean`, `object`, `array`, `null`) is read as prose and
   *   constrains nothing — which is what keeps the fleet's many
   *   `{ count: 'number (>= 1, defaults to 1)' }` hint maps working.
   *
   * Recognised keywords: `type`, `enum`, `const`, `properties`, `required`,
   * `additionalProperties: false`, `items`, `minimum`/`maximum`,
   * `minLength`/`maxLength`, `pattern`. **Anything else is ignored, never
   * rejected** — a schema richer than the subset is still valid JSON Schema,
   * it just expresses fewer enforced constraints. No type coercion: `"5"` does
   * not satisfy `{ type: 'number' }`.
   *
   * Enforcement is a deployment setting and defaults to `'warn'` — violations
   * are logged and the handler still runs until someone calls
   * `setDefaultParamValidationMode('enforce')`. The full grammar, and why warn
   * is the default, are documented at `core/param-schema.ts`.
   */
  paramSchema?: Record<string, unknown>;
  /**
   * Safety annotation — `'read' | 'write' | 'destructive'` (Phase 4 of plan
   * `2026-08-20-ui-bridge-action-declaration-shape`).
   *
   * **Declare `'destructive'` on anything irreversible** — a delete, a send, a
   * charge, a deploy. It is the one value nothing can infer for you: the
   * static verb map behind this field never produces `'destructive'`, because
   * destructiveness depends on what your control does, not on what it is
   * called. An autonomous walk excludes destructive actions and walks
   * everything else, so an unmarked delete button gets clicked.
   *
   * **Precedence:** what you write here wins, and it is the **only** thing
   * that reaches the wire. `STANDARD_ACTION_EFFECTS` supplies a default when
   * the action `id` happens to be one of the 22 standard verbs (`click`,
   * `hover`, `submit`, …), but that default is applied **by the consumer**,
   * via the exported `resolveActionEffect()` — the SDK does *not* stamp it
   * onto the response. Leave this undefined and the field is simply **absent**
   * from every projection, which is the honest encoding of "nobody classified
   * this action" (see `core/action-effect.ts` for why a server-applied default
   * would fail open).
   *
   * Serialized verbatim on `/control/components`, `/control/component/:id`,
   * the `/control/snapshot` component projection, and the Tauri IPC
   * `get_components` / `get_component` commands.
   */
  effect?: IREffect;
  /**
   * D3 effect-calculus signature — what this action **predicts** will change
   * (Phase 5 of plan
   * `2026-09-04-effect-calculus-joins-the-component-action-registry`).
   *
   * `effect` above is the coarse three-value safety label; this is the fine
   * calculus. Declare one and every invocation of this action is wrapped in a
   * predict-then-verify cycle — pre-snapshot, handler, settle window,
   * post-snapshot — and the response carries an `effectVerification` saying
   * whether what you predicted is what happened. **Declaring it is itself the
   * opt-in**: no server-wide switch has to be flipped, because a prediction
   * nobody checks is not a prediction. A caller that needs the cost back can
   * send `verifyEffect: false` on the single request.
   *
   * Runtime-only, like `handler`: it holds a closure, so it never reaches the
   * wire. What reaches the wire is the outcome it produced.
   */
  signature?: EffectSignature;
  /**
   * Handler function.
   *
   * The second argument is the `ActionHandlerOptions` bag whose `signal` is
   * aborted when the caller cancels or the request's `timeoutMs` elapses
   * (Phase 3 of plan `2026-08-20-ui-bridge-action-declaration-shape`).
   * Observing it is optional: the executor races this promise against the
   * abort, so an unobservant handler is abandoned anyway — observing it is how
   * a handler releases its own in-flight work instead of leaving it detached.
   */
  handler: (params?: TParams, options?: { signal?: AbortSignal }) => TResult | Promise<TResult>;
}

/**
 * Computed property definition for useUIComponent
 */
export interface ComputedPropertyDef<T = unknown> {
  /** Getter function for the computed value */
  getter: () => T;
  /** Description of what the computed property represents */
  description?: string;
}

/**
 * useUIComponent options
 */
export interface UseUIComponentOptions {
  /** Unique identifier for the component */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description?: string;
  /**
   * Actions available on this component. Re-published when a label,
   * description, `paramSchema`, `effect` or the list itself changes, or when an
   * action gains or loses a `signature`. A changed handler needs no re-publish
   * because calls look up the latest one.
   */
  actions?: ComponentActionDef[];
  /** Child element IDs owned by this component */
  elementIds?: string[];
  /** Whether to automatically register on mount */
  autoRegister?: boolean;
  /**
   * Function to get the current component state. Called at read time through a
   * stable wrapper, so a fresh inline `() => ({ open })` on each render is read
   * as of the latest render, not the closure from registration.
   */
  state?: () => Record<string, unknown>;
  /** Computed properties exposed by the component */
  computed?: Record<string, ComputedPropertyDef | (() => unknown)>;
  /**
   * Discoverability scope (Phase 3.1, plan 2026-05-03). Defaults to
   * `'route'` (the historical behavior — components show up only while the
   * mounting page is active). Set to `'global'` to advertise the component
   * as intended for cross-route availability (e.g. a permanent overlay or
   * app-shell control). The field is plumbed through to listings/snapshots
   * for clients to consume; it does not currently change mount semantics.
   */
  scope?: 'global' | 'route';
}

/**
 * useUIComponent return value
 */
export interface UseUIComponentReturn {
  /** Whether the component is registered */
  registered: boolean;
  /** Execute an action on this component */
  executeAction: <TParams = unknown, TResult = unknown>(
    actionId: string,
    params?: TParams
  ) => Promise<TResult>;
  /** Manually register the component */
  register: () => void;
  /** Manually unregister the component */
  unregister: () => void;
  /**
   * Install an action list the `actions` option does not declare. It holds until
   * the declared actions change value or `id` changes, and then the declared list
   * wins. An action id in both lists runs whichever handler was supplied last.
   */
  updateActions: (actions: ComponentActionDef[]) => void;
  /** Add an element ID to this component */
  addElement: (elementId: string) => void;
  /** Remove an element ID from this component */
  removeElement: (elementId: string) => void;
  /** The registered component info */
  registeredComponent: RegisteredComponent | null;
}

/**
 * Value signature of what a bridge consumer can SEE of an action list. Handlers
 * and the `signature` closure are excluded: call sites pass fresh ones every
 * render, and calls look the latest handler up anyway. Whether a `signature`
 * exists is included, because that decides if an invocation is verified at all.
 *
 * Runs during render over `paramSchema`, typed `Record<string, unknown>`, so it
 * must not throw: a cyclic or BigInt value degrades to a signature that cannot
 * see schema changes rather than taking the consumer's tree down.
 */
function publishedActionsSignature(actions: ComponentActionDef[] | undefined): string {
  const list = actions ?? [];
  const head = (a: ComponentActionDef) => [
    a.id,
    a.label,
    a.description,
    a.effect,
    a.signature !== undefined,
  ];
  try {
    return JSON.stringify(list.map((a) => [...head(a), a.paramSchema]));
  } catch {
    return JSON.stringify(list.map(head));
  }
}

/**
 * useUIComponent hook
 *
 * Registers a component with UI Bridge for component-level control.
 * Components can expose high-level actions that may orchestrate multiple element interactions.
 *
 * @example
 * ```tsx
 * function LoginForm() {
 *   const [email, setEmail] = useState('');
 *   const [password, setPassword] = useState('');
 *
 *   useUIComponent({
 *     id: 'login-form',
 *     name: 'Login Form',
 *     actions: [
 *       {
 *         id: 'login',
 *         label: 'Submit Login',
 *         handler: async ({ email, password }) => {
 *           setEmail(email);
 *           setPassword(password);
 *           await submitLogin();
 *         },
 *       },
 *       {
 *         id: 'clear',
 *         label: 'Clear Form',
 *         handler: () => {
 *           setEmail('');
 *           setPassword('');
 *         },
 *       },
 *     ],
 *   });
 *
 *   return (
 *     <form>
 *       <input value={email} onChange={(e) => setEmail(e.target.value)} />
 *       <input value={password} onChange={(e) => setPassword(e.target.value)} />
 *       <button type="submit">Login</button>
 *     </form>
 *   );
 * }
 * ```
 */
export function useUIComponent(options: UseUIComponentOptions): UseUIComponentReturn {
  const bridge = useUIBridgeOptional();
  const registeredRef = useRef(false);
  const actionsRef = useRef(options.actions || []);
  const elementIdsRef = useRef(options.elementIds || []);
  const stateRef = useRef(options.state);
  const computedRef = useRef(options.computed);

  const { id, name, description, autoRegister = true, scope } = options;

  // Update refs when options change. Separate effects, not one: `actionsRef` and
  // `elementIdsRef` also hold writes from outside the option (`updateActions`,
  // `addElement`, auto-tracked owned elements), so sharing one dep list meant a
  // fresh inline `state` on every render reset them to the declared value, which
  // the update effect below then published over the registry's copy.

  // The declared list is tracked on identity, so calls reach the latest closures.
  const actionsSignature = publishedActionsSignature(options.actions);
  useEffect(() => {
    actionsRef.current = options.actions || [];
  }, [options.actions]);

  // An `updateActions` list is kept apart from it, or an inline `actions` array
  // would reset it on the next render and leave its extra actions listed but
  // unreachable. It holds until the declared actions change VALUE, which is when
  // the call site has said something newer, or until the id changes: it was
  // installed for the old one. Compared by hand rather than by effect deps, so a
  // list installed before this hook's first effect runs (from a child's effect)
  // and StrictMode's simulated remount both keep it.
  const imperativeActionsRef = useRef<ComponentActionDef[] | null>(null);
  const imperativeHoldKey = JSON.stringify([id, actionsSignature]);
  const imperativeHoldKeyRef = useRef(imperativeHoldKey);
  useEffect(() => {
    if (imperativeHoldKeyRef.current === imperativeHoldKey) return;
    imperativeHoldKeyRef.current = imperativeHoldKey;
    imperativeActionsRef.current = null;
  }, [imperativeHoldKey]);

  const publishedActions = useCallback(
    (): ComponentActionDef[] => imperativeActionsRef.current ?? actionsRef.current,
    []
  );
  // For an id in both lists, whichever handler was supplied last. A stable
  // declared list leaves the `updateActions` handler newest; an inline one
  // supplies a fresher closure on the next render.
  const declaredAtInstallRef = useRef<ComponentActionDef[] | null>(null);
  const findAction = useCallback((actionId: string): ComponentActionDef | undefined => {
    const declared = actionsRef.current.find((x) => x.id === actionId);
    const installed = imperativeActionsRef.current?.find((x) => x.id === actionId);
    return actionsRef.current === declaredAtInstallRef.current
      ? (installed ?? declared)
      : (declared ?? installed);
  }, []);

  // By VALUE for the same reason, and a new value keeps the auto-tracked elements:
  // they are still mounted and still owned, whatever the call site declares. An
  // `id` or `bridge` change starts over from the declared list: the auto-track
  // effect's cleanup has emptied the set by the time this runs, and its re-seed
  // finds whatever that registry says this id owns.
  const autoTrackedRef = useRef(new Set<string>());
  const declaredElementIdsRef = useRef(options.elementIds || []);
  const elementIdsSignature = JSON.stringify(options.elementIds ?? null);
  useEffect(() => {
    declaredElementIdsRef.current = options.elementIds || [];
    elementIdsRef.current = Array.from(
      new Set([...declaredElementIdsRef.current, ...autoTrackedRef.current])
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementIdsSignature, id, bridge]);

  useEffect(() => {
    stateRef.current = options.state;
    computedRef.current = options.computed;
  }, [options.state, options.computed]);

  // Stable state getter: always delegates to the latest `state` option. The
  // registry stores whatever function it is handed at register/update time,
  // so handing it `stateRef.current` directly pins an old render's closure
  // and later `state` changes (a fresh inline `() => ({ open })` per render)
  // are never read. Same stable-wrapper rule as the action handlers.
  const getLatestState = useCallback((): Record<string, unknown> => {
    const getState = stateRef.current;
    return getState ? getState() : {};
  }, []);

  // Create getComputed function from computed definitions
  const createGetComputed = useCallback(() => {
    return () => {
      const computed = computedRef.current;
      if (!computed) return {};

      const result: Record<string, unknown> = {};
      for (const [key, def] of Object.entries(computed)) {
        try {
          // Support both ComputedPropertyDef and plain getter functions
          const getter = typeof def === 'function' ? def : def.getter;
          result[key] = getter();
        } catch {
          result[key] = undefined;
        }
      }
      return result;
    };
  }, []);

  // See useUIState for rationale on capturing id at register time.
  const registeredComponentIdRef = useRef<string | null>(null);

  // Register the component
  const register = useCallback(() => {
    if (!bridge || registeredRef.current) return;

    bridge.registry.registerComponent(id, {
      name,
      description,
      actions: publishedActions().map((a) => {
        const actionId = a.id;
        return {
          id: actionId,
          label: a.label,
          description: a.description,
          paramSchema: a.paramSchema,
          // ⚠ RE-WRAP SITE with a CLOSED field list. Phase 4's `effect` and
          // Phase 5's `signature` die here if they are not named — the
          // wrapper type-checks either way.
          effect: a.effect,
          signature: a.signature,
          // Stable wrapper: always delegates to the latest handler in actionsRef
          // so that handlers closing over React state see current values, not
          // the stale closure captured at registration time.
          // Forwards BOTH arguments. Dropping `options` here would silently
          // strip the Phase 3 cancellation signal on its way to the author's
          // handler — the wrapper type-checks either way.
          handler: (params?: unknown, options?: { signal?: AbortSignal }) => {
            const current = findAction(actionId);
            return current?.handler(params, options);
          },
        };
      }),
      elementIds: elementIdsRef.current,
      getState: stateRef.current ? getLatestState : undefined,
      getComputed: createGetComputed(),
      scope,
    });
    registeredRef.current = true;
    registeredComponentIdRef.current = id;
  }, [
    bridge,
    id,
    name,
    description,
    scope,
    createGetComputed,
    getLatestState,
    publishedActions,
    findAction,
  ]);

  // Unregister the component
  const unregister = useCallback(() => {
    if (!bridge || !registeredRef.current) return;

    bridge.registry.unregisterComponent(registeredComponentIdRef.current ?? id);
    registeredRef.current = false;
    registeredComponentIdRef.current = null;
  }, [bridge, id]);

  // Execute an action
  const executeAction = useCallback(
    async <TParams = unknown, TResult = unknown>(
      actionId: string,
      params?: TParams
    ): Promise<TResult> => {
      if (!bridge) {
        throw new Error('UI Bridge not available');
      }

      const response = await bridge.executor.executeComponentAction(id, {
        action: actionId,
        params: params as Record<string, unknown>,
      });

      if (!response.success) {
        throw new Error(response.error || 'Action failed');
      }

      return response.result as TResult;
    },
    [bridge, id]
  );

  // Update actions dynamically
  const updateActions = useCallback(
    (actions: ComponentActionDef[]) => {
      imperativeActionsRef.current = actions;
      declaredAtInstallRef.current = actionsRef.current;

      // Re-register with updated actions if already registered
      if (registeredRef.current && bridge) {
        bridge.registry.unregisterComponent(id);
        registeredRef.current = false;
        register();
      }
    },
    [bridge, id, register]
  );

  // Add element ID
  const addElement = useCallback((elementId: string) => {
    if (!elementIdsRef.current.includes(elementId)) {
      elementIdsRef.current = [...elementIdsRef.current, elementId];
    }
  }, []);

  // Remove element ID
  const removeElement = useCallback((elementId: string) => {
    elementIdsRef.current = elementIdsRef.current.filter((id) => id !== elementId);
    autoTrackedRef.current.delete(elementId);
  }, []);

  // Keep latest register/unregister in refs so the auto-register effect does
  // not re-run on every parent render when consumers pass inline options
  // (inline `actions`/`elementIds`/`computed` arrays churn the `register`
  // callback identity, which would re-fire this effect and emit
  // `component:registered` per render — triggering the useSyncExternalStore
  // consumers to wake AppContent and re-render the component's tree in an
  // infinite loop (React error #185).
  const registerRef = useRef(register);
  const unregisterRef = useRef(unregister);
  useEffect(() => {
    registerRef.current = register;
    unregisterRef.current = unregister;
  }, [register, unregister]);

  // Auto-register on mount — depends only on [autoRegister, bridge] so it
  // doesn't re-run when register/unregister identity churns.
  useEffect(() => {
    if (autoRegister && bridge) {
      registerRef.current();
    }

    return () => {
      if (registeredRef.current) {
        unregisterRef.current();
      }
    };
  }, [autoRegister, bridge]);

  // Unregister AT COMMIT on unmount. A passive cleanup runs in a later task for
  // a non-discrete unmount, so until then the registry would still list this
  // component, answer its state and run its handlers although its DOM is gone.
  // Deps are [] on purpose: a churning `bridge` or an `id` change must keep the
  // atomic passive swap above, not unregister here and re-register a task later.
  // After this runs `registeredRef.current` is false, so the passive cleanup
  // above is a no-op, and under StrictMode the passive effect re-registers.
  const reregisterRef = useRef(false);
  useIsomorphicLayoutEffect(() => {
    // A Suspense boundary that re-suspends runs layout cleanups but keeps
    // passive effects mounted, then re-runs only layout mounts on reveal: put
    // back what this cleanup took out, or the entry would stay gone for good.
    if (reregisterRef.current) {
      reregisterRef.current = false;
      registerRef.current();
    }
    return () => {
      if (registeredRef.current) {
        unregisterRef.current();
        reregisterRef.current = true;
      }
    };
  }, []);

  // In-place option sync — see useUIState for rationale. Handlers, `getState`
  // and `getComputed` hold function references we intentionally exclude from
  // the key (identity churn would defeat the purpose); the refs already track
  // their latest values, and `updateComponent` reads those refs via the sync
  // call below. What the key does carry is everything an agent can SEE: the
  // published fields of each action, so a label with a count or an action that
  // exists only while a row is selected reaches `/control/components`, and
  // whether a `state` option exists, because `getState` is registered as
  // `undefined` without one and only this effect can install it later.
  const componentKey =
    bridge && registeredRef.current
      ? JSON.stringify({
          id,
          name,
          description: description ?? null,
          elementIds: options.elementIds ?? null,
          scope: scope ?? null,
          hasState: options.state !== undefined,
          actions: actionsSignature,
        })
      : null;
  useEffect(() => {
    if (!bridge || !registeredRef.current || componentKey === null) return;
    const payload = {
      name,
      description,
      actions: publishedActions().map((a) => {
        const actionId = a.id;
        return {
          id: actionId,
          label: a.label,
          description: a.description,
          paramSchema: a.paramSchema,
          // ⚠ RE-WRAP SITE with a CLOSED field list — the update-path twin of
          // the register path above. Phase 4's `effect` and Phase 5's
          // `signature` die here if they are not named.
          effect: a.effect,
          signature: a.signature,
          // Forwards BOTH arguments. Dropping `options` here would silently
          // strip the Phase 3 cancellation signal on its way to the author's
          // handler — the wrapper type-checks either way.
          handler: (params?: unknown, options?: { signal?: AbortSignal }) => {
            const current = findAction(actionId);
            return current?.handler(params, options);
          },
        };
      }),
      elementIds: elementIdsRef.current,
      getState: stateRef.current ? getLatestState : undefined,
      getComputed: createGetComputed(),
      scope,
    };
    const registeredComponentId = registeredComponentIdRef.current;
    if (registeredComponentId === null) return;
    if (registeredComponentId !== id) {
      bridge.registry.unregisterComponent(registeredComponentId);
      registeredComponentIdRef.current = id;
      bridge.registry.registerComponent(id, payload);
      return;
    }
    bridge.registry.updateComponent(id, payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, componentKey]);

  // Auto-track owned elements: subscribe to registry events and add/remove
  // element IDs whose `ownedByComponent` matches this component. Lets
  // `RegisteredComponent.elementIds` populate without consumers maintaining
  // it manually — works for both React-hook and DOM-auto-scanned elements
  // (they all flow through `registry.registerElement`).
  useEffect(() => {
    if (!bridge) return;
    const reg = bridge.registry as unknown as {
      on: (
        event: 'element:registered' | 'element:unregistered',
        listener: (event: { data: { id: string } }) => void
      ) => () => void;
      getElement?: (id: string) => { ownedByComponent?: string } | undefined;
      getAllElements?: () => Array<{ id: string; ownedByComponent?: string }>;
      updateComponent?: (id: string, opts: { elementIds?: string[] }) => boolean;
    };
    const tracked = autoTrackedRef.current;

    const publish = () => {
      reg.updateComponent?.(id, { elementIds: elementIdsRef.current });
    };
    // Appends to the current list rather than republishing a private copy of it,
    // so a declared id or an `addElement` written since mount is not dropped.
    const append = (elId: string) => {
      if (!elementIdsRef.current.includes(elId)) {
        elementIdsRef.current = [...elementIdsRef.current, elId];
      }
    };
    const track = (elId: string) => {
      tracked.add(elId);
      append(elId);
    };

    // Seed from any elements already registered that point at this component.
    for (const el of reg.getAllElements?.() ?? []) {
      if (el.ownedByComponent === id) track(el.id);
    }
    if (elementIdsRef.current.length > 0) publish();

    const offReg = reg.on('element:registered', (event) => {
      const elId = event.data.id;
      const el = reg.getElement?.(elId);
      if (el?.ownedByComponent === id) {
        if (tracked.has(elId)) return;
        track(elId);
        publish();
      } else if (
        declaredElementIdsRef.current.includes(elId) &&
        !elementIdsRef.current.includes(elId)
      ) {
        // A declared id the unregister path below removed, mounted again.
        append(elId);
        publish();
      }
    });
    const offUnreg = reg.on('element:unregistered', (event) => {
      const elId = event.data.id;
      // Only what this hook put there for the element's sake: an `addElement` id
      // stays listed across its element's unmount and remount.
      const wasTracked = tracked.delete(elId);
      const isDeclared = declaredElementIdsRef.current.includes(elId);
      if ((wasTracked || isDeclared) && elementIdsRef.current.includes(elId)) {
        elementIdsRef.current = elementIdsRef.current.filter((x) => x !== elId);
        publish();
      }
    });

    return () => {
      offReg();
      offUnreg();
      tracked.clear();
    };
  }, [bridge, id]);

  // Get registered component
  const registeredComponent = useMemo(() => {
    if (!bridge) return null;
    return bridge.registry.getComponent(id) || null;
  }, [bridge, id]);

  return {
    registered: registeredRef.current,
    executeAction,
    register,
    unregister,
    updateActions,
    addElement,
    removeElement,
    registeredComponent,
  };
}

/**
 * useUIComponentAction hook
 *
 * Create a stable action handler that can be used with useUIComponent.
 * Useful for memoizing action handlers.
 */
export function useUIComponentAction<TParams = unknown, TResult = unknown>(
  handler: (params?: TParams, options?: { signal?: AbortSignal }) => TResult | Promise<TResult>,
  deps: React.DependencyList
): (params?: TParams, options?: { signal?: AbortSignal }) => TResult | Promise<TResult> {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(handler, deps);
}
