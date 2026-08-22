/**
 * useUIComponent Hook for React Native
 *
 * Register a component with UI Bridge for component-level actions.
 */

import { useEffect, useCallback, useRef, useMemo } from 'react';
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
  handler: (
    params?: TParams,
    options?: { signal?: AbortSignal }
  ) => TResult | Promise<TResult>;
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
  /** Update actions dynamically */
  updateActions: (actions: ComponentActionDef[]) => void;
  /** Add an element ID to this component */
  addElement: (elementId: string) => void;
  /** Remove an element ID from this component */
  removeElement: (elementId: string) => void;
  /** The registered component info */
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
  const registeredRef = useRef(false);
  const registeredIdRef = useRef<string | null>(null);
  const actionsRef = useRef(options.actions || []);
  const elementIdsRef = useRef(options.elementIds || []);

  const { id, name, description, autoRegister = true } = options;

  // Update refs when options change
  useEffect(() => {
    actionsRef.current = options.actions || [];
    elementIdsRef.current = options.elementIds || [];
  }, [options.actions, options.elementIds]);

  // Register the component
  const register = useCallback(() => {
    if (!bridge || registeredRef.current) return;

    bridge.registry.registerComponent(id, {
      name,
      description,
      actions: actionsRef.current.map((a) => ({
        id: a.id,
        label: a.label,
        description: a.description,
        // Phase 2: re-wrap site with a CLOSED field list. `paramSchema` was
        // absent here, so an author's declared schema died at this hop even
        // once the registry accepted it. Count re-wrap sites, not declaration
        // sites.
        paramSchema: a.paramSchema,
        // Phase 4: `effect` is the next field this closed list would have
        // dropped silently. Name it, or the annotation never reaches the
        // registry.
        effect: a.effect,
        handler: a.handler,
      })),
      elementIds: elementIdsRef.current,
    });
    registeredRef.current = true;
    registeredIdRef.current = id;
  }, [bridge, id, name, description]);

  // Unregister the component
  const unregister = useCallback(() => {
    if (!bridge || !registeredRef.current) return;

    bridge.registry.unregisterComponent(registeredIdRef.current ?? id);
    registeredRef.current = false;
    registeredIdRef.current = null;
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

  // Update actions dynamically
  const updateActions = useCallback(
    (actions: ComponentActionDef[]) => {
      actionsRef.current = actions;

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
    elementIdsRef.current = elementIdsRef.current.filter((eid) => eid !== elementId);
  }, []);

  // Keep latest register/unregister in refs so the auto-register effect does
  // not re-run when consumers pass inline options.
  const registerRef = useRef(register);
  const unregisterRef = useRef(unregister);
  useEffect(() => {
    registerRef.current = register;
    unregisterRef.current = unregister;
  }, [register, unregister]);

  // Auto-register on mount
  useEffect(() => {
    if (autoRegister) {
      registerRef.current();
    }

    return () => {
      if (registeredRef.current) {
        unregisterRef.current();
      }
    };
  }, [autoRegister, bridge]);

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
