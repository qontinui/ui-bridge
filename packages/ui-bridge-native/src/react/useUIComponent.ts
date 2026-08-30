/**
 * useUIComponent Hook for React Native
 *
 * Register a component with UI Bridge for component-level actions.
 */

import { useEffect, useCallback, useRef, useState } from 'react';
import type { IREffect, RegisteredNativeComponent } from '../core/types';
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
   * Parameter schema â€” **serialized, published to agents, and VALIDATED.**
   *
   * It is spread onto `/control/components` and `/control/component/:id`, and
   * four `qontinui-runner` consumers read it from there â€” including the LLM
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
   * - **Object-schema form** â€” `{ type: 'object', properties: { ... },
   *   required: ['...'], additionalProperties: false }`. The only form that can
   *   express *requiredness*. `paramSchemaOf()` from
   *   `@qontinui/ui-bridge-wrapper` emits it for you.
   * - **Map form** â€” `{ paramName: 'string', other: { type: 'number' } }`. A
   *   TYPE hint only: it cannot mark anything required, and a string that is
   *   not one of the seven JSON Schema primitive names (`string`, `number`,
   *   `integer`, `boolean`, `object`, `array`, `null`) is read as prose and
   *   constrains nothing â€” which is what keeps the fleet's many
   *   `{ count: 'number (>= 1, defaults to 1)' }` hint maps working.
   *
   * Recognised keywords: `type`, `enum`, `const`, `properties`, `required`,
   * `additionalProperties: false`, `items`, `minimum`/`maximum`,
   * `minLength`/`maxLength`, `pattern`. **Anything else is ignored, never
   * rejected** â€” a schema richer than the subset is still valid JSON Schema,
   * it just expresses fewer enforced constraints. No type coercion: `"5"` does
   * not satisfy `{ type: 'number' }`.
   *
   * Enforcement is a deployment setting and defaults to `'warn'` â€” violations
   * are logged and the handler still runs until someone calls
   * `setDefaultParamValidationMode('enforce')`. The full grammar, and why warn
   * is the default, are documented at `core/param-schema.ts`.
   */
  paramSchema?: Record<string, unknown>;
  /**
   * Safety annotation â€” `'read' | 'write' | 'destructive'` (Phase 4 of plan
   * `2026-08-20-ui-bridge-action-declaration-shape`).
   *
   * **Declare `'destructive'` on anything irreversible** â€” a delete, a send, a
   * charge, a deploy. It is the one value nothing can infer for you: the
   * static verb map behind this field never produces `'destructive'`, because
   * destructiveness depends on what your control does, not on what it is
   * called. An autonomous walk excludes destructive actions and walks
   * everything else, so an unmarked delete control gets pressed.
   *
   * **Precedence:** what you write here wins, and it is the **only** thing
   * that reaches the wire. `NATIVE_STANDARD_ACTION_EFFECTS` supplies a default
   * when the action `id` happens to be one of the native standard verbs
   * (`press`, `longPress`, `swipe`, â€¦), but that default is applied **by the
   * consumer**, via the exported `resolveActionEffect()` â€” the SDK does *not*
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
   * abort, so an unobservant handler is abandoned anyway â€” observing it is how
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
   * Publish an action list that is NOT the `actions` option.
   *
   * **Not required for the common case any more.** The `actions` OPTION passed
   * to `useUIComponent({ id, actions })` is now auto-re-published whenever its
   * published shape changes, so a state-derived action list â€” a label carrying
   * a count, an action that only exists while a row is selected, a
   * `paramSchema` that widens once options load â€” reaches
   * `/control/components` without a call site doing anything. This is the
   * escape hatch for actions the hook does not own, the same role `updateLabel`
   * plays for `useUIElement`.
   *
   * If you pass BOTH the `actions` option and call this, the option wins on the
   * next render that changes its signature: the declarative lane is the one the
   * republish effect re-asserts.
   */
  updateActions: (actions: ComponentActionDef[]) => void;
  /**
   * Add an element ID to this component. Published to the registry
   * immediately â€” this used to write to a private ref and stop there, so the
   * ownership list an agent read never moved.
   *
   * Survives re-renders. It is replaced only when the DECLARED `elementIds`
   * option itself changes value, which is the point at which the call site has
   * said something newer than the imperative edit.
   */
  addElement: (elementId: string) => void;
  /** Remove an element ID from this component. Same publishing rules as {@link addElement}. */
  removeElement: (elementId: string) => void;
  /**
   * The registered component as the registry currently holds it â€” `null` until
   * registration commits, then refreshed on every republish that changes the
   * published shape.
   */
  registeredComponent: RegisteredNativeComponent | null;
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
  // `registeredRef` is authoritative for the register/unregister guard (same
  // rationale as `useUIElement`: threading the state into the register
  // callback's deps builds a cleanup/run feedback loop). `registered` is the
  // rendered mirror â€” the value this hook RETURNS, which used to be
  // `registeredRef.current` and so was read during render before any effect had
  // set it: it was `false` on the first render and only ever changed if
  // something unrelated re-rendered the consumer.
  const [registered, setRegistered] = useState(false);
  // Bumped whenever the registry's copy of this component demonstrably changed,
  // to force the render-phase read of `registeredComponent` below to re-run.
  //
  // A version counter rather than holding the entry itself in state, and that is
  // load-bearing. `registerComponent` returns a FRESH object every call, so
  // storing it would re-render on every registration â€” and a provider whose
  // context value churns per render re-registers every element on every render,
  // which would then be an unbounded loop instead of the bounded registry churn
  // it is today. PR #179 fixed that churn at the provider, but this hook should
  // not be the thing that turns a provider bug into a hang. Hence
  // `publishedIdRef`: a re-registration under an UNCHANGED id bumps nothing.
  const [publishVersion, setPublishVersion] = useState(0);
  const publishedIdRef = useRef<string | null>(null);
  const registeredRef = useRef(false);
  const registeredIdRef = useRef<string | null>(null);
  const actionsRef = useRef(options.actions || []);
  const elementIdsRef = useRef(options.elementIds || []);

  const { id, name, description, autoRegister = true } = options;

  // Value signatures of the DECLARED lists. The arrays themselves are freshly
  // allocated on essentially every render at every call site, so their identity
  // says nothing; these say whether anything a bridge consumer can SEE moved.
  // `handler` is excluded for the same reason the registry excludes it (see
  // `publishedActionSignature`) â€” it is never published, and it changes every
  // render.
  const actionsSignature = JSON.stringify(
    (options.actions ?? []).map((a) => [a.id, a.label, a.description, a.paramSchema, a.effect])
  );
  const elementIdsSignature = JSON.stringify(options.elementIds ?? []);

  // Track the declared `actions` on every render, so the trampoline below always
  // resolves to the CURRENT closure. Only when the option is actually SUPPLIED:
  // overwriting unconditionally â€” which is what `options.actions || []` did â€”
  // wipes an action list installed through the imperative `updateActions` lane
  // on the very next render of a call site that declares no `actions` option.
  useEffect(() => {
    if (options.actions !== undefined) actionsRef.current = options.actions;
  }, [options.actions]);

  // `elementIds` carries no closures, so it is re-asserted only when the
  // DECLARED value actually changes. Doing it every render instead would undo
  // `addElement` / `removeElement` on the next render of any call site that
  // declares an `elementIds` option AND adds to it â€” the two lanes would fight,
  // and the imperative one would appear to work and then silently revert.
  useEffect(() => {
    if (options.elementIds !== undefined) elementIdsRef.current = options.elementIds;
    // Keyed on the value signature, not the array identity, which is freshly
    // allocated on every render at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementIdsSignature]);

  // Map the declared actions into the registry's shape.
  //
  // The handler is a trampoline that resolves through `actionsRef.current` at
  // INVOKE time. Without it the registry holds the closure from the render that
  // registered the component, for the life of the mount â€” so an action handler
  // reading component state read that state as it was at mount, and
  // `updateActions` was the only escape from a staleness nothing announced.
  //
  // Everything else is spread rather than re-listed field by field. The
  // hand-rolled list this replaces is the exact silent-drop trap this file's own
  // comments recorded twice (`paramSchema` in Phase 2, `effect` in Phase 4): a
  // field added to `ComponentActionDef` stayed assignable here and simply never
  // arrived. The registry closes the field list once, on the way in; a second
  // closed list here is only a second place to forget.
  const toRegistryActions = useCallback(
    () =>
      actionsRef.current.map(({ handler: declaredHandler, ...rest }) => ({
        ...rest,
        handler: (params?: unknown, handlerOptions?: { signal?: AbortSignal }) => {
          const latest = actionsRef.current.find((a) => a.id === rest.id);
          return (latest?.handler ?? declaredHandler)(params, handlerOptions);
        },
      })),
    []
  );

  // Register the component
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
    // Only when the id this hook has PUBLISHED actually moved. A re-registration
    // under the same id produces an entry a consumer cannot tell apart from the
    // one it already has, so it is not worth a render â€” and skipping it is what
    // keeps a churning provider from spinning this hook forever.
    if (publishedIdRef.current !== id) {
      publishedIdRef.current = id;
      setPublishVersion((v) => v + 1);
    }
  }, [bridge, id, name, description, toRegistryActions]);

  // Unregister the component
  const unregister = useCallback(() => {
    if (!bridge || !registeredRef.current) return;

    bridge.registry.unregisterComponent(registeredIdRef.current ?? id);
    registeredRef.current = false;
    registeredIdRef.current = null;
    setRegistered(false);
    // `publishedIdRef` is deliberately NOT cleared here. It records the id whose
    // registration the render-phase read has already been told about, and
    // clearing it would re-arm the bump in `register()` — which is exactly the
    // unbounded loop this guard exists to prevent, since a provider with a
    // churning context value runs unregister+register on every render. Going
    // un-registered is already visible through `registered` flipping to false.
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

  // Publish whatever `elementIdsRef` now holds. Shared by `addElement` and
  // `removeElement`, which BOTH used to mutate the ref and stop there â€” the
  // registry kept its mount-time `elementIds` and the component's ownership
  // list, as read from `/control/components`, was a fossil. The hook returned
  // two functions that did nothing observable.
  const publishElementIds = useCallback(() => {
    if (!registeredRef.current || !bridge) return;
    const changed = bridge.registry.updateComponentMeta(registeredIdRef.current ?? id, {
      elementIds: elementIdsRef.current,
    });
    if (changed) {
      setPublishVersion((v) => v + 1);
    }
  }, [bridge, id]);

  // Update actions dynamically
  const updateActions = useCallback(
    (actions: ComponentActionDef[]) => {
      actionsRef.current = actions;

      // Publish in place. This used to unregister and re-register, which emitted
      // a spurious `component:unregistered`/`component:registered` pair and left
      // the component ABSENT from the registry for the width of the call â€” a
      // snapshot taken in that window reported a component the app had not
      // stopped rendering.
      if (registeredRef.current && bridge) {
        const targetId = registeredIdRef.current ?? id;
        const changed = bridge.registry.updateComponentMeta(targetId, {
          actions: toRegistryActions(),
        });
        if (changed) {
          setPublishVersion((v) => v + 1);
        }
      }
    },
    [bridge, id, toRegistryActions]
  );

  // Add element ID
  const addElement = useCallback(
    (elementId: string) => {
      if (!elementIdsRef.current.includes(elementId)) {
        elementIdsRef.current = [...elementIdsRef.current, elementId];
        publishElementIds();
      }
    },
    [publishElementIds]
  );

  // Remove element ID
  const removeElement = useCallback(
    (elementId: string) => {
      if (!elementIdsRef.current.includes(elementId)) return;
      elementIdsRef.current = elementIdsRef.current.filter((eid) => eid !== elementId);
      publishElementIds();
    },
    [publishElementIds]
  );

  // Keep latest register/unregister in refs so the auto-register effect does
  // not re-run when consumers pass inline options.
  const registerRef = useRef(register);
  const unregisterRef = useRef(unregister);
  useEffect(() => {
    registerRef.current = register;
    unregisterRef.current = unregister;
  }, [register, unregister]);

  // Auto-register on mount, and RE-register when `id` changes.
  //
  // `id` is a real dependency even though the effect body never reads it, for
  // the same reason `useUIElement`'s effect lists it: without it the effect
  // never re-ran on an id change, so the OLD id stayed registered forever and
  // the NEW id was never registered at all. `registeredIdRef` existed to name
  // the old id during teardown and could never actually differ from `id`,
  // because nothing re-ran the effect â€” the field was dead for want of this dep.
  //
  // Ordering on an id-change render: the cleanup runs first, closing over the
  // PREVIOUS `unregisterRef.current`, which removes `registeredIdRef.current` â€”
  // the OLD id â€” and resets the guard. The ref-sync effect above is declared
  // first, so by the time this body re-runs, `registerRef.current` registers the
  // NEW id.
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

  // Keep the registry's copy of the declaration in step with the OPTIONS â€”
  // automatically.
  //
  // ROOT CAUSE this closes, and it is PR #176's defect one level up:
  // `register()` publishes name / description / actions / elementIds exactly
  // once and is guarded by `registeredRef`, while the auto-register effect
  // re-runs only on `[autoRegister, bridge, id]`. So a component whose
  // declaration is derived from state â€” an action label carrying a count, an
  // action that exists only while a row is selected, a `paramSchema` that widens
  // once options load â€” published its mount-time shape to `/control/components`
  // for the life of the mount. `updateActions` was the manual escape hatch, the
  // same shape `updateLabel` was for elements before #176 auto-published the
  // `label` option.
  //
  // Only the fields the call site actually DECLARES are re-asserted: a hook used
  // purely imperatively (no `actions` / `elementIds` option) must not have its
  // `updateActions` / `addElement` work overwritten by an empty declarative
  // lane.
  //
  // Gated on `registered` rather than `registeredRef` so it runs on the commit
  // that FOLLOWS registration, and keyed on the value signatures rather than the
  // arrays, whose identity churns every render.
  useEffect(() => {
    if (!bridge || !registered) return;
    const targetId = registeredIdRef.current ?? id;
    const changed = bridge.registry.updateComponentMeta(targetId, {
      name,
      description,
      ...(options.actions !== undefined ? { actions: toRegistryActions() } : {}),
      ...(options.elementIds !== undefined ? { elementIds: elementIdsRef.current } : {}),
    });
    if (changed) {
      setPublishVersion((v) => v + 1);
    }
    // `actionsSignature` / `elementIdsSignature` stand in for the arrays they
    // summarise; the arrays themselves are deliberately NOT deps, since their
    // identity changes on every render at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bridge,
    registered,
    id,
    name,
    description,
    actionsSignature,
    elementIdsSignature,
    toRegistryActions,
  ]);

  // Read straight out of the registry during render, rather than mirroring the
  // entry into state.
  //
  // The registry is the owner; a copy held in state is a second one that can
  // disagree. `publishVersion` is what makes this read re-run — it is bumped
  // exactly when the registry's copy demonstrably changed, so this value is as
  // fresh as the last publish and costs one `Map.get` per render.
  //
  // Pre-fix this was a `useMemo` on `[bridge, id]`, which ran BEFORE the
  // register effect on the first render and never recomputed: permanently
  // `null` for every consumer that read it.
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
