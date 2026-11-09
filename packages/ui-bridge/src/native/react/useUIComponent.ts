/**
 * useUIComponent Hook for React Native
 *
 * Register a component with UI Bridge for component-level actions.
 */

import { useEffect, useLayoutEffect, useCallback, useRef, useState } from 'react';
import type { IREffect, RegisteredNativeComponent } from '../core/types';
import type { UpdateComponentMetaOptions } from '../core/registry';
import { useUIBridgeNativeOptional } from './UIBridgeNativeProvider';

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
   * everything else, so an unmarked delete control gets pressed.
   *
   * **Precedence:** what you write here wins, and it is the **only** thing
   * that reaches the wire. `NATIVE_STANDARD_ACTION_EFFECTS` supplies a default
   * when the action `id` happens to be one of the native standard verbs
   * (`press`, `longPress`, `swipe`, …), but that default is applied **by the
   * consumer**, via the exported `resolveActionEffect()` — the SDK does *not*
   * stamp it onto the response. Leave this undefined and the field is simply
   * **absent** from every projection, which is the honest encoding of "nobody
   * classified this action" (see `core/action-effect.ts` for why a
   * server-applied default would fail open).
   */
  effect?: IREffect;
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
 * useUIComponent options
 */
export interface UseUIComponentOptions {
  /** Unique identifier for the component */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description */
  description?: string;
  /** Actions available on this component */
  actions?: ComponentActionDef[];
  /** Child element IDs owned by this component */
  elementIds?: string[];
  /** Whether to automatically register on mount */
  autoRegister?: boolean;
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
   * Install an action list the `actions` option does not declare, published to
   * the registry in place (no unregister/register gap).
   *
   * Not needed for the common case: the `actions` OPTION is republished
   * whenever its published shape changes. The installed list holds until the
   * declared actions change VALUE, or `id` changes, and then the declared list
   * wins. An action id in both lists runs whichever handler was supplied last.
   */
  updateActions: (actions: ComponentActionDef[]) => void;
  /**
   * Add an element ID to this component, published to the registry
   * immediately. Survives re-renders; it is replaced only when the DECLARED
   * `elementIds` option itself changes value.
   */
  addElement: (elementId: string) => void;
  /** Remove an element ID from this component. Same publishing rules as {@link addElement}. */
  removeElement: (elementId: string) => void;
  /**
   * The component as the registry currently holds it — `null` until
   * registration commits, then refreshed on every republish that changes the
   * published shape.
   */
  registeredComponent: RegisteredNativeComponent | null;
}

/**
 * Value signature of what a bridge consumer can SEE of an action list.
 * Handlers are excluded: call sites pass fresh closures every render, and the
 * registered trampoline looks the latest one up at invoke time anyway.
 *
 * Runs during render over `paramSchema`, typed `Record<string, unknown>`, so it
 * must not throw: a cyclic or BigInt value degrades to a signature that cannot
 * see schema changes rather than taking the consumer's tree down.
 */
function publishedActionsSignature(actions: ComponentActionDef[] | undefined): string {
  const list = actions ?? [];
  const head = (a: ComponentActionDef) => [a.id, a.label, a.description, a.effect];
  try {
    return JSON.stringify(list.map((a) => [...head(a), a.paramSchema]));
  } catch {
    return JSON.stringify(list.map(head));
  }
}

/**
 * useUIComponent hook for React Native
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
 *     <View>
 *       <TextInput value={email} onChangeText={setEmail} />
 *       <TextInput value={password} onChangeText={setPassword} secureTextEntry />
 *       <Button title="Login" onPress={handleSubmit} />
 *     </View>
 *   );
 * }
 * ```
 */
export function useUIComponent(options: UseUIComponentOptions): UseUIComponentReturn {
  const bridge = useUIBridgeNativeOptional();
  // `registeredRef` is authoritative for the register/unregister guard;
  // `registered` is its rendered mirror — the value this hook RETURNS. It used
  // to return `registeredRef.current`, read during render before any effect had
  // set it: `false` on the first render and stale thereafter.
  const [registered, setRegistered] = useState(false);
  // Bumped whenever the registry's copy of this component demonstrably changed,
  // so the render-phase read of `registeredComponent` below re-runs.
  //
  // ⚠ CHURN GUARD — do not "simplify" `publishedIdRef` away. A provider whose
  // context value churns per render re-registers this component on every
  // render. If every registration bumped this counter, that bounded registry
  // churn would become an UNBOUNDED render loop (the sibling package's first
  // version of this fix OOM'd a 4 GB test worker exactly so). A
  // re-registration under an UNCHANGED id bumps nothing.
  const [publishVersion, setPublishVersion] = useState(0);
  const publishedIdRef = useRef<string | null>(null);
  const registeredRef = useRef(false);
  const registeredIdRef = useRef<string | null>(null);

  const { id, name, description, autoRegister = true } = options;

  // --- Actions ---------------------------------------------------------------
  //
  // Two lanes, kept apart: the DECLARED `actions` option, and a list installed
  // through `updateActions`. Sharing one ref meant an inline `actions` array —
  // a new identity on every render — reset the imperative list on the next
  // render.

  // The declared list is tracked on identity, so calls reach the latest closures.
  const actionsRef = useRef(options.actions || []);
  const actionsSignature = publishedActionsSignature(options.actions);
  useEffect(() => {
    actionsRef.current = options.actions || [];
  }, [options.actions]);

  // The imperative list holds until the declared actions change VALUE (the
  // call site has said something newer) or the id changes (it was installed
  // for the old one). Compared by hand rather than by effect deps, so a list
  // installed before this hook's first effect runs is kept.
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

  // Map the published actions into the registry's input shape.
  //
  // The handler is a TRAMPOLINE resolved at INVOKE time. Passing `a.handler`
  // directly pinned the closure from the render that registered the component
  // for the life of the mount, so a handler reading component state read it as
  // it was at mount.
  //
  // Every other field is spread rather than re-listed: the registry closes the
  // field list once (`toRegisteredComponentActions`), and a second closed list
  // here is only a second place to drop `paramSchema` / `effect` from, which is
  // what happened to each of them once.
  const toRegistryActions = useCallback(
    () =>
      publishedActions().map(({ handler: declaredHandler, ...rest }) => ({
        ...rest,
        handler: (params?: unknown, handlerOptions?: { signal?: AbortSignal }) =>
          (findAction(rest.id)?.handler ?? declaredHandler)(params, handlerOptions),
      })),
    [publishedActions, findAction]
  );

  // --- Element ids -----------------------------------------------------------
  //
  // `elementIds` carries no closures, so it is re-asserted only when the
  // DECLARED value changes — compared by value, since the array is freshly
  // allocated on essentially every render. Re-asserting on identity undid
  // `addElement` / `removeElement` on the next render of any call site that
  // declares an inline `elementIds` option.
  const elementIdsRef = useRef(options.elementIds || []);
  const elementIdsSignature = JSON.stringify(options.elementIds ?? null);
  useEffect(() => {
    if (options.elementIds !== undefined) elementIdsRef.current = options.elementIds;
    // Keyed on the value signature, not the array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementIdsSignature]);

  // --- Register / unregister -------------------------------------------------

  const register = useCallback(() => {
    if (!bridge || registeredRef.current) return;

    bridge.registry.registerComponent(id, {
      name,
      description,
      actions: toRegistryActions(),
      elementIds: elementIdsRef.current,
    });
    registeredRef.current = true;
    registeredIdRef.current = id;
    setRegistered(true);
    // Only when the id this hook has PUBLISHED actually moved — see the churn
    // guard note on `publishVersion`.
    if (publishedIdRef.current !== id) {
      publishedIdRef.current = id;
      setPublishVersion((v) => v + 1);
    }
  }, [bridge, id, name, description, toRegistryActions]);

  const unregister = useCallback(() => {
    if (!bridge || !registeredRef.current) return;

    // The id that was REGISTERED, which after an id change is not `id`.
    bridge.registry.unregisterComponent(registeredIdRef.current ?? id);
    registeredRef.current = false;
    registeredIdRef.current = null;
    setRegistered(false);
    // `publishedIdRef` is deliberately NOT cleared: clearing it would re-arm the
    // bump in `register()`, which is exactly the loop the guard prevents under
    // a churning provider (unregister+register on every render).
  }, [bridge, id]);

  // Execute an action
  const executeAction = useCallback(
    async <TParams = unknown, TResult = unknown>(
      actionId: string,
      params?: TParams
    ): Promise<TResult> => {
      if (!bridge) {
        throw new Error('UI Bridge Native not available');
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

  // Publish in place through the registry's update door. Republishing by
  // unregister+register emitted a spurious `component:unregistered` /
  // `component:registered` pair and left the component ABSENT from the
  // registry for the width of the call.
  const publish = useCallback(
    (meta: UpdateComponentMetaOptions) => {
      if (!registeredRef.current || !bridge) return;
      const changed = bridge.registry.updateComponentMeta(registeredIdRef.current ?? id, meta);
      if (changed) {
        setPublishVersion((v) => v + 1);
      }
    },
    [bridge, id]
  );

  const updateActions = useCallback(
    (actions: ComponentActionDef[]) => {
      imperativeActionsRef.current = actions;
      declaredAtInstallRef.current = actionsRef.current;
      publish({ actions: toRegistryActions() });
    },
    [publish, toRegistryActions]
  );

  // `addElement` / `removeElement` used to write a private ref and stop there,
  // so the ownership list an agent read never moved.
  const addElement = useCallback(
    (elementId: string) => {
      if (elementIdsRef.current.includes(elementId)) return;
      elementIdsRef.current = [...elementIdsRef.current, elementId];
      publish({ elementIds: elementIdsRef.current });
    },
    [publish]
  );

  const removeElement = useCallback(
    (elementId: string) => {
      if (!elementIdsRef.current.includes(elementId)) return;
      elementIdsRef.current = elementIdsRef.current.filter((eid) => eid !== elementId);
      publish({ elementIds: elementIdsRef.current });
    },
    [publish]
  );

  // Keep the latest register/unregister in refs so the auto-register effect
  // does not tear down when `name`, `description` or the action list changes —
  // those are republished in place by the effect further down.
  const registerRef = useRef(register);
  const unregisterRef = useRef(unregister);
  useEffect(() => {
    registerRef.current = register;
    unregisterRef.current = unregister;
  }, [register, unregister]);

  // Auto-register on mount, and RE-register when `id` (or the bridge) changes.
  //
  // `id` is a real dependency even though the body never reads it: without it
  // an id change would leave the OLD id registered and never register the new
  // one. On an id-change render the cleanup runs first, closing over the
  // PREVIOUS `unregisterRef.current`, which removes `registeredIdRef.current` —
  // the OLD id. The ref-sync effect above is declared first, so by the time
  // this body re-runs, `registerRef.current` registers the NEW id.
  useEffect(() => {
    if (autoRegister) {
      registerRef.current();
    }

    return () => {
      if (registeredRef.current) {
        unregisterRef.current();
      }
    };
  }, [autoRegister, bridge, id]);

  // Unregister AT COMMIT on unmount. A passive cleanup runs in a later task for
  // a non-discrete unmount, so until then the registry would still list this
  // component, answer its state and run its handlers although its DOM is gone.
  // Deps are [] on purpose: a churning `bridge` or an `id` change must keep the
  // atomic passive swap above, not unregister here and re-register a task later.
  // After this runs `registeredRef.current` is false, so the passive cleanup
  // above is a no-op, and under StrictMode the passive effect re-registers.
  const reregisterRef = useRef(false);
  useLayoutEffect(() => {
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

  // Keep the registry's copy of the declaration in step with the OPTIONS.
  //
  // `register()` publishes once and is guarded by `registeredRef`, so without
  // this a state-derived label, a conditional action (with its `effect:
  // 'destructive'`), or a widened `paramSchema` published its mount-time shape
  // for the life of the mount.
  //
  // Gated on `registered` rather than `registeredRef` so it runs on the commit
  // that FOLLOWS registration, and keyed on value signatures rather than the
  // arrays, whose identity churns every render. The actions published are the
  // imperative list while it holds, so this never overwrites `updateActions`.
  // `elementIds` is re-asserted only when the call site DECLARES it, so a hook
  // driven by `addElement` alone keeps its list.
  useEffect(() => {
    if (!bridge || !registered) return;
    publish({
      name,
      description,
      actions: toRegistryActions(),
      ...(options.elementIds !== undefined ? { elementIds: elementIdsRef.current } : {}),
    });
    // `actionsSignature` / `elementIdsSignature` stand in for the arrays they
    // summarise; the arrays themselves are deliberately NOT deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bridge,
    registered,
    id,
    name,
    description,
    actionsSignature,
    elementIdsSignature,
    publish,
    toRegistryActions,
  ]);

  // Read straight out of the registry during render rather than mirroring the
  // entry into state: the registry is the owner. `publishVersion` is what makes
  // this re-run — it is bumped exactly when the registry's copy changed. This
  // used to be a `useMemo` on `[bridge, id]` that ran BEFORE the register
  // effect on the first render and never recomputed.
  void publishVersion;
  const registeredComponent =
    registered && bridge ? (bridge.registry.getComponent(id) ?? null) : null;

  return {
    registered,
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
